import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComplianceMatrix } from '../src/lib/compliance.js';

test('buildComplianceMatrix marks mandatory requirements as needs-evidence', () => {
  const rows = buildComplianceMatrix([
    {
      reqId: 'r1',
      reqType: 'mandatory',
      mustHave: true,
      statement: 'Must provide pricing breakdown.'
    },
    {
      reqId: 'r2',
      reqType: 'pricing',
      mustHave: false,
      statement: 'Include optional services pricing.'
    }
  ]);

  assert.equal(rows[0].status, 'needs-evidence');
  assert.equal(rows[1].status, 'draft-ready');
});
