"""Local, non-executing ICICI document extraction. Input bytes on stdin; JSON on stdout.
Never performs network access, reads macros, or persists the original statement.
"""
import sys, io, re, json, hashlib
# Bound CPU and (on Linux) virtual memory for untrusted document parsing.
import resource
resource.setrlimit(resource.RLIMIT_CPU, (15, 15))
if sys.platform.startswith('linux'):
    resource.setrlimit(resource.RLIMIT_AS, (1024 * 1024 * 1024, 1024 * 1024 * 1024))
from datetime import datetime
from decimal import Decimal, InvalidOperation


def money(value):
    cleaned = re.sub(r'[^0-9.\-]', '', str(value))
    if not cleaned: return None
    return int((Decimal(cleaned) * 100).quantize(Decimal('1')))


def date(value):
    for fmt in ['%d/%m/%Y', '%d-%m-%Y', '%Y-%m-%d', '%d-%b-%Y', '%d %b %Y', '%B %d, %Y']:
        try: return datetime.strptime(str(value).strip(), fmt).date().isoformat()
        except ValueError: pass
    raise ValueError('Unrecognized transaction date')


def fingerprint(value):
    return hashlib.sha256(value.encode()).hexdigest()


def read_xls(data):
    import xlrd
    book = xlrd.open_workbook(file_contents=data, on_demand=True)
    if book.nsheets > 10: raise ValueError('Too many worksheets')
    sheet = book.sheet_by_index(0)
    if sheet.nrows > 20050 or sheet.ncols > 50: raise ValueError('Statement exceeds size limits')
    rows = [sheet.row_values(i) for i in range(sheet.nrows)]
    account = None
    for row in rows[:30]:
        for i, cell in enumerate(row):
            if str(cell).strip().lower() == 'account number':
                account = next((str(v).strip() for v in row[i+1:] if str(v).strip()), None)
    if not account: raise ValueError('Account identifier is missing from the workbook')
    norm = lambda v: re.sub(r'[^a-z]', '', str(v).lower())
    index = next((i for i,r in enumerate(rows) if 'transactionremarks' in [norm(c) for c in r] and 'transactiondate' in [norm(c) for c in r]), None)
    if index is None: raise ValueError('Unsupported ICICI workbook columns')
    cols = {norm(v):i for i,v in enumerate(rows[index])}
    required = ['transactiondate','transactionremarks','withdrawalamountinr','depositamountinr','balanceinr']
    if any(c not in cols for c in required): raise ValueError('Required ICICI workbook columns are missing')
    transactions = []
    balances = []
    for line,row in enumerate(rows[index+1:], index+2):
        raw_date = row[cols['transactiondate']]
        if not str(raw_date).strip(): continue
        if isinstance(raw_date, (int,float)): raw_date = xlrd.xldate.xldate_as_datetime(raw_date, book.datemode).strftime('%Y-%m-%d')
        try: when = date(raw_date)
        except ValueError:
            if any(str(c).lower().startswith(('total','closing')) for c in row): continue
            raise ValueError('A workbook transaction has an invalid date')
        debit, credit = money(row[cols['withdrawalamountinr']]) or 0, money(row[cols['depositamountinr']]) or 0
        balance = money(row[cols['balanceinr']])
        if debit < 0 or credit < 0 or (debit and credit) or not (debit or credit): raise ValueError('Ambiguous workbook debit/credit amount')
        description = str(row[cols['transactionremarks']]).strip()
        if not description: raise ValueError('A transaction has no description')
        reference = str(row[cols['chequenumber']]).strip() if 'chequenumber' in cols else ''
        reference = reference if reference not in ['', '-', '0', '0.0'] else ''
        amount = debit - credit
        transfer = bool(re.search(r'credit.?card|cc\s*pay|cc\s*bill\s*pay|ccbill|billpay.*card', description, re.I))
        transactions.append({'date':when,'description':description,'amount':amount,'reference':reference,'transfer':transfer,'balance':balance})
        balances.append((when,balance))
    if not transactions: raise ValueError('No transaction rows found')
    # ICICI export preserves running-balance order, ascending or descending.
    ascending = transactions[0]['date'] <= transactions[-1]['date']
    ordered = transactions if ascending else list(reversed(transactions))
    for previous, current in zip(ordered, ordered[1:]):
        if previous['balance'] is not None and current['balance'] is not None and previous['balance'] - current['amount'] != current['balance']:
            raise ValueError('Workbook running balances do not reconcile; no rows imported')
    last = ordered[-1]
    return {'kind':'depository','fingerprint':fingerprint(account),'last4':re.sub(r'\D','',account)[-4:], 'balance':last['balance'], 'balanceDate':last['date'], 'transactions':transactions,'reconciled':True}


def read_pdf(data):
    import pdfplumber
    with pdfplumber.open(io.BytesIO(data)) as doc:
        if len(doc.pages)>40: raise ValueError('PDF exceeds 40-page limit')
        first = doc.pages[0].extract_text() or ''
        if 'CREDIT CARD STATEMENT' not in first.upper(): raise ValueError('Only ICICI credit-card statement PDFs are supported')
        card = re.search(r'\b\d{4}[Xx*]{4,12}\d{4}\b',first)
        if not card: raise ValueError('Masked card identifier not found')
        period = re.search(r'Statement period\s*:\s*([A-Za-z]+ \d{1,2}, \d{4}) to ([A-Za-z]+ \d{1,2}, \d{4})',first)
        if not period: raise ValueError('Statement period is missing')
        lines = first.splitlines()
        summary = next((i for i,l in enumerate(lines) if 'Previous Balance' in l and 'Payments' in l),None)
        if summary is None: raise ValueError('Card reconciliation summary is missing')
        totals = re.findall(r'[-]?[\d,]+\.\d{2}', lines[summary+1])
        if len(totals)!=4: raise ValueError('Unsupported card summary layout')
        opening, charges, advances, credits = map(money,totals)
        transactions = []
        for page in doc.pages:
            words = page.extract_words()
            header = next((w for w in words if w['text']=='SerNo.'),None)
            if not header: continue
            labels = [w for w in words if abs(w['top']-header['top'])<3]
            xdate = next(w['x0'] for w in labels if w['text']=='Date')
            xdesc = next(w['x0'] for w in labels if w['text']=='Transaction')
            xreward = next(w['x0'] for w in labels if w['text']=='Reward')
            xamount = next(w['x0'] for w in labels if w['text']=='Amount')
            dates = [w for w in words if w['top']>header['top'] and abs(w['x0']-xdate)<4 and re.fullmatch(r'\d{2}/\d{2}/\d{4}',w['text'])]
            for i,stamp in enumerate(dates):
                stop = dates[i+1]['top']-1 if i+1<len(dates) else stamp['bottom']+15
                band = [w for w in words if stamp['top']-1 <= w['top'] < stop]
                desc = ' '.join(w['text'] for w in band if xdesc-2<=w['x0']<xreward-2)
                amount_words = ' '.join(w['text'] for w in band if w['x0']>=xamount-8 and abs(w['top']-stamp['top'])<3)
                amount_match = re.fullmatch(r'([\d,]+\.\d{2})\s*(CR)?',amount_words.strip(),re.I)
                reference = ''.join(w['text'] for w in band if stamp['x1']+1<=w['x0']<xdesc-2 and abs(w['top']-stamp['top'])<3)
                if not amount_match or not reference or not desc: raise ValueError('A card transaction cannot be parsed reliably')
                amount=money(amount_match.group(1))*(-1 if amount_match.group(2) else 1)
                transactions.append({'date':date(stamp['text']),'description':desc,'amount':amount,'reference':reference,'transfer':bool(re.search(r'PAYMENT RECEIVED',desc,re.I))})
        debits=sum(t['amount'] for t in transactions if t['amount']>0)
        paid=-sum(t['amount'] for t in transactions if t['amount']<0)
        if debits!=charges+advances or paid!=credits: raise ValueError('Card transaction totals do not match the statement summary; no rows imported')
        return {'kind':'credit','fingerprint':fingerprint(card.group().upper()),'last4':card.group()[-4:],'balance':opening+charges+advances-credits,'balanceDate':date(period.group(2)),'transactions':transactions,'reconciled':True}


def main():
    raw=sys.stdin.buffer.read(10*1024*1024+1)
    if len(raw)>10*1024*1024: raise ValueError('File exceeds 10 MB')
    if raw.startswith(b'%PDF-'): result=read_pdf(raw)
    elif raw.startswith(bytes.fromhex('d0cf11e0a1b11ae1')): result=read_xls(raw)
    else: raise ValueError('Unsupported statement file signature')
    print(json.dumps(result))

if __name__=='__main__':
    try: main()
    except Exception as error:
        print(json.dumps({'error':str(error) if isinstance(error,ValueError) else 'Cannot read this statement. Check the format and PDF password protection.'}))
        sys.exit(1)
