import { searchTenderChunks } from './store.js';
import { createEmbedding } from './embeddings.js';
import { draftResponseSection } from './openai-response-draft.js';
import { findSimilarTemplates, incrementUsage } from './content-library.js';

export async function orchestrateDrafts({ tender, analysis, skipDrafts }) {
  const outline = analysis?.responseOutline;
  if (!outline || outline.length === 0) return [];

  if (skipDrafts) {
    return outline.map((section) => ({
      sectionTitle: section.section,
      draft: null,
      citations: [],
      gaps: [],
      keyPoints: section.keyPoints || [],
      evidenceNeeded: section.evidenceNeeded || [],
      provider: 'skipped'
    }));
  }

  const tenderId = tender?.tenderId;
  const evaluationCriteria = analysis?.evaluationCriteria || [];
  const allRequirements = analysis?.requirements || [];
  const drafts = [];

  for (const section of outline) {
    const sectionTitle = section.section;
    const keyPoints = section.keyPoints || [];
    const evidenceNeeded = section.evidenceNeeded || [];

    // Find requirements relevant to this section
    const relevantReqs = matchRequirementsToSection(sectionTitle, keyPoints, allRequirements);

    // Build search query from section name + key points
    const queryParts = [sectionTitle, ...keyPoints.slice(0, 3)];
    const query = queryParts.join(' ').slice(0, 300);

    // Search for relevant chunks
    let chunks = [];
    if (tenderId) {
      let queryEmbedding = null;
      try {
        queryEmbedding = await createEmbedding(query);
      } catch {
        queryEmbedding = null;
      }
      try {
        chunks = await searchTenderChunks(tenderId, query, { limit: 6, queryEmbedding });
      } catch {
        chunks = [];
      }
    }

    // Find matching response templates from content library
    let templates = [];
    try {
      templates = await findSimilarTemplates(sectionTitle + ' ' + keyPoints.join(' '), 3);
    } catch {
      templates = [];
    }

    // Call enhanced LLM draft
    let result = null;
    if (process.env.OPENAI_API_KEY) {
      try {
        result = await draftResponseSection({
          tender,
          sectionTitle,
          keyPoints,
          chunks,
          evaluationCriteria,
          evidenceNeeded,
          requirements: relevantReqs,
          templates
        });
      } catch {
        result = null;
      }
    }

    if (result) {
      // Track template usage
      for (const t of templates) {
        try { await incrementUsage(t.id); } catch { /* ignore */ }
      }

      drafts.push({
        sectionTitle,
        draft: result.draft,
        citations: [...result.citations, ...templates.map(t => `template:${t.id}`)],
        gaps: result.gaps,
        keyPoints,
        evidenceNeeded,
        provider: 'openai'
      });
    } else {
      // Fallback: use key points as bullet text
      const fallbackDraft = keyPoints.length > 0
        ? keyPoints.map((p) => `- ${p}`).join('\n')
        : `[Draft pending for: ${sectionTitle}]`;

      drafts.push({
        sectionTitle,
        draft: fallbackDraft,
        citations: [],
        gaps: [`LLM draft unavailable for "${sectionTitle}". Using key points as placeholder.`],
        keyPoints,
        evidenceNeeded,
        provider: 'fallback'
      });
    }
  }

  return drafts;
}

function matchRequirementsToSection(sectionTitle, keyPoints, allRequirements) {
  if (!allRequirements || allRequirements.length === 0) return [];

  const sectionLower = sectionTitle.toLowerCase();
  const keyPointsLower = keyPoints.join(' ').toLowerCase();
  const combined = sectionLower + ' ' + keyPointsLower;

  // Type-to-section mapping
  const typeMap = {
    pricing: /pric|cost|budget|fee|commercial/i,
    security: /secur|cyber|protect|risk|compliance/i,
    timeline: /timeline|schedule|deliver|milestone|implement/i,
    sla: /sla|service level|support|uptime|maintenance/i,
    experience: /experience|qualif|team|staff|resourc/i,
    certification: /certif|accredit|standard|iso/i
  };

  return allRequirements.filter((req) => {
    // Match by type
    const typeRegex = typeMap[req.reqType];
    if (typeRegex && typeRegex.test(combined)) return true;

    // Match by keyword overlap
    const words = (req.statement || '').toLowerCase().split(/\s+/).filter((w) => w.length > 4);
    const matchCount = words.filter((w) => combined.includes(w)).length;
    if (matchCount >= 2) return true;

    // Match mandatory requirements broadly to "technical approach" type sections
    if (req.mustHave && /approach|technical|solution|method|scope/i.test(sectionLower)) return true;

    return false;
  });
}
