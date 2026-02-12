import { nowIso } from './schema.js';

export const SECTION_STATUS = ['draft', 'in_review', 'approved', 'locked'];

export function defaultSectionWorkflow() {
  return {
    executive_summary: createSection('executive_summary', 'Executive Summary'),
    technical_approach: createSection('technical_approach', 'Technical Approach'),
    security_privacy: createSection('security_privacy', 'Security and Privacy'),
    work_plan: createSection('work_plan', 'Work Plan'),
    pricing_assumptions: createSection('pricing_assumptions', 'Pricing Assumptions')
  };
}

export function normalizeSectionWorkflow(input) {
  const base = defaultSectionWorkflow();
  if (!input || typeof input !== 'object') return base;

  for (const [key, section] of Object.entries(base)) {
    const source = input[key];
    if (!source || typeof source !== 'object') continue;
    section.status = SECTION_STATUS.includes(source.status) ? source.status : section.status;
    section.assignee = strOrNull(source.assignee);
    section.reviewer = strOrNull(source.reviewer);
    section.note = strOrNull(source.note);
    section.locked = Boolean(source.locked || section.status === 'locked');
    section.updatedAt = source.updatedAt || section.updatedAt;
  }

  return base;
}

export function validateSectionUpdate(input) {
  const errors = [];
  if (!input || typeof input !== 'object') return ['Payload must be an object.'];
  if (!SECTION_STATUS.includes(input.status)) {
    errors.push(`status must be one of: ${SECTION_STATUS.join(', ')}`);
  }
  if (input.assignee != null && typeof input.assignee !== 'string') {
    errors.push('assignee must be a string.');
  }
  if (input.reviewer != null && typeof input.reviewer !== 'string') {
    errors.push('reviewer must be a string.');
  }
  if (input.note != null && typeof input.note !== 'string') {
    errors.push('note must be a string.');
  }
  return errors;
}

export function summarizeSections(workflow) {
  const normalized = normalizeSectionWorkflow(workflow);
  const values = Object.values(normalized);
  const locked = values.filter((item) => item.status === 'locked').length;
  const approved = values.filter((item) => item.status === 'approved' || item.status === 'locked').length;
  return {
    total: values.length,
    locked,
    approved,
    label: `${approved}/${values.length} approved, ${locked} locked`
  };
}

export function evaluateSectionExportGate(workflow) {
  const normalized = normalizeSectionWorkflow(workflow);
  const blockers = Object.values(normalized)
    .filter((section) => section.status !== 'approved' && section.status !== 'locked')
    .map((section) => ({
      sectionKey: section.sectionKey,
      title: section.title,
      status: section.status,
      assignee: section.assignee
    }));

  return {
    ready: blockers.length === 0,
    blockers
  };
}

function createSection(sectionKey, title) {
  return {
    sectionKey,
    title,
    status: 'draft',
    assignee: null,
    reviewer: null,
    note: null,
    locked: false,
    updatedAt: nowIso()
  };
}

function strOrNull(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
