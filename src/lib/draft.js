import { draftGroundedSectionWithOpenAI } from './openai.js';
import { matchEvidenceForQuery } from './evidence.js';

export async function buildGroundedDraft({
  tender,
  sectionTitle,
  query,
  requirements,
  chunks,
  evidenceAssets = []
}) {
  const selectedChunks = chunks.slice(0, 8);
  const selectedReqs = requirements.slice(0, 12);
  const evidenceIds = matchEvidenceForQuery(query, selectedReqs, evidenceAssets, 6);

  if (process.env.OPENAI_API_KEY) {
    try {
      const llm = await draftGroundedSectionWithOpenAI({
        tender,
        sectionTitle,
        query,
        requirements: selectedReqs,
        chunks: selectedChunks,
        evidenceIds
      });
      if (llm) return { ...llm, evidenceIds, provider: 'openai' };
    } catch {
      // Fall through to deterministic fallback.
    }
  }

  return {
    provider: 'fallback',
    sectionTitle,
    draft: buildFallbackDraft(sectionTitle, query, selectedReqs, selectedChunks, evidenceIds),
    evidenceIds,
    citations: selectedChunks.map((chunk) => chunk.chunkId),
    gaps: inferGaps(selectedReqs, selectedChunks, evidenceIds)
  };
}

function buildFallbackDraft(sectionTitle, query, requirements, chunks, evidenceIds) {
  const lines = [];
  lines.push(`${sectionTitle}:`);
  lines.push(`Powerland proposes an approach aligned to the solicitation focus on ${query || 'the requested scope'}.`);

  const mustHave = requirements.filter((req) => req.mustHave).slice(0, 3);
  if (mustHave.length > 0) {
    lines.push('Mandatory requirements addressed in this section include:');
    for (const req of mustHave) {
      lines.push(`- ${req.statement}`);
    }
  }

  const chunkSignals = chunks.slice(0, 3).map((chunk) => summarizeChunk(chunk.chunkText));
  if (chunkSignals.length > 0) {
    lines.push('Grounding signals from tender text:');
    for (const signal of chunkSignals) {
      lines.push(`- ${signal}`);
    }
  }

  lines.push(`Linked evidence IDs: ${evidenceIds.length > 0 ? evidenceIds.join(', ') : 'none'}.`);
  lines.push('Final narrative should be reviewed by technical and legal approvers before submission.');
  return lines.join('\n');
}

function inferGaps(requirements, chunks, evidenceIds) {
  const gaps = [];
  if (chunks.length === 0) gaps.push('No indexed chunks found. Run indexing first.');
  if (requirements.length === 0) gaps.push('No extracted requirements found. Run extraction first.');
  if (evidenceIds.length === 0) gaps.push('No supporting evidence linked. Add evidence assets.');
  if (requirements.some((req) => req.reqType === 'pricing')) {
    gaps.push('Pricing assumptions still require approved rate-card evidence.');
  }
  return dedupe(gaps);
}

function summarizeChunk(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'No text';
  return clean.slice(0, 180) + (clean.length > 180 ? '...' : '');
}

function dedupe(items) {
  return [...new Set(items)];
}
