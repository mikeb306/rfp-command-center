import test from 'node:test';
import assert from 'node:assert/strict';
import { signAuditEvent, verifyAuditChain } from '../src/lib/audit-chain.js';

test('signAuditEvent builds linked hash chain', () => {
  const e1 = signAuditEvent(
    {
      eventId: 'e1',
      tenderId: 't1',
      type: 'tender.created',
      details: { a: 1 },
      createdAt: '2026-02-11T00:00:00.000Z'
    },
    null
  );
  const e2 = signAuditEvent(
    {
      eventId: 'e2',
      tenderId: 't1',
      type: 'document.added',
      details: { b: 2 },
      createdAt: '2026-02-11T00:01:00.000Z'
    },
    e1.hash
  );

  const check = verifyAuditChain([e1, e2]);
  assert.equal(check.valid, true);
  assert.equal(check.complete, true);
});

test('verifyAuditChain detects tampering', () => {
  const e1 = signAuditEvent(
    {
      eventId: 'e1',
      tenderId: 't1',
      type: 'tender.created',
      details: { a: 1 },
      createdAt: '2026-02-11T00:00:00.000Z'
    },
    null
  );
  const e2 = signAuditEvent(
    {
      eventId: 'e2',
      tenderId: 't1',
      type: 'document.added',
      details: { b: 2 },
      createdAt: '2026-02-11T00:01:00.000Z'
    },
    e1.hash
  );
  e2.details.b = 99;

  const check = verifyAuditChain([e1, e2]);
  assert.equal(check.valid, false);
  assert.equal(check.issues.some((i) => i.reason === 'hash_mismatch'), true);
});

test('verifyAuditChain allows unsigned legacy prefix and marks incomplete', () => {
  const legacy = {
    eventId: 'legacy',
    tenderId: 't1',
    type: 'legacy',
    details: {},
    createdAt: '2026-02-10T23:00:00.000Z'
  };
  const signed = signAuditEvent(
    {
      eventId: 'e1',
      tenderId: 't1',
      type: 'tender.created',
      details: {},
      createdAt: '2026-02-11T00:00:00.000Z'
    },
    null
  );

  const check = verifyAuditChain([legacy, signed]);
  assert.equal(check.valid, true);
  assert.equal(check.complete, false);
  assert.equal(check.unsignedCount, 1);
});
