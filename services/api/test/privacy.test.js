import test from 'node:test';
import assert from 'node:assert/strict';
import { maskEntities } from '../src/privacy.js';
test('PII spans become deterministic tokens, including after emoji', () => {
  const result = maskEntities('😀 Hello Jane Doe', [{ start: 8, end: 16, entity_type: 'PERSON' }]);
  assert.match(result, /^😀 Hello \[PERSON:[a-f0-9]{12}\]$/);
  assert.ok(!result.includes('Jane'));
});
test('overlapping PII spans cannot expose part of an identifier', () => {
  const result = maskEntities('Jane Doe', [
    { start: 0, end: 4, entity_type: 'PERSON' },
    { start: 0, end: 8, entity_type: 'PERSON' },
  ]);
  assert.match(result, /^\[PERSON:/);
  assert.ok(!result.includes('Doe'));
});
test('invalid detector spans fail closed', () =>
  assert.throws(
    () => maskEntities('short', [{ start: 0, end: 99, entity_type: 'PERSON' }]),
    /Invalid/,
  ));
