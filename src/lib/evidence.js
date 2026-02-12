import { newId, nowIso } from './schema.js';

export function normalizeEvidenceInput(input) {
  return {
    evidenceId: String(input.evidenceId || '').trim() || newId(),
    title: String(input.title || '').trim(),
    summary: String(input.summary || '').trim(),
    tags: toList(input.tags),
    reqTypes: toList(input.reqTypes),
    uri: String(input.uri || '').trim() || null,
    allowedUse: String(input.allowedUse || 'internal_response').trim(),
    createdAt: input.createdAt || nowIso()
  };
}

export function validateEvidenceInput(input) {
  const errors = [];
  if (!input || typeof input !== 'object') return ['Payload must be an object.'];
  if (!String(input.title || '').trim()) errors.push('title is required.');
  if (!String(input.summary || '').trim()) errors.push('summary is required.');
  return errors;
}

export function matchEvidenceForRequirement(requirement, evidenceAssets, limit = 3) {
  const scored = (evidenceAssets || [])
    .map((asset) => ({
      asset,
      score: scoreRequirementMatch(requirement, asset)
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(10, Number(limit) || 3)));

  return scored.map((entry) => ({
    evidenceId: entry.asset.evidenceId,
    title: entry.asset.title,
    score: Number(entry.score.toFixed(3))
  }));
}

export function matchEvidenceForQuery(query, requirements, evidenceAssets, limit = 5) {
  const q = tokenize(query);
  const reqTerms = (requirements || []).flatMap((req) => tokenize(req.statement));
  const combined = [...q, ...reqTerms];
  const boostReqTypes = new Set((requirements || []).map((req) => req.reqType).filter(Boolean));

  const scored = (evidenceAssets || [])
    .map((asset) => {
      let score = overlapScore(combined, tokenize(`${asset.title} ${asset.summary} ${asset.tags.join(' ')}`));
      if (asset.reqTypes.some((type) => boostReqTypes.has(type))) score += 0.35;
      return { asset, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(15, Number(limit) || 5)));

  return scored.map((entry) => entry.asset.evidenceId);
}

function scoreRequirementMatch(requirement, asset) {
  const reqType = String(requirement.reqType || '').toLowerCase();
  const reqTerms = tokenize(requirement.statement || '');
  const assetTerms = tokenize(`${asset.title} ${asset.summary} ${asset.tags.join(' ')}`);

  let score = overlapScore(reqTerms, assetTerms);
  if (reqType && asset.reqTypes.includes(reqType)) score += 0.5;
  if (requirement.mustHave && score > 0) score += 0.1;
  return score;
}

function overlapScore(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let hit = 0;
  for (const term of setA) {
    if (setB.has(term)) hit += 1;
  }
  return hit / Math.max(3, setA.size);
}

function tokenize(value) {
  const stop = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'your', 'will', 'are', 'our']);
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 2 && !stop.has(term));
}

function toList(value) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim().toLowerCase()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
}
