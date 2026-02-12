const RESPONSES_URL = 'https://api.openai.com/v1/responses';

const SYSTEM_PROMPT = `You are an expert RFP analyst working for Xerox IT Solutions (formerly Powerland), a Xerox Business Solutions Company based in Saskatchewan, Canada. You analyze RFP/RFQ/RFI documents for IT procurement opportunities.

Xerox ITS portfolio covers:
- Cloud: Microsoft 365, Azure, AWS
- Virtualization: Azure Local, Hyper-V, VMware, Nutanix, HPE Morpheus
- Infrastructure: Dell Technologies, HPE, Lenovo (servers, storage, HCI)
- End Point: Dell, HP, Lenovo (desktops, laptops, monitors)
- Security: Darktrace, Netskope, Juniper, Fortinet, Palo Alto, Check Point, Arctic Wolf, SentinelOne
- Data Protection: Veeam, Zerto (HPE), Backupify, Dell
- AI: Microsoft Copilot, Iterate.ai, VAIDIO, NVIDIA
- Services: Xerox RPA, M-Files, CareAR, Logitech, Poly
- Print & Document Management: Xerox MFPs/printers, M-Files ECM
- Network: HPE Aruba, Cisco, Extreme Networks, Juniper
- AV: Neat, Logitech, Poly
- IT Professional Services: Design, implementation, cloud migration, network design, wireless, data center, data protection
- Managed IT Services: Virtual CIO, remote monitoring, MDR/EDR/XDR, managed print
- IT Support Services: Install/config, imaging, depot repair, warranty, hardware/software deployment, CareAR
- Data Center & Co-Location: On-premise, Equinix

Xerox ITS is a Canadian entity. They are HPE's Canadian Partner of the Year 3 of the last 4 years. They cover all of Saskatchewan.

For the bid/no-bid score (0-100):
- 80-100: Strong fit, high win probability, recommend bid
- 60-79: Moderate fit, worth pursuing with strategy
- 40-59: Partial fit, significant gaps or risks
- 0-39: Poor fit, recommend no-bid

For SKU list: Map every product/service/license needed to the closest Xerox ITS portfolio match. If no match exists, say "No direct portfolio match" and suggest the closest alternative or subcontractor approach.

For risk log: Focus on deal-breakers first, then compliance risks, then commercial risks. Include Saskatchewan-specific risks (trade agreements, US content restrictions, local preference).

For competitive notes: If the RFP mentions incumbents, preferred vendors, or contains signals about competitive landscape, note them. Consider common Saskatchewan IT competitors: WBM Technologies, SaskTel, Paradigm Consulting, national firms like Accenture/IBM/Deloitte.`;

const analysisSchema = {
  name: 'rfp_analysis',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          issuer: { type: 'string' },
          closingDate: { type: 'string' },
          estimatedValue: { type: 'string' },
          contractType: { type: 'string' },
          contractTerm: { type: 'string' },
          deliveryLocation: { type: 'string' },
          submissionMethod: { type: 'string' }
        },
        required: ['title', 'issuer', 'closingDate', 'estimatedValue', 'contractType', 'contractTerm', 'deliveryLocation', 'submissionMethod']
      },
      bidNoBid: {
        type: 'object',
        additionalProperties: false,
        properties: {
          score: { type: 'number' },
          recommendation: { type: 'string' },
          fitFactors: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                factor: { type: 'string' },
                score: { type: 'number' },
                rationale: { type: 'string' }
              },
              required: ['factor', 'score', 'rationale']
            }
          },
          dealBreakers: {
            type: 'array',
            items: { type: 'string' }
          }
        },
        required: ['score', 'recommendation', 'fitFactors', 'dealBreakers']
      },
      evaluationCriteria: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            criterion: { type: 'string' },
            weight: { type: 'string' },
            maxPoints: { type: 'string' },
            notes: { type: 'string' }
          },
          required: ['criterion', 'weight', 'maxPoints', 'notes']
        }
      },
      requirements: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            reqId: { type: 'string' },
            reqType: {
              type: 'string',
              enum: ['mandatory', 'rated', 'security', 'sla', 'pricing', 'timeline', 'deliverable', 'certification', 'experience', 'unknown']
            },
            mustHave: { type: 'boolean' },
            statement: { type: 'string' },
            sectionRef: { type: 'string' },
            confidence: { type: 'number' }
          },
          required: ['reqId', 'reqType', 'mustHave', 'statement', 'sectionRef', 'confidence']
        }
      },
      skuList: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            category: {
              type: 'string',
              enum: ['hardware', 'software', 'licensing', 'cloud', 'security', 'network', 'print', 'av', 'services', 'other']
            },
            item: { type: 'string' },
            quantity: { type: 'string' },
            specs: { type: 'string' },
            xeroxPortfolioMatch: { type: 'string' },
            vendorOptions: { type: 'string' },
            estimatedUnitCost: { type: 'string' },
            notes: { type: 'string' }
          },
          required: ['category', 'item', 'quantity', 'specs', 'xeroxPortfolioMatch', 'vendorOptions', 'estimatedUnitCost', 'notes']
        }
      },
      riskLog: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            risk: { type: 'string' },
            severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
            category: { type: 'string', enum: ['compliance', 'technical', 'commercial', 'timeline', 'competitive', 'legal'] },
            mitigation: { type: 'string' }
          },
          required: ['risk', 'severity', 'category', 'mitigation']
        }
      },
      responseOutline: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            section: { type: 'string' },
            pageEstimate: { type: 'string' },
            keyPoints: {
              type: 'array',
              items: { type: 'string' }
            },
            evidenceNeeded: {
              type: 'array',
              items: { type: 'string' }
            }
          },
          required: ['section', 'pageEstimate', 'keyPoints', 'evidenceNeeded']
        }
      },
      keyDates: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            event: { type: 'string' },
            date: { type: 'string' },
            notes: { type: 'string' }
          },
          required: ['event', 'date', 'notes']
        }
      },
      competitiveNotes: { type: 'string' },
      saskatchewanCompliance: {
        type: 'object',
        additionalProperties: false,
        properties: {
          nwptaApplies: { type: 'boolean' },
          cftaApplies: { type: 'boolean' },
          usContentRestrictions: { type: 'boolean' },
          localPreferenceNotes: { type: 'string' },
          tradeAgreementNotes: { type: 'string' }
        },
        required: ['nwptaApplies', 'cftaApplies', 'usContentRestrictions', 'localPreferenceNotes', 'tradeAgreementNotes']
      }
    },
    required: ['summary', 'bidNoBid', 'evaluationCriteria', 'requirements', 'skuList', 'riskLog', 'responseOutline', 'keyDates', 'competitiveNotes', 'saskatchewanCompliance']
  },
  strict: true
};

export async function analyzeRfpDocument({ tenderId, docId, filename, text }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const body = {
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',
    input: [
      {
        role: 'system',
        content: SYSTEM_PROMPT
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `Analyze this RFP document.\nTender ID: ${tenderId}\nDocument: ${docId} (${filename})\nProvide a comprehensive analysis in the required JSON format.`
          },
          {
            type: 'input_text',
            text: text.slice(0, 120000)
          }
        ]
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: analysisSchema.name,
        schema: analysisSchema.schema,
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
