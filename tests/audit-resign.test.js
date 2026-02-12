import test from 'node:test';
import assert from 'node:assert/strict';
import { backfillAuditChainEvents, signAuditEvent, verifyAuditChain } from '../src/lib/audit-chain.js';

test('backfillAuditChainEvents signs all-legacy unsigned events', () => {
  const events = [
    {
      eventId: 'e1',
      tenderId: 't1',
      type: 'legacy.a',
      details: { x: 1 },
      createdAt: '2026-02-10T00:00:00.000Z'
    },
    {
      eventId: 'e2',
      tenderId: 't1',
      type: 'legacy.b',
      details: { x: 2 },
      createdAt: '2026-02-10T00:01:00.000Z'
    }
  ];

  const result = backfillAuditChainEvents(events);
  assert.equal(result.rewrittenCount, 2);
  const verify = verifyAuditChain(result.events);
  assert.equal(verify.valid, true);
  assert.equal(verify.complete, true);
});

test('backfillAuditChainEvents blocks mixed signed and unsigned without force', () => {
  const signed = signAuditEvent(
    {
      eventId: 'e2',
      tenderId: 't1',
      type: 'signed',
      details: {},
      createdAt: '2026-02-10T00:01:00.000Z'
    },
    null
  );
  const mixed = [
    {
      eventId: 'e1',
      tenderId: 't1',
      type: 'legacy',
      details: {},
      createdAt: '2026-02-10T00:00:00.000Z'
    },
    signed
  ];

  assert.throws(() => backfillAuditChainEvents(mixed));
});

test('backfillAuditChainEvents forceRewrite rebuilds entire chain', () => {
  const e1 = signAuditEvent(
    {
      eventId: 'e1',
      tenderId: 't1',
      type: 'a',
      details: { v: 1 },
      createdAt: '2026-02-10T00:00:00.000Z'
    },
    null
  );
  const e2 = signAuditEvent(
    {
      eventId: 'e2',
      tenderId: 't1',
      type: 'b',
      details: { v: 2 },
      createdAt: '2026-02-10T00:01:00.000Z'
    },
    e1.hash
  );
  // Tamper with signed event data, then force rewrite should produce valid chain
  e2.details.v = 99;

  const rewritten = backfillAuditChainEvents([e1, e2], { forceRewrite: true });
  const verify = verifyAuditChain(rewritten.events);
  assert.equal(verify.valid, true);
  assert.equal(rewritten.mode, 'force_rewrite');
});
