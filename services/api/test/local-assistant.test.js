import test from 'node:test';
import assert from 'node:assert/strict';
import { localEndpoint, displayContext } from '../src/local-assistant.js';
test('local AI never accepts remote endpoints or embedded URL credentials', () => {
  assert.equal(localEndpoint('http://127.0.0.1:11434'), 'http://127.0.0.1:11434');
  for (const url of [
    'https://example.com',
    'http://127.0.0.1.attacker.example',
    'http://user:secret@localhost:11434',
    'http://localhost:11434/redirect',
  ])
    assert.throws(() => localEndpoint(url));
});

test('local model context presents unambiguous major currency units', () => {
  const result = displayContext({
    currency: 'INR',
    income: 100000,
    spending: [{ name: 'Dining', amount: 20000 }],
  });
  assert.equal(result.income, '₹1,000.00');
  assert.equal(result.spending[0].amount, '₹200.00');
});
