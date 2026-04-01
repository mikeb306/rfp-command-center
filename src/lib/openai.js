const RESPONSES_URL = 'https://api.openai.com/v1/responses';

export async function extractRequirementsWithOpenAI({ tenderId, documents, joinedText }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return [];

  const schema = {
    name: 'rfp_requirements',
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
              reqType: {
                type: 'string',
                enum: [
                  'mandatory',
                  'sla',
                  'security',
                  'pricing',
                  'timeline',
                  'deliverable',
                  'evaluation',
                  'unknown'
                ]
              },
              mustHave: { type: 'boolean' },
              statement: { type: 'string' },
              sectionRef: { type: 'string' },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              provenanceDocId: { type: 'string' },
              provenanceSpan: { type: 'string' }
            },
            required: [
              'reqType',
              'mustHave',
              'statement',
              'sectionRef',
              'confidence',
              'provenanceDocId',
              'provenanceSpan'
            ]
          }
        }
      },
      required: ['requirements']
    },
    strict: true
  };

  const docList = documents.map((doc) => ({ docId: doc.docId, filename: doc.filename }));

  const body = {
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',
    input: [
      {
        role: 'system',
        content:
          'You are an RFP analyst. Extract only explicit requirements from document text. If unclear, use reqType="unknown" and lower confidence.'
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text:
              `Tender ID: ${tenderId}\nDocuments: ${JSON.stringify(docList)}\n` +
              'Output JSON only.'
          },
          { type: 'input_text', text: joinedText.slice(0, 120000) }
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

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const payload = await response.json();
  const rawText = payload?.output_text || findText(payload);
  if (!rawText) return [];

  const parsed = JSON.parse(rawText);
  if (!Array.isArray(parsed?.requirements)) return [];
  return parsed.requirements;
}

export async function draftGroundedSectionWithOpenAI({
  tender,
  sectionTitle,
  query,
  requirements,
  chunks,
  evidenceIds = []
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const schema = {
    name: 'grounded_draft',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        draft: { type: 'string' },
        citations: {
          type: 'array',
          items: { type: 'string' }
        },
        gaps: {
          type: 'array',
          items: { type: 'string' }
        }
      },
      required: ['draft', 'citations', 'gaps']
    },
    strict: true
  };

  const body = {
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',
    input: [
      {
        role: 'system',
        content:
          'Draft one proposal section using only provided requirements and chunk text. Never invent facts. Cite chunk IDs used.'
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: JSON.stringify({
              tender: {
                tenderId: tender.tenderId,
                title: tender.title
              },
              sectionTitle,
              query,
              requirements: requirements.map((req) => ({
                reqId: req.reqId,
                reqType: req.reqType,
                mustHave: req.mustHave,
                statement: req.statement
              })),
              chunks: chunks.map((chunk) => ({
                chunkId: chunk.chunkId,
                score: chunk.score ?? null,
                text: String(chunk.chunkText || '').slice(0, 1200)
              })),
              evidenceIds
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

export async function answerQuestionWithOpenAI({ tender, question, chunks, requirements }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('Q&A: No OPENAI_API_KEY set');
    return 'OpenAI API key not configured.';
  }

  console.log(`Q&A: question="${question}", chunks=${chunks.length}, reqs=${requirements.length}`);

  const body = {
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    input: [
      {
        role: 'system',
        content:
          'You are an RFP analyst. Answer the user\'s question about the tender using ONLY the provided tender text chunks and requirements. Be specific, cite sources when possible, and say "not found in the RFP" if the information isn\'t available. Keep answers concise and actionable.'
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: JSON.stringify({
              tender: { tenderId: tender.tenderId, title: tender.title },
              question,
              requirements: requirements.slice(0, 10).map((req) => ({
                reqId: req.reqId,
                reqType: req.reqType,
                mustHave: req.mustHave,
                statement: req.statement
              })),
              chunks: chunks.map((chunk) => ({
                chunkId: chunk.chunkId,
                score: chunk.score ?? null,
                text: String(chunk.chunkText || '').slice(0, 1200)
              }))
            })
          }
        ]
      }
    ]
  };

  const response = await fetch(RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errBody = await response.text();
    console.error('Q&A OpenAI error:', response.status, errBody);
    throw new Error(`OpenAI API error: ${response.status} — ${errBody.slice(0, 200)}`);
  }
  const payload = await response.json();
  console.log('Q&A response keys:', Object.keys(payload));
  const text = payload?.output_text || findText(payload);
  return text || 'No answer could be generated from the available data.';
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
