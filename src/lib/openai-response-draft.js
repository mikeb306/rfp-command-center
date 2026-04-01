const RESPONSES_URL = 'https://api.openai.com/v1/responses';

export async function draftResponseSection({
  tender,
  sectionTitle,
  keyPoints,
  chunks,
  evaluationCriteria,
  evidenceNeeded,
  requirements = [],
  templates = []
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const criteriaContext = (evaluationCriteria || [])
    .map((c) => `- ${c.criterion} (weight: ${c.weight}, max: ${c.maxPoints})`)
    .join('\n');

  const systemPrompt = `You are a senior RFP response writer for Xerox IT Solutions (formerly Powerland), a Xerox Business Solutions Company based in Saskatchewan, Canada.

Draft a compelling, professional proposal section. Requirements:
- Write in confident, authoritative tone suitable for government/enterprise RFP submissions
- Ground every claim in the provided evidence chunks — cite chunk IDs
- Address each key point thoroughly
- Emphasize Xerox ITS strengths: Canadian entity, HPE Partner of the Year, full Saskatchewan coverage
- Never invent capabilities or certifications
- Identify gaps where evidence is missing

${criteriaContext ? `EVALUATION CRITERIA (weight your emphasis accordingly):\n${criteriaContext}` : ''}

KEY POINTS TO ADDRESS:
${(keyPoints || []).map((p) => `- ${p}`).join('\n')}

${requirements.length > 0 ? `RFP REQUIREMENTS THIS SECTION MUST ANSWER (address each one explicitly):\n${requirements.map((r) => `- [${r.reqId}] ${r.mustHave ? '(MANDATORY) ' : ''}${r.statement}`).join('\n')}` : ''}

${evidenceNeeded?.length ? `EVIDENCE THE EVALUATOR EXPECTS:\n${evidenceNeeded.map((e) => `- ${e}`).join('\n')}` : ''}

${templates.length > 0 ? `APPROVED RESPONSE TEMPLATES (use as your starting structure, adapt to this RFP):\n${templates.map(t => `--- ${t.title} (${t.category}) ---\n${t.content}`).join('\n\n')}` : ''}`;

  const schema = {
    name: 'response_section_draft',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        draft: { type: 'string' },
        citations: { type: 'array', items: { type: 'string' } },
        gaps: { type: 'array', items: { type: 'string' } }
      },
      required: ['draft', 'citations', 'gaps']
    },
    strict: true
  };

  const body = {
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',
    input: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: JSON.stringify({
              tender: { tenderId: tender?.tenderId, title: tender?.title },
              sectionTitle,
              chunks: (chunks || []).map((c) => ({
                chunkId: c.chunkId,
                score: c.score ?? null,
                text: String(c.chunkText || '').slice(0, 1200)
              }))
            })
          }
        ]
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: schema.name,
        schema: schema.schema,
        strict: true
      }
    }
  };

  const response = await fetch(RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);
  const payload = await response.json();
  const rawText = payload?.output_text || findText(payload);
  if (!rawText) return null;

  const parsed = JSON.parse(rawText);
  if (typeof parsed?.draft !== 'string') return null;
  return {
    draft: parsed.draft,
    citations: Array.isArray(parsed.citations) ? parsed.citations : [],
    gaps: Array.isArray(parsed.gaps) ? parsed.gaps : []
  };
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
