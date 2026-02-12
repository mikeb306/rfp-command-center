import { importDocx } from './docx-export.js';

const XEROX_RED = 'C8102E';
const DARK_NAVY = '0F172A';
const LIGHT_GRAY = 'F1F5F9';
const MED_GRAY = '94A3B8';
const BORDER_COLOR = 'CBD5E1';
const SEVERITY_COLORS = { critical: 'DC2626', high: 'F97316', medium: 'EAB308', low: '22C55E' };

export async function buildResponseDocxBuffer({ tender, analysis, drafts }) {
  const docx = await importDocx();
  const D = docx; // shorthand

  const s = analysis?.summary || {};
  const rfpTitle = s.title || tender?.title || 'Untitled RFP';

  // ── Header & Footer for body pages ──
  const bodyHeader = new D.Header({
    children: [new D.Paragraph({
      border: { bottom: { style: D.BorderStyle.SINGLE, size: 6, color: XEROX_RED, space: 4 } },
      spacing: { after: 120 },
      children: [
        new D.TextRun({ text: 'Xerox IT Solutions', bold: true, size: 16, color: XEROX_RED, font: 'Calibri' }),
        new D.TextRun({ text: '  |  ', size: 16, color: MED_GRAY }),
        new D.TextRun({ text: rfpTitle, size: 16, color: '475569', italics: true, font: 'Calibri' })
      ]
    })]
  });

  const bodyFooter = new D.Footer({
    children: [new D.Paragraph({
      border: { top: { style: D.BorderStyle.SINGLE, size: 4, color: BORDER_COLOR, space: 4 } },
      alignment: D.AlignmentType.CENTER,
      children: [
        new D.TextRun({ text: 'CONFIDENTIAL', size: 14, color: MED_GRAY, font: 'Calibri' }),
        new D.TextRun({ text: '    Page ', size: 14, color: MED_GRAY }),
        new D.TextRun({ children: [D.PageNumber.CURRENT], size: 14, color: '475569', bold: true }),
        new D.TextRun({ text: ' of ', size: 14, color: MED_GRAY }),
        new D.TextRun({ children: [D.PageNumber.TOTAL_PAGES], size: 14, color: '475569', bold: true })
      ]
    })]
  });

  // ── Section 1: Cover Page (no header/footer) ──
  const coverChildren = buildCoverPage({ D, tender, analysis });

  // ── Section 2: Body (with header/footer) ──
  const bodyChildren = [];

  // Table of Contents
  bodyChildren.push(new D.Paragraph({ text: 'Table of Contents', heading: D.HeadingLevel.HEADING_1 }));
  bodyChildren.push(new D.TableOfContents('Table of Contents', {
    hyperlink: true,
    headingStyleRange: '1-3'
  }));
  bodyChildren.push(pageBreak(D));

  // Executive Summary
  bodyChildren.push(...buildExecSummary({ D, analysis, drafts }));
  bodyChildren.push(pageBreak(D));

  // Evaluation Criteria
  const evalItems = buildEvalCriteriaSection({ D, analysis });
  if (evalItems.length > 0) { bodyChildren.push(...evalItems); bodyChildren.push(pageBreak(D)); }

  // Response Sections
  bodyChildren.push(...buildResponseSections({ D, analysis, drafts }));
  bodyChildren.push(pageBreak(D));

  // Requirements Traceability
  const reqItems = buildRequirementsTraceability({ D, analysis, drafts });
  if (reqItems.length > 0) { bodyChildren.push(...reqItems); bodyChildren.push(pageBreak(D)); }

  // Proposed Solution & Pricing
  const skuItems = buildSkuSection({ D, analysis });
  if (skuItems.length > 0) { bodyChildren.push(...skuItems); bodyChildren.push(pageBreak(D)); }

  // Risk Management
  const riskItems = buildRiskSection({ D, analysis });
  if (riskItems.length > 0) { bodyChildren.push(...riskItems); bodyChildren.push(pageBreak(D)); }

  // Saskatchewan Compliance
  bodyChildren.push(...buildComplianceSection({ D, analysis }));

  // Key Dates
  const dateItems = buildKeyDatesSection({ D, analysis });
  if (dateItems.length > 0) { bodyChildren.push(pageBreak(D)); bodyChildren.push(...dateItems); }

  // Competitive Positioning
  const compItems = buildCompetitiveSection({ D, analysis });
  if (compItems.length > 0) { bodyChildren.push(pageBreak(D)); bodyChildren.push(...compItems); }

  const doc = new D.Document({
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 22 } },
        heading1: { run: { font: 'Calibri', size: 32, bold: true, color: DARK_NAVY }, paragraph: { spacing: { before: 360, after: 160 } } },
        heading2: { run: { font: 'Calibri', size: 26, bold: true, color: XEROX_RED }, paragraph: { spacing: { before: 280, after: 120 } } },
        heading3: { run: { font: 'Calibri', size: 24, bold: true, color: '475569' }, paragraph: { spacing: { before: 200, after: 80 } } }
      },
      paragraphStyles: [
        { id: 'body', name: 'Body', basedOn: 'Normal', run: { size: 22 }, paragraph: { spacing: { after: 120, line: 276 } } }
      ]
    },
    sections: [
      {
        properties: { page: { margin: { top: 720, bottom: 720, left: 1080, right: 1080 } } },
        children: coverChildren
      },
      {
        headers: { default: bodyHeader },
        footers: { default: bodyFooter },
        properties: { page: { margin: { top: 1080, bottom: 900, left: 1080, right: 1080 } } },
        children: bodyChildren
      }
    ]
  });

  return D.Packer.toBuffer(doc);
}

export function buildResponseDocxFilename(tender, analysis) {
  const title = String(analysis?.summary?.title || tender?.title || 'rfp-response')
    .replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-').slice(0, 60);
  return `${title}-Response-${new Date().toISOString().slice(0, 10)}.docx`;
}

// ═══════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════

function pageBreak(D) {
  return new D.Paragraph({ children: [new D.PageBreak()] });
}

function h1(D, text) { return new D.Paragraph({ text, heading: D.HeadingLevel.HEADING_1 }); }
function h2(D, text) { return new D.Paragraph({ text, heading: D.HeadingLevel.HEADING_2 }); }

function para(D, text, opts = {}) {
  return new D.Paragraph({ spacing: { after: 120, line: 276 }, children: [new D.TextRun({ text, size: 22, ...opts })] });
}

function spacer(D, twips = 200) {
  return new D.Paragraph({ spacing: { before: twips }, children: [] });
}

function redRule(D) {
  return new D.Paragraph({
    border: { bottom: { style: D.BorderStyle.SINGLE, size: 12, color: XEROX_RED, space: 1 } },
    spacing: { after: 200 },
    children: []
  });
}

function makeTable(D, headerCells, dataRows) {
  const hRow = new D.TableRow({
    tableHeader: true,
    children: headerCells.map((text) => new D.TableCell({
      shading: { type: D.ShadingType.SOLID, color: XEROX_RED },
      children: [new D.Paragraph({ children: [new D.TextRun({ text, bold: true, size: 18, color: 'FFFFFF', font: 'Calibri' })] })]
    }))
  });

  const rows = [hRow, ...dataRows.map((cells) => new D.TableRow({
    children: cells.map((content) => {
      if (typeof content === 'object' && content._cell) return content._cell;
      return new D.TableCell({
        children: [new D.Paragraph({ children: [new D.TextRun({ text: String(content || ''), size: 18, font: 'Calibri' })] })]
      });
    })
  }))];

  return new D.Table({
    width: { size: 100, type: D.WidthType.PERCENTAGE },
    rows,
    borders: {
      top: thinBorder(D), bottom: thinBorder(D), left: thinBorder(D), right: thinBorder(D),
      insideHorizontal: thinBorder(D), insideVertical: thinBorder(D)
    }
  });
}

function shadedCell(D, text, color, fontColor = 'FFFFFF') {
  return {
    _cell: new D.TableCell({
      shading: { type: D.ShadingType.SOLID, color },
      children: [new D.Paragraph({ children: [new D.TextRun({ text, bold: true, size: 18, color: fontColor, font: 'Calibri' })] })]
    })
  };
}

function thinBorder(D) {
  return { style: D.BorderStyle.SINGLE, size: 4, color: BORDER_COLOR };
}

// ═══════════════════════════════════════
//  COVER PAGE
// ═══════════════════════════════════════

function buildCoverPage({ D, tender, analysis }) {
  const s = analysis?.summary || {};
  const rfpTitle = s.title || tender?.title || 'Untitled RFP';
  const noBorder = { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder };

  return [
    // Top red accent bar
    new D.Paragraph({
      shading: { type: D.ShadingType.SOLID, color: XEROX_RED },
      spacing: { before: 0, after: 0 },
      children: [new D.TextRun({ text: ' ', size: 8 })]
    }),

    spacer(D, 2400),

    // "PROPOSAL RESPONSE" label
    new D.Paragraph({
      alignment: D.AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [new D.TextRun({ text: 'PROPOSAL RESPONSE', bold: true, size: 20, color: XEROX_RED, font: 'Calibri', characterSpacing: 300 })]
    }),

    // RFP Title
    new D.Paragraph({
      alignment: D.AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [new D.TextRun({ text: rfpTitle, bold: true, size: 52, color: DARK_NAVY, font: 'Calibri' })]
    }),

    // Red divider line
    redRule(D),

    // Info grid using invisible table
    new D.Table({
      width: { size: 70, type: D.WidthType.PERCENTAGE },
      borders: noBorders,
      alignment: D.AlignmentType.CENTER,
      rows: [
        infoRow(D, 'Submitted to', s.issuer || 'N/A', noBorders),
        infoRow(D, 'Closing Date', s.closingDate || 'N/A', noBorders),
        infoRow(D, 'Estimated Value', s.estimatedValue || 'N/A', noBorders),
        infoRow(D, 'Contract Type', s.contractType || 'N/A', noBorders),
        infoRow(D, 'Contract Term', s.contractTerm || 'N/A', noBorders),
        infoRow(D, 'Delivery Location', s.deliveryLocation || 'N/A', noBorders),
        infoRow(D, 'Submission Method', s.submissionMethod || 'N/A', noBorders)
      ]
    }),

    spacer(D, 1600),

    // Company block
    new D.Paragraph({
      alignment: D.AlignmentType.CENTER,
      children: [new D.TextRun({ text: 'XEROX IT SOLUTIONS', bold: true, size: 36, color: XEROX_RED, font: 'Calibri', characterSpacing: 200 })]
    }),
    new D.Paragraph({
      alignment: D.AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [new D.TextRun({ text: 'A Xerox Business Solutions Company  |  Saskatchewan, Canada', size: 20, color: MED_GRAY, italics: true, font: 'Calibri' })]
    }),

    // Date
    new D.Paragraph({
      alignment: D.AlignmentType.CENTER,
      spacing: { before: 200 },
      children: [new D.TextRun({ text: new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' }), size: 18, color: MED_GRAY, font: 'Calibri' })]
    }),

    spacer(D, 400),

    // Bottom red accent bar
    new D.Paragraph({
      shading: { type: D.ShadingType.SOLID, color: XEROX_RED },
      spacing: { before: 0, after: 0 },
      children: [new D.TextRun({ text: ' ', size: 8 })]
    })
  ];
}

function infoRow(D, label, value, noBorders) {
  return new D.TableRow({
    children: [
      new D.TableCell({
        borders: noBorders,
        width: { size: 40, type: D.WidthType.PERCENTAGE },
        children: [new D.Paragraph({
          alignment: D.AlignmentType.RIGHT,
          spacing: { after: 60 },
          children: [new D.TextRun({ text: label, bold: true, size: 20, color: MED_GRAY, font: 'Calibri' })]
        })]
      }),
      new D.TableCell({
        borders: noBorders,
        width: { size: 60, type: D.WidthType.PERCENTAGE },
        children: [new D.Paragraph({
          spacing: { after: 60 },
          children: [new D.TextRun({ text: value, size: 22, color: DARK_NAVY, font: 'Calibri' })]
        })]
      })
    ]
  });
}

// ═══════════════════════════════════════
//  EXECUTIVE SUMMARY
// ═══════════════════════════════════════

function buildExecSummary({ D, analysis, drafts }) {
  const bid = analysis?.bidNoBid || {};
  const items = [h1(D, 'Executive Summary')];

  // Bid score callout box
  const scoreLabel = bid.score >= 80 ? 'STRONG BID' : bid.score >= 60 ? 'MODERATE FIT' : bid.score >= 40 ? 'PARTIAL FIT' : 'NO-BID';
  const scoreColor = bid.score >= 80 ? '059669' : bid.score >= 60 ? 'D97706' : bid.score >= 40 ? 'F97316' : 'DC2626';

  items.push(new D.Paragraph({
    shading: { type: D.ShadingType.SOLID, color: LIGHT_GRAY },
    spacing: { before: 160, after: 160 },
    border: { left: { style: D.BorderStyle.SINGLE, size: 24, color: scoreColor, space: 8 } },
    children: [
      new D.TextRun({ text: `  Bid Score: ${bid.score || 0}/100`, bold: true, size: 28, color: scoreColor, font: 'Calibri' }),
      new D.TextRun({ text: `  —  ${scoreLabel}`, bold: true, size: 24, color: scoreColor, font: 'Calibri' })
    ]
  }));

  if (bid.recommendation) {
    items.push(new D.Paragraph({
      spacing: { after: 120 },
      children: [new D.TextRun({ text: 'Recommendation: ', bold: true }), new D.TextRun(bid.recommendation)]
    }));
  }

  if (bid.fitFactors?.length > 0) {
    items.push(spacer(D, 120));
    items.push(new D.Paragraph({ children: [new D.TextRun({ text: 'Fit Factors', bold: true, size: 24, color: DARK_NAVY })] }));
    items.push(makeTable(D, ['Factor', 'Score', 'Rationale'],
      bid.fitFactors.map((f) => [f.factor, shadedCell(D, `${f.score}`, f.score >= 70 ? '059669' : f.score >= 50 ? 'D97706' : 'DC2626'), f.rationale])
    ));
  }

  if (bid.dealBreakers?.length > 0) {
    items.push(spacer(D, 160));
    items.push(new D.Paragraph({ children: [new D.TextRun({ text: 'Deal Breakers', bold: true, size: 24, color: 'DC2626' })] }));
    for (const d of bid.dealBreakers) {
      items.push(new D.Paragraph({ bullet: { level: 0 }, children: [new D.TextRun({ text: d, color: 'DC2626' })] }));
    }
  }

  const execDraft = drafts?.find((d) => /executive|exec.*summ/i.test(d.sectionTitle));
  if (execDraft?.draft) {
    items.push(spacer(D, 200));
    for (const line of execDraft.draft.split('\n').filter(Boolean)) {
      items.push(para(D, line));
    }
  }

  return items;
}

// ═══════════════════════════════════════
//  EVALUATION CRITERIA
// ═══════════════════════════════════════

function buildEvalCriteriaSection({ D, analysis }) {
  const criteria = analysis?.evaluationCriteria;
  if (!criteria || criteria.length === 0) return [];

  const items = [h1(D, 'Evaluation Criteria Alignment')];
  items.push(makeTable(D, ['Criterion', 'Weight', 'Max Points', 'Notes'],
    criteria.map((c) => [c.criterion, c.weight, c.maxPoints, c.notes])
  ));
  return items;
}

// ═══════════════════════════════════════
//  RESPONSE SECTIONS
// ═══════════════════════════════════════

function buildResponseSections({ D, analysis, drafts }) {
  const outline = analysis?.responseOutline;
  if (!outline || outline.length === 0) return [];

  const items = [h1(D, 'Detailed Response')];

  for (const section of outline) {
    items.push(h2(D, section.section));

    const match = drafts?.find((d) => d.sectionTitle.toLowerCase() === section.section.toLowerCase());

    if (match?.draft) {
      for (const line of match.draft.split('\n').filter(Boolean)) {
        items.push(para(D, line));
      }
      if (match.citations?.length > 0) {
        items.push(new D.Paragraph({
          spacing: { before: 80 },
          children: [
            new D.TextRun({ text: 'Sources: ', bold: true, size: 17, color: MED_GRAY, italics: true }),
            new D.TextRun({ text: match.citations.join(', '), size: 17, color: MED_GRAY, italics: true })
          ]
        }));
      }
      if (match.gaps?.length > 0) {
        items.push(new D.Paragraph({
          border: { left: { style: D.BorderStyle.SINGLE, size: 16, color: 'F97316', space: 6 } },
          shading: { type: D.ShadingType.SOLID, color: 'FFF7ED' },
          spacing: { before: 80, after: 80 },
          children: [
            new D.TextRun({ text: '  Gaps: ', bold: true, size: 18, color: 'F97316' }),
            new D.TextRun({ text: match.gaps.join(' | '), size: 18, color: 'F97316' })
          ]
        }));
      }
    } else {
      if (section.keyPoints?.length > 0) {
        for (const point of section.keyPoints) {
          items.push(new D.Paragraph({ bullet: { level: 0 }, children: [new D.TextRun({ text: point, size: 22 })] }));
        }
      }
      if (section.evidenceNeeded?.length > 0) {
        items.push(new D.Paragraph({
          border: { left: { style: D.BorderStyle.SINGLE, size: 16, color: 'F97316', space: 6 } },
          shading: { type: D.ShadingType.SOLID, color: 'FFF7ED' },
          spacing: { before: 80, after: 80 },
          children: [new D.TextRun({ text: '  Evidence needed: ' + section.evidenceNeeded.join('; '), size: 18, color: 'F97316', italics: true })]
        }));
      }
    }
  }

  return items;
}

// ═══════════════════════════════════════
//  REQUIREMENTS TRACEABILITY
// ═══════════════════════════════════════

function buildRequirementsTraceability({ D, analysis, drafts }) {
  const reqs = analysis?.requirements;
  if (!reqs || reqs.length === 0) return [];

  const outlineSections = analysis?.responseOutline || [];
  const draftTitles = (drafts || []).map((d) => d.sectionTitle);

  const items = [h1(D, 'Requirements Traceability Matrix')];
  items.push(para(D, 'This matrix maps each RFP requirement to where it is addressed in our response.', { italics: true, color: MED_GRAY }));

  const dataRows = reqs.map((r) => {
    const matched = findMatchingSection(r, outlineSections, draftTitles);
    return [
      r.reqId || '',
      r.reqType || '',
      r.mustHave ? shadedCell(D, 'YES', 'DC2626') : 'No',
      (r.statement || '').slice(0, 180),
      r.sectionRef || '',
      matched.section || '—',
      matched.addressed ? shadedCell(D, 'Addressed', '059669') : shadedCell(D, 'Needs Review', 'F97316')
    ];
  });

  items.push(makeTable(D, ['ID', 'Type', 'Must Have', 'Requirement', 'Ref', 'Response Section', 'Status'], dataRows));

  const total = reqs.length;
  const mandatory = reqs.filter((r) => r.mustHave).length;
  const addressed = reqs.filter((r) => findMatchingSection(r, outlineSections, draftTitles).addressed).length;

  items.push(new D.Paragraph({
    shading: { type: D.ShadingType.SOLID, color: LIGHT_GRAY },
    spacing: { before: 200, after: 120 },
    children: [
      new D.TextRun({ text: `  Total: ${total}`, bold: true, size: 20 }),
      new D.TextRun({ text: `   Mandatory: ${mandatory}`, bold: true, size: 20, color: 'DC2626' }),
      new D.TextRun({ text: `   Addressed: ${addressed}/${total}`, bold: true, size: 20, color: addressed === total ? '059669' : 'F97316' })
    ]
  }));

  return items;
}

function findMatchingSection(req, outlineSections, draftTitles) {
  const statement = (req.statement || '').toLowerCase();
  const reqType = (req.reqType || '').toLowerCase();
  const sectionRef = (req.sectionRef || '').toLowerCase();

  for (const section of outlineSections) {
    const name = (section.section || '').toLowerCase();
    const keyText = (section.keyPoints || []).join(' ').toLowerCase();
    const combined = name + ' ' + keyText;

    const typeMatches = {
      pricing: /pric|cost|budget|fee|commercial/i,
      security: /secur|cyber|protect|compliance/i,
      timeline: /timeline|schedule|deliver|milestone|implement/i,
      sla: /sla|service level|support|uptime/i,
      certification: /certif|accredit|standard|iso/i,
      experience: /experience|qualif|team|staff|resourc/i
    };
    if (typeMatches[reqType]?.test(name)) return { addressed: true, section: section.section };

    const reqWords = statement.split(/\s+/).filter((w) => w.length > 4);
    const matchCount = reqWords.filter((w) => combined.includes(w)).length;
    if (matchCount >= 2 || (reqWords.length > 0 && matchCount / reqWords.length > 0.3)) {
      return { addressed: true, section: section.section };
    }
    if (sectionRef && combined.includes(sectionRef)) return { addressed: true, section: section.section };
  }

  for (const title of draftTitles) {
    const t = title.toLowerCase();
    if (reqType === 'mandatory' && /approach|technical|solution|method/i.test(t)) return { addressed: true, section: title };
    if (reqType === 'experience' && /experience|qualif|team|staff/i.test(t)) return { addressed: true, section: title };
  }

  return { addressed: false, section: '' };
}

// ═══════════════════════════════════════
//  SKU / PRICING
// ═══════════════════════════════════════

function buildSkuSection({ D, analysis }) {
  const skus = analysis?.skuList;
  if (!skus || skus.length === 0) return [];

  const items = [h1(D, 'Proposed Solution & Pricing')];

  const grouped = {};
  for (const s of skus) { const cat = s.category || 'other'; (grouped[cat] ??= []).push(s); }

  for (const [cat, catSkus] of Object.entries(grouped)) {
    items.push(h2(D, cat.charAt(0).toUpperCase() + cat.slice(1)));
    items.push(makeTable(D,
      ['Item', 'Qty', 'Specs', 'Xerox Match', 'Vendors', 'Est. Cost', 'Notes'],
      catSkus.map((s) => [s.item, s.quantity, s.specs, s.xeroxPortfolioMatch, s.vendorOptions, s.estimatedUnitCost, s.notes])
    ));
  }

  return items;
}

// ═══════════════════════════════════════
//  RISK MANAGEMENT
// ═══════════════════════════════════════

function buildRiskSection({ D, analysis }) {
  const risks = analysis?.riskLog;
  if (!risks || risks.length === 0) return [];

  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...risks].sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));

  const items = [h1(D, 'Risk Management')];
  items.push(makeTable(D, ['Severity', 'Category', 'Risk', 'Mitigation'],
    sorted.map((r) => [
      shadedCell(D, r.severity.toUpperCase(), SEVERITY_COLORS[r.severity] || MED_GRAY),
      r.category, r.risk, r.mitigation
    ])
  ));
  return items;
}

// ═══════════════════════════════════════
//  COMPLIANCE
// ═══════════════════════════════════════

function buildComplianceSection({ D, analysis }) {
  const c = analysis?.saskatchewanCompliance;
  if (!c) return [];

  const items = [h1(D, 'Saskatchewan Compliance')];

  const flags = [['NWPTA Applies', c.nwptaApplies], ['CFTA Applies', c.cftaApplies], ['US Content Restrictions', c.usContentRestrictions]];
  items.push(makeTable(D, ['Trade Agreement', 'Applies'],
    flags.map(([label, val]) => [label, val ? shadedCell(D, 'YES', 'DC2626') : shadedCell(D, 'NO', '059669')])
  ));

  if (c.localPreferenceNotes) {
    items.push(spacer(D, 160));
    items.push(new D.Paragraph({ children: [new D.TextRun({ text: 'Local Preference: ', bold: true }), new D.TextRun(c.localPreferenceNotes)] }));
  }
  if (c.tradeAgreementNotes) {
    items.push(new D.Paragraph({ children: [new D.TextRun({ text: 'Trade Agreements: ', bold: true }), new D.TextRun(c.tradeAgreementNotes)] }));
  }

  return items;
}

// ═══════════════════════════════════════
//  KEY DATES
// ═══════════════════════════════════════

function buildKeyDatesSection({ D, analysis }) {
  const dates = analysis?.keyDates;
  if (!dates || dates.length === 0) return [];

  const items = [h1(D, 'Key Dates & Timeline')];
  items.push(makeTable(D, ['Event', 'Date', 'Notes'], dates.map((d) => [d.event, d.date, d.notes])));
  return items;
}

// ═══════════════════════════════════════
//  COMPETITIVE
// ═══════════════════════════════════════

function buildCompetitiveSection({ D, analysis }) {
  const notes = analysis?.competitiveNotes;
  if (!notes) return [];

  const items = [h1(D, 'Competitive Positioning')];
  for (const line of notes.split('\n').filter(Boolean)) {
    items.push(para(D, line));
  }
  return items;
}
