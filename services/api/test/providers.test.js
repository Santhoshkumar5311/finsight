import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aaSandboxEnabled,
  createConsent,
  consentStatus,
  importSandboxData,
} from '../src/providers/india-aa.js';

test('India AA adapter refuses every operation until the sandbox flag is set', async () => {
  delete process.env.AA_SANDBOX_ENABLED;
  assert.equal(aaSandboxEnabled(), false);
  assert.throws(() => createConsent('user-1'), /sandbox is not enabled/);
  assert.throws(() => consentStatus('user-1', 'x'), /sandbox is not enabled/);
  await assert.rejects(importSandboxData('user-1', 'x'), /sandbox is not enabled/);
});

test('India AA sandbox consent flow works once explicitly enabled, without touching a real bank', async () => {
  process.env.AA_SANDBOX_ENABLED = 'true';
  try {
    assert.equal(aaSandboxEnabled(), true);
    const consent = createConsent('user-2');
    assert.equal(consent.status, 'ACTIVE');
    assert.equal(consent.sandbox, true);
    assert.match(consent.fip, /sandbox/i);
    const status = consentStatus('user-2', consent.consentId);
    assert.equal(status.status, 'ACTIVE');
    assert.throws(() => consentStatus('user-2', 'not-a-real-consent'), /Unknown consent/);
    // A consent belonging to a different user cannot be read or spent by this one.
    assert.throws(() => consentStatus('someone-else', consent.consentId), /Unknown consent/);
    await assert.rejects(
      importSandboxData('someone-else', consent.consentId),
      /Consent is not active/,
    );
  } finally {
    delete process.env.AA_SANDBOX_ENABLED;
  }
});

test('the Plaid adapter keeps its existing public function surface after the provider refactor', async () => {
  const plaid = await import('../src/plaid.js');
  for (const name of ['linkToken', 'exchange', 'verifyWebhook', 'syncItem', 'plaid'])
    assert.equal(typeof plaid[name] !== 'undefined', true, `missing export: ${name}`);
});

test('providers/types.js documents the normalized shapes without exporting any runtime code', async () => {
  const types = await import('../src/providers/types.js');
  assert.deepEqual(Object.keys(types), []);
});
