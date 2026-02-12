import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultGates, normalizeGates, summarizeGates, validateGateUpdate } from '../src/lib/gates.js';

test('normalizeGates fills defaults and preserves known gate status', () => {
  const gates = normalizeGates({
    bidNoBid: { status: 'approved', reviewer: 'Alex', note: 'Good fit', decidedAt: '2026-02-11T00:00:00.000Z' }
  });

  assert.equal(gates.bidNoBid.status, 'approved');
  assert.equal(gates.requirementMap.status, 'pending');
  assert.equal(gates.pricingLegal.status, 'pending');
});

test('summarizeGates counts statuses', () => {
  const gates = defaultGates();
  gates.bidNoBid.status = 'approved';
  gates.requirementMap.status = 'needs_changes';
  const summary = summarizeGates(gates);

  assert.equal(summary.approved, 1);
  assert.equal(summary.needsChanges, 1);
  assert.equal(summary.total, 3);
});

test('validateGateUpdate rejects invalid status', () => {
  const errors = validateGateUpdate({ status: 'done' });
  assert.equal(errors.length > 0, true);
});
