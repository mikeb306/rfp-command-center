import { buildChunksFromDocuments } from './chunks.js';
import { buildIncumbentIntelBlock } from './crown-payee.js';

const RESPONSES_URL = 'https://api.openai.com/v1/responses';

async function callOpenAI(systemPrompt, userContent, schema) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const body = {
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',
    input: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: [{ type: 'input_text', text: userContent }] }
    ],
    text: { format: { type: 'json_schema', name: schema.name, schema: schema.schema, strict: true } }
  };

  const response = await fetch(RESPONSES_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} — ${errorText}`);
  }

  const payload = await response.json();
  const rawText = payload?.output_text || findText(payload);
  if (!rawText) throw new Error('No text returned from OpenAI');
  return JSON.parse(rawText);
}

function findText(payload) {
  const outputs = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of outputs) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const block of content) {
      if (typeof block?.text === 'string') return block.text;
    }
  }
  return null;
}

const structuralSchema = {
  name: 'structural_analysis',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      documentStructure: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sectionTitle: { type: 'string' },
            sectionNumber: { type: 'string' },
            pageRange: { type: 'string' },
            purpose: { type: 'string' },
            crossReferences: { type: 'array', items: { type: 'string' } }
          },
          required: ['sectionTitle', 'sectionNumber', 'pageRange', 'purpose', 'crossReferences']
        }
      },
      evaluationCriteriaSections: { type: 'array', items: { type: 'string' } },
      mandatoryRequirementSections: { type: 'array', items: { type: 'string' } },
      pricingSections: { type: 'array', items: { type: 'string' } },
      submissionInstructions: { type: 'string' },
      documentComplexity: { type: 'string', enum: ['simple', 'moderate', 'complex'] }
    },
    required: ['documentStructure', 'evaluationCriteriaSections', 'mandatoryRequirementSections', 'pricingSections', 'submissionInstructions', 'documentComplexity']
  }
};

const chunkRequirementsSchema = {
  name: 'chunk_requirements',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      requirements: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            reqId: { type: 'string' },
            reqType: { type: 'string', enum: ['mandatory', 'rated', 'security', 'sla', 'pricing', 'timeline', 'deliverable', 'certification', 'experience', 'unknown'] },
            mustHave: { type: 'boolean' },
            statement: { type: 'string' },
            sectionRef: { type: 'string' },
            confidence: { type: 'number' }
          },
          required: ['reqId', 'reqType', 'mustHave', 'statement', 'sectionRef', 'confidence']
        }
      }
    },
    required: ['requirements']
  }
};

const adversarialSchema = {
  name: 'adversarial_analysis',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      overallAssessment: { type: 'string' },
      hiddenRisks: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            risk: { type: 'string' },
            severity: { type: 'string', enum: ['critical', 'high', 'medium'] },
            evidence: { type: 'string' },
            recommendation: { type: 'string' }
          },
          required: ['risk', 'severity', 'evidence', 'recommendation']
        }
      },
      optimisticAssumptions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            assumption: { type: 'string' },
            realityCheck: { type: 'string' },
            adjustedConfidence: { type: 'string' }
          },
          required: ['assumption', 'realityCheck', 'adjustedConfidence']
        }
      },
      competitiveThreats: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            threat: { type: 'string' },
            likelihood: { type: 'string', enum: ['high', 'medium', 'low'] },
            mitigation: { type: 'string' }
          },
          required: ['threat', 'likelihood', 'mitigation']
        }
      },
      bidNoRecommendation: { type: 'string' }
    },
    required: ['overallAssessment', 'hiddenRisks', 'optimisticAssumptions', 'competitiveThreats', 'bidNoRecommendation']
  }
};

const adversarialSystemPrompt = `You are a Devil's Advocate analyst. Your job is to argue AGAINST bidding on this RFP. Challenge every optimistic assumption. Find hidden risks. Identify why competitors might be better positioned. Your goal is to reduce overconfidence — research shows this approach reduces bid overconfidence by 69%.

Focus on:
1. Hidden requirements that could disqualify us
2. Incumbent advantages we're underestimating
3. Resource commitments we're not accounting for
4. Pricing pressure that makes this unprofitable
5. Timeline risks
6. SK procurement gotchas (NWPTA, GEM, Priority Saskatchewan)

Be brutally honest. If this is a bad bid, say so clearly.`;

export async function multiPassAnalyze({ tenderId, documents, existingAnalysis, buyerName }) {
  const joinedText = documents.map(d => d.text || '').join('\n\n---\n\n');
  const truncatedText = joinedText.slice(0, 120000);

  // Pass 1: Structural
  const structural = await callOpenAI(
    'You are a document structure analyst. Map the complete structure of this RFP document. Identify all sections, their numbering, page ranges, purposes, and cross-references. Pay special attention to evaluation criteria sections, mandatory requirement sections, pricing sections, and submission instructions.',
    `Analyze the structure of this RFP:\n\n${truncatedText}`,
    structuralSchema
  );

  // Pass 2: Requirements (chunked)
  const chunks = buildChunksFromDocuments(documents, { maxChunkChars: 6000, overlapChars: 1200 });
  const allRequirements = [];

  for (const chunk of chunks) {
    const result = await callOpenAI(
      'Extract ALL requirements from this section of an RFP document. Include section references. Mark mandatory requirements as mustHave: true.',
      `Section context: ${chunk.metadata?.sourceFilename || 'Unknown'}\nChunk ${chunk.chunkIndex + 1}:\n\n${chunk.chunkText}`,
      chunkRequirementsSchema
    );
    if (result.requirements) allRequirements.push(...result.requirements);
  }

  // Deduplicate requirements by statement similarity
  const deduped = deduplicateRequirements(allRequirements);

  // Pass 3: Adversarial
  const analysisContext = existingAnalysis
    ? `\n\nPrevious analysis scored this a ${existingAnalysis.bidNoBid?.compositeScore || 'N/A'}/100.\nNarrative: ${existingAnalysis.bidNoBid?.overallNarrative || 'None'}`
    : '';

  // Inject crown payee incumbent data if buyer is known
  const incumbentIntel = buyerName ? buildIncumbentIntelBlock(buyerName) : '';

  const adversarial = await callOpenAI(
    adversarialSystemPrompt,
    `Argue AGAINST bidding on this RFP. Challenge every assumption.\n\nRFP Text:\n${truncatedText.slice(0, 60000)}${analysisContext}${incumbentIntel}`,
    adversarialSchema
  );

  return { structural, requirements: deduped, adversarial };
}

function deduplicateRequirements(reqs) {
  const seen = new Map();
  for (const req of reqs) {
    const key = req.statement.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 100);
    const existing = seen.get(key);
    if (!existing || req.confidence > existing.confidence) {
      seen.set(key, req);
    }
  }
  return Array.from(seen.values());
}
