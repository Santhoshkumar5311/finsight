'use client';
import { useState, useRef, useEffect } from 'react';
import { Sparkles, X, ArrowUp, Plus, LoaderCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useDialog } from '@/lib/useDialog';
export default function Assistant({ onClose }: { onClose: () => void }) {
  useDialog();
  const [messages, setMessages] = useState<{ role: string; text: string; source?: string }[]>([]),
    [input, setInput] = useState(''),
    [busy, setBusy] = useState(false),
    [allow, setAllow] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);
  async function send(value = input) {
    if (!value.trim() || busy) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text: value }]);
    setBusy(true);
    try {
      const reply = await api('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ message: value, allowReminder: allow }),
      });
      setMessages((m) => [...m, { role: 'assistant', text: reply.text, source: reply.source }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', text: (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside
      className="assistant-drawer"
      role="dialog"
      aria-modal="true"
      aria-label="FinSight assistant"
    >
      <header>
        <div className="assistant-symbol">
          <Sparkles size={21} />
        </div>
        <div>
          <strong>Your financial copilot</strong>
          <span className="small muted">A clearer view, a conversation away</span>
        </div>
        <button aria-label="Close assistant" className="icon-btn" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      <div className="chat-body">
        {!messages.length && (
          <div className="chat-welcome">
            <Sparkles size={34} />
            <h2>
              Let’s make sense
              <br />
              of your money.
            </h2>
            <p>Ask a question. We’ll work through the numbers together.</p>
            {[
              'Can I afford a $2,000 laptop next month?',
              'Where is most of my money going?',
              'How can I improve my budget?',
            ].map((q) => (
              <button key={q} onClick={() => send(q)}>
                {q}
                <Plus size={16} />
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={'message ' + m.role}>
            {m.role === 'assistant' && (
              <span className="eyebrow">
                <Sparkles size={12} /> {m.source || 'FINSIGHT'}
              </span>
            )}
            <p>{m.text}</p>
          </div>
        ))}
        {busy && (
          <div className="thinking">
            <LoaderCircle size={16} className="spin" /> Checking your financial context…
          </div>
        )}
        <div ref={bottom} />
      </div>
      <footer>
        <label className="small consent">
          <input type="checkbox" checked={allow} onChange={(e) => setAllow(e.target.checked)} />{' '}
          Allow reminders requested in this chat
        </label>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input
            aria-label="Message assistant"
            placeholder="Ask about your finances…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={2000}
          />
          <button disabled={busy || !input.trim()} aria-label="Send message">
            <ArrowUp size={19} />
          </button>
        </form>
        <p className="small muted">Grounded in your numbers. You’re always in control.</p>
      </footer>
    </aside>
  );
}
