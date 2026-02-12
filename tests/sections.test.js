import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultSectionWorkflow,
  normalizeSectionWorkflow,
  summarizeSections,
  validateSectionUpdate
} from '../src/lib/sections.js';

test('defaultSectionWorkflow includes core sections', () => {
  const workflow = defaultSectionWorkflow();
  assert.equal(Boolean(workflow.executive_summary), true);
  assert.equal(Boolean(workflow.technical_approach), true);
});

test('normalizeSectionWorkflow preserves allowed status', () => {
  const workflow = normalizeSectionWorkflow({
    executive_summary: {
      status: 'approved',
      assignee: 'Sam',
      reviewer: 'Alex',
      note: 'Ready',
      locked: false,
      updatedAt: '2026-02-11T00:00:00.000Z'
    }
  });
  assert.equal(workflow.executive_summary.status, 'approved');
  assert.equal(workflow.executive_summary.assignee, 'Sam');
});

test('summarizeSections counts approved and locked', () => {
  const workflow = defaultSectionWorkflow();
  workflow.executive_summary.status = 'approved';
  workflow.technical_approach.status = 'locked';
  const summary = summarizeSections(workflow);
  assert.equal(summary.approved, 2);
  assert.equal(summary.locked, 1);
});

test('validateSectionUpdate enforces status enum', () => {
  const errors = validateSectionUpdate({ status: 'done' });
  assert.equal(errors.length > 0, true);
});
