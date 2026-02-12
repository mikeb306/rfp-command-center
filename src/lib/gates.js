export const GATE_KEYS = ['bidNoBid', 'requirementMap', 'pricingLegal'];

export const GATE_STATUS = ['pending', 'approved', 'rejected', 'needs_changes'];

export function defaultGates() {
  return {
    bidNoBid: emptyGate(),
    requirementMap: emptyGate(),
    pricingLegal: emptyGate()
  };
}

export function normalizeGates(gates) {
  const base = defaultGates();
  if (!gates || typeof gates !== 'object') return base;

  for (const key of GATE_KEYS) {
    if (gates[key] && typeof gates[key] === 'object') {
      base[key] = {
        status: GATE_STATUS.includes(gates[key].status) ? gates[key].status : 'pending',
        reviewer: trimOrNull(gates[key].reviewer),
        note: trimOrNull(gates[key].note),
        decidedAt: gates[key].decidedAt || null
      };
    }
  }

  return base;
}

export function summarizeGates(gates) {
  const normalized = normalizeGates(gates);
  const approved = GATE_KEYS.filter((key) => normalized[key].status === 'approved').length;
  const rejected = GATE_KEYS.filter((key) => normalized[key].status === 'rejected').length;
  const pending = GATE_KEYS.filter((key) => normalized[key].status === 'pending').length;
  const changes = GATE_KEYS.filter((key) => normalized[key].status === 'needs_changes').length;

  return {
    approved,
    rejected,
    pending,
    needsChanges: changes,
    total: GATE_KEYS.length,
    label: `${approved}/${GATE_KEYS.length} approved`
  };
}

export function validateGateUpdate(input) {
  const errors = [];
  if (!input || typeof input !== 'object') {
    return ['Payload must be an object.'];
  }
  if (!GATE_STATUS.includes(input.status)) {
    errors.push(`status must be one of: ${GATE_STATUS.join(', ')}`);
  }
  if (input.reviewer != null && typeof input.reviewer !== 'string') {
    errors.push('reviewer must be a string.');
  }
  if (input.note != null && typeof input.note !== 'string') {
    errors.push('note must be a string.');
  }
  return errors;
}

function emptyGate() {
  return {
    status: 'pending',
    reviewer: null,
    note: null,
    decidedAt: null
  };
}

function trimOrNull(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
