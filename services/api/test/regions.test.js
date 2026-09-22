import test from 'node:test';
import assert from 'node:assert/strict';
import { regionalPreferences, bankingRoute, plaidRegionalOptions } from '@finsight/core';
test('legacy ICICI workspaces default to India without changing account data', () => {
  const state = {
    accounts: [{ currency: 'INR', balance: 12345 }],
    preferences: { notifications: true },
  };
  const before = structuredClone(state);
  assert.equal(regionalPreferences(state).region, 'IN');
  assert.deepEqual(state, before);
  assert.equal(regionalPreferences({ accounts: [] }).region, 'US');
});
test('an explicit bank region overrides currency inference', () => {
  assert.equal(
    regionalPreferences({ accounts: [{ currency: 'INR' }], preferences: { region: 'US' } }).region,
    'US',
  );
});
test('provider routes reject unsupported and mismatched regions', () => {
  assert.equal(bankingRoute({ preferences: { region: 'IN' } }, 'icici-statement').region, 'IN');
  for (const region of ['IN', 'OTHER'])
    assert.throws(() => bankingRoute({ preferences: { region } }, 'plaid'), { status: 409 });
  assert.throws(() => bankingRoute({ preferences: { region: 'US' } }, 'icici-statement'), {
    status: 409,
  });
  assert.deepEqual(plaidRegionalOptions({ region: 'US' }), {
    country_codes: ['US'],
    language: 'en',
  });
});

test('Plaid Link sends the selected supported country and rejects India before an SDK call', async () => {
  const { plaid, linkToken } = await import('../src/plaid.js');
  const original = plaid.linkTokenCreate;
  const calls = [];
  plaid.linkTokenCreate = async (request) => {
    calls.push(request);
    return { data: { link_token: 'synthetic-link-token' } };
  };
  try {
    assert.equal(
      (await linkToken('synthetic-user', { region: 'US' })).link_token,
      'synthetic-link-token',
    );
    assert.deepEqual(calls[0].country_codes, ['US']);
    assert.equal(calls[0].language, 'en');
    assert.equal(calls[0].transactions.days_requested, 90);
    await assert.rejects(linkToken('synthetic-user', { region: 'IN' }), { status: 409 });
    assert.equal(calls.length, 1);
  } finally {
    plaid.linkTokenCreate = original;
  }
});
