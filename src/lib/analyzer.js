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

Score each of these 7 dimensions from 0-100:
1. Win Probability & Competitive Position (25% weight) — likelihood of winning given competition, incumbent, deal reg status
2. Solution Fit (20%) — how well our portfolio matches requirements
3. Strategic Alignment (15%) — alignment with our territory strategy, vertical focus, growth goals
4. Customer Relationship (15%) — existing relationship depth, champion access, past work
5. Resource Availability (10%) — can we staff this response and deliver if we win
6. Price Competitiveness (10%) — can we win on price given competition and deal registration
7. Past Performance (5%) — relevant references and track record

Be HONEST in scoring. A dimension where we have no advantage should score 30-50, not 70. Only score above 80 if there is CLEAR evidence of advantage. Deal registration is a pass/fail gate — flag if not registered.

Saskatchewan Procurement Rules:
- Mandatory requirements are PASS/FAIL — missing one is automatic disqualification. Flag these first.
- Rated criteria typically require 70% minimum to qualify. Flag any criteria where we'd score below 70%.
- Priority Saskatchewan program gives ~10% preference to SK-based companies. Xerox ITS qualifies (Regina + Saskatoon offices).
- FOIP (Freedom of Information and Protection of Privacy) applies to all government data. Flag any cloud/data residency concerns.
- GEM (Government Electronic Marketplace) is the new procurement portal — note if this RFP uses GEM.
- New West Partnership Trade Agreement (NWPTA) and CFTA apply to procurements above thresholds.

Known Saskatchewan IT Competitors:
- WBM Technologies: $38M GoS EUC contract holder, HP/Lenovo Amplify partner, incumbent in most government. Weakness: complacent, no next-gen security, slow to innovate.
- SaskTel Business: Crown telecom, bundled services, ubiquitous in SK. Weakness: jack of all trades, thin IT expertise, slow procurement cycle.
- Paradigm Consulting/Tarnel Group: Regina MSP, fast service. Weakness: small scale, limited to SMB.
- CDW Canada: National, Canoe/Kinetic GPO contracts. Weakness: no SK presence, no local support.
- SHI International: National, Canoe GPO. Weakness: US-based, minimal Canadian presence.
- Compugen: Federal standing offers, HPE partnership. Weakness: not local, slow for mid-market.
- TELUS Business: National security practice. Weakness: not SK-focused, generalist.

When the RFP mentions a buyer, check if it matches any known accounts. Factor incumbent relationships into the competitive assessment.

For SKU list: Map every product/service/license needed to the closest Xerox ITS portfolio match. If no match exists, say "No direct portfolio match" and suggest the closest alternative or subcontractor approach.

For risk log: Focus on deal-breakers first, then compliance risks, then commercial risks. Include Saskatchewan-specific risks (trade agreements, US content restrictions, local preference).

For competitive notes: If the RFP mentions incumbents, preferred vendors, or contains signals about competitive landscape, note them. Consider common Saskatchewan IT competitors: WBM Technologies, SaskTel, Paradigm Consulting, national firms like Accenture/IBM/Deloitte.

CRITICAL: For evaluation criteria, ONLY include weights and point values that are EXPLICITLY stated in the document. If the RFP does not specify weights or point values, use "Not specified" — NEVER estimate, infer, or fabricate scoring weights. Only report what the document actually says.`;

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
          dealRegistration: {
            type: 'object',
            additionalProperties: false,
            properties: {
              registered: { type: 'boolean' },
              vendor: { type: 'string' },
              notes: { type: 'string' }
            },
            required: ['registered', 'vendor', 'notes']
          },
          dimensions: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                dimension: { type: 'string', enum: ['win_probability', 'solution_fit', 'strategic_alignment', 'customer_relationship', 'resource_availability', 'price_competitiveness', 'past_performance'] },
                score: { type: 'number' },
                rationale: { type: 'string' },
                evidence: { type: 'string' }
              },
              required: ['dimension', 'score', 'rationale', 'evidence']
            }
          },
          dealBreakers: {
            type: 'array',
            items: { type: 'string' }
          },
          overallNarrative: { type: 'string' }
        },
        required: ['dealRegistration', 'dimensions', 'dealBreakers', 'overallNarrative']
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

  const result = JSON.parse(rawText);

  if (result.bidNoBid?.dimensions) {
    const scored = computeWeightedScore(result.bidNoBid.dimensions);
    result.bidNoBid.compositeScore = scored.composite;
    result.bidNoBid.recommendation = scored.recommendation;
  }

  return result;
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

export function computeWeightedScore(dimensions) {
  const WEIGHTS = {
    win_probability: 0.25,
    solution_fit: 0.20,
    strategic_alignment: 0.15,
    customer_relationship: 0.15,
    resource_availability: 0.10,
    price_competitiveness: 0.10,
    past_performance: 0.05,
  };

  let totalWeightedScore = 0;
  let totalWeight = 0;

  for (const dim of dimensions) {
    const w = WEIGHTS[dim.dimension];
    if (w) {
      totalWeightedScore += dim.score * w;
      totalWeight += w;
    }
  }

  const composite = totalWeight > 0 ? Math.round(totalWeightedScore / totalWeight) : 0;

  let recommendation;
  if (composite >= 80) recommendation = 'GO — Strong bid, pursue aggressively';
  else if (composite >= 60) recommendation = 'CAUTION — Proceed with mitigation strategy';
  else if (composite >= 40) recommendation = 'EXECUTIVE OVERRIDE REQUIRED — Significant risks';
  else recommendation = 'NO-BID — Poor fit, walk away';

  return { composite, recommendation, weights: WEIGHTS };
}
