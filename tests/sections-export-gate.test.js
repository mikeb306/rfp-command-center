import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSectionWorkflow, evaluateSectionExportGate } from '../src/lib/sections.js';

test('evaluateSectionExportGate blocks when sections are still draft', () => {
  const workflow = defaultSectionWorkflow();
  const gate = evaluateSectionExportGate(workflow);
  assert.equal(gate.ready, false);
  assert.equal(gate.blockers.length > 0, true);
});

test('evaluateSectionExportGate passes when all sections approved/locked', () => {
  const workflow = defaultSectionWorkflow();
  for (const section of Object.values(workflow)) {
    section.status = 'approved';
  }
  workflow.pricing_assumptions.status = 'locked';
  const gate = evaluateSectionExportGate(workflow);
  assert.equal(gate.ready, true);
  assert.equal(gate.blockers.length, 0);
});
