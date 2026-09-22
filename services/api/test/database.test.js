import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
const db = new PGlite({ extensions: { vector, pgcrypto } });
const alice = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  bob = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
before(async () => {
  await db.exec('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;');
  const sql = await readFile(new URL('../../../database/001_schema.sql', import.meta.url), 'utf8');
  const sql2 = await readFile(
    new URL('../../../database/002_india_provider.sql', import.meta.url),
    'utf8',
  );
  await db.exec(sql);
  await db.exec(sql);
  await db.exec(sql2);
  await db.exec(sql2);
  const sql3 = await readFile(
    new URL('../../../database/003_runtime_security.sql', import.meta.url),
    'utf8',
  );
  await db.exec(sql3);
  await db.exec(sql3);
  const sql4 = await readFile(
    new URL('../../../database/004_statement_balances.sql', import.meta.url),
    'utf8',
  );
  await db.exec(sql4);
  await db.exec(sql4);
  await db.query('INSERT INTO profiles(user_id) VALUES($1),($2)', [alice, bob]);
  await db.query(
    "INSERT INTO accounts(id,user_id,name,type,mask,balance) VALUES('a',$1,'Alice checking','depository','1234',10000),('b',$2,'Bob checking','depository','5678',20000)",
    [alice, bob],
  );
  await db.query(
    "INSERT INTO transactions(id,user_id,account_id,name,amount,date,category) VALUES('ta',$1,'a','Coffee',500,'2026-09-16','Dining'),('tb',$2,'b','Coffee',700,'2026-09-16','Dining')",
    [alice, bob],
  );
});
after(async () => await db.close());
async function asUser(role, user, fn) {
  await db.exec('BEGIN');
  try {
    await db.exec('SET LOCAL ROLE ' + role);
    await db.query("SELECT set_config('app.user_id',$1,true)", [user]);
    return await fn();
  } finally {
    await db.exec('ROLLBACK');
  }
}
test('migration runs idempotently with pgvector and the expected tables', async () => {
  const { rows } = await db.query(
    "SELECT extname FROM pg_extension WHERE extname IN ('vector','pgcrypto')",
  );
  assert.equal(rows.length, 2);
});
test('authenticated users can only read their own bank rows through RLS', async () => {
  await asUser('authenticated', alice, async () => {
    const { rows } = await db.query('SELECT * FROM transactions');
    assert.deepEqual(
      rows.map((r) => r.id),
      ['ta'],
    );
  });
  await asUser('authenticated', bob, async () => {
    assert.deepEqual(
      (await db.query('SELECT id FROM accounts')).rows.map((r) => r.id),
      ['b'],
    );
  });
});
test('authenticated clients cannot write bank records or read bank credentials', async () => {
  await asUser(
    'authenticated',
    alice,
    async () =>
      await assert.rejects(
        db.query("UPDATE transactions SET amount=1 WHERE id='ta'"),
        /permission denied/,
      ),
  );
  await asUser(
    'authenticated',
    alice,
    async () => await assert.rejects(db.query('SELECT * FROM bank_items'), /permission denied/),
  );
});
test('agent can read owner-scoped transactions but cannot mutate banking data', async () => {
  await asUser('finsight_agent', alice, async () =>
    assert.equal((await db.query('SELECT * FROM transactions')).rows.length, 1),
  );
  await asUser(
    'finsight_agent',
    alice,
    async () => await assert.rejects(db.query('DELETE FROM transactions'), /permission denied/),
  );
});
test('agent budget writes cannot escape tenant scope', async () => {
  await asUser('finsight_agent', alice, async () => {
    await db.query("INSERT INTO budgets(user_id,category,limit_cents) VALUES($1,'Dining',10000)", [
      alice,
    ]);
    assert.equal((await db.query('SELECT * FROM budgets')).rows.length, 1);
  });
  await asUser(
    'finsight_agent',
    alice,
    async () =>
      await assert.rejects(
        db.query("INSERT INTO budgets(user_id,category,limit_cents) VALUES($1,'Dining',10000)", [
          bob,
        ]),
        /row-level security/,
      ),
  );
});
test('accounts/transactions default to the plaid provider and accept a statement-imported account', async () => {
  await db.query(
    "INSERT INTO accounts(id,user_id,name,type,mask,balance) VALUES('c',$1,'ICICI Sandbox','depository','1234',0)",
    [alice],
  );
  const account = (await db.query('SELECT provider FROM accounts WHERE id=$1', ['a'])).rows[0];
  assert.equal(account.provider, 'plaid');
  await db.query("UPDATE accounts SET provider='icici-statement', item_id=NULL WHERE id='c'");
  await db.query(
    "INSERT INTO transactions(id,user_id,account_id,name,amount,date,category,provider,currency) VALUES('tc',$1,'c','UPI-swiggy',500,'2026-09-16','Dining','icici-statement','INR')",
    [alice],
  );
  const tx = (
    await db.query('SELECT provider,status,currency FROM transactions WHERE id=$1', ['tc'])
  ).rows[0];
  assert.equal(tx.provider, 'icici-statement');
  assert.equal(tx.status, 'posted');
  assert.equal(tx.currency, 'INR');
});
test('statement_imports is backend-only, like bank_items and audit_log', async () => {
  await db.query(
    "INSERT INTO statement_imports(user_id,account_id,provider,source_hash,row_count) VALUES($1,'a','icici-statement','deadbeef',3)",
    [alice],
  );
  await asUser(
    'authenticated',
    alice,
    async () =>
      await assert.rejects(db.query('SELECT * FROM statement_imports'), /permission denied/),
  );
});
test('unauthenticated users cannot read diary entries', async () => {
  await asUser(
    'anon',
    alice,
    async () => await assert.rejects(db.query('SELECT * FROM diary_entries'), /permission denied/),
  );
});

test('API runtime has tenant isolation and cannot read Plaid credentials or delete audit records', async () => {
  await asUser('finsight_api', alice, async () => {
    assert.deepEqual(
      (await db.query('SELECT id FROM accounts')).rows.map((r) => r.id),
      ['a', 'c'],
    );
  });
  await assert.rejects(
    asUser('finsight_api', alice, () => db.query('SELECT encrypted_token FROM bank_items')),
    /permission denied/,
  );
  await assert.rejects(
    asUser('finsight_api', alice, () => db.query('DELETE FROM audit_log')),
    /permission denied/,
  );
  await assert.rejects(
    asUser('finsight_api', alice, () => db.query('SELECT * FROM webhook_inbox')),
    /permission denied/,
  );
});
test('worker can dispatch inbox and export audit but cannot alter existing audit events', async () => {
  await asUser('finsight_worker', alice, async () => {
    await db.query('SELECT encrypted_token FROM bank_items');
    await db.query('SELECT * FROM webhook_inbox');
    await db.query('SELECT * FROM audit_log');
    assert.equal((await db.query('SELECT user_id FROM profiles')).rows.length, 2);
  });
  await assert.rejects(
    asUser('finsight_worker', alice, () => db.query("UPDATE audit_log SET action='changed'")),
    /permission denied/,
  );
});
