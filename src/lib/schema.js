import crypto from 'node:crypto';

export const SOURCE_SYSTEMS = [
  'sasktenders',
  'saskatoon_portal',
  'merx',
  'ariba',
  'email',
  'manual',
  'other'
];

export function nowIso() {
  return new Date().toISOString();
}

export function newId() {
  return crypto.randomUUID();
}

export function validateTenderInput(input) {
  const errors = [];
  if (!input || typeof input !== 'object') {
    return ['Payload must be an object.'];
  }
  if (!input.title || typeof input.title !== 'string') {
    errors.push('title is required.');
  }
  if (!input.sourceSystem || !SOURCE_SYSTEMS.includes(input.sourceSystem)) {
    errors.push(`sourceSystem must be one of: ${SOURCE_SYSTEMS.join(', ')}`);
  }
  if (!input.sourceRef || typeof input.sourceRef !== 'string') {
    errors.push('sourceRef is required.');
  }
  return errors;
}

export function validateDocumentInput(input) {
  const errors = [];
  if (!input || typeof input !== 'object') {
    return ['Payload must be an object.'];
  }
  if (!input.filename || typeof input.filename !== 'string') {
    errors.push('filename is required.');
  }
  if (!input.text || typeof input.text !== 'string') {
    errors.push('text is required.');
  }
  return errors;
}
