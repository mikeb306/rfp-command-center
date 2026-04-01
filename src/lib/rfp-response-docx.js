import { importDocx } from './docx-export.js';

const XEROX_RED = 'C8102E';
const DARK_NAVY = '0F172A';
const LIGHT_GRAY = 'F1F5F9';
const WHITE = 'FFFFFF';
const MED_GRAY = '94A3B8';
const BORDER_COLOR = 'CBD5E1';
const SEVERITY_COLORS = { critical: 'DC2626', high: 'F97316', medium: 'EAB308', low: '22C55E' };

// Cell margins applied to every table cell (twips)
const CELL_MARGIN = { top: 60, bottom: 60, left: 100, right: 100 };

export async function buildResponseDocxBuffer({ tender, analysis, drafts }) {
  const D = await importDocx();

  const s = analysis?.summary || {};
  const rfpTitle = s.title || tender?.title || 'Untitled RFP';

  // ── Header & Footer for body pages ──
  const bodyHeader = new D.Header({
    children: [new D.Paragraph({
      border: { bottom: { style: D.BorderStyle.SINGLE, size: 6, color: XEROX_RED, space: 4 } },
      spacing: { after: 120 },
      children: [
        run(D, 'Xerox IT Solutions', { bold: true, size: 16, color: XEROX_RED }),
        run(D, '  |  ', { size: 16, color: MED_GRAY }),
        run(D, rfpTitle, { size: 16, color: '475569', italics: true })
      ]
    })]
  });

  const bodyFooter = new D.Footer({
    children: [new D.Paragraph({
      border: { top: { style: D.BorderStyle.SINGLE, size: 4, color: BORDER_COLOR, space: 4 } },
      alignment: D.AlignmentType.CENTER,
      children: [
        run(D, 'CONFIDENTIAL', { size: 14, color: MED_GRAY }),
        run(D, '    Page ', { size: 14, color: MED_GRAY }),
        new D.TextRun({ children: [D.PageNumber.CURRENT], size: 14, color: '475569', bold: true, font: 'Calibri' }),
        run(D, ' of ', { size: 14, color: MED_GRAY }),
        new D.TextRun({ children: [D.PageNumber.TOTAL_PAGES], size: 14, color: '475569', bold: true, font: 'Calibri' })
      ]
    })]
  });

  // ── Section 1: Cover Page ──
  const coverChildren = buildCoverPage({ D, tender, analysis });

  // ── Section 2: Body ──
  const bodyChildren = [];

  // Note: TOC removed — renders as raw field codes in Pages/Preview. Only Word processes it.

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
        heading1: {
          run: { font: 'Calibri', size: 32, bold: true, color: DARK_NAVY },
          paragraph: { spacing: { before: 360, after: 200 } }
        },
        heading2: {
          run: { font: 'Calibri', size: 26, bold: true, color: XEROX_RED },
          paragraph: { spacing: { before: 280, after: 140 } }
        },
        heading3: {
          run: { font: 'Calibri', size: 24, bold: true, color: '475569' },
          paragraph: { spacing: { before: 200, after: 100 } }
        }
      }
    },
    sections: [
      {
        properties: { page: { margin: { top: 720, bottom: 720, left: 1200, right: 1200 } } },
        children: coverChildren
      },
      {
        headers: { default: bodyHeader },
        footers: { default: bodyFooter },
        properties: { page: { margin: { top: 1200, bottom: 1000, left: 1200, right: 1200 } } },
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

function run(D, text, opts = {}) {
  return new D.TextRun({ text, font: 'Calibri', ...opts });
}

function pageBreak(D) {
  return new D.Paragraph({ children: [new D.PageBreak()] });
}

function h1(D, text) { return new D.Paragraph({ text, heading: D.HeadingLevel.HEADING_1 }); }
function h2(D, text) { return new D.Paragraph({ text, heading: D.HeadingLevel.HEADING_2 }); }

function para(D, text, opts = {}) {
  return new D.Paragraph({
    spacing: { after: 140, line: 280 },
    children: [run(D, text, { size: 22, ...opts })]
  });
}

function spacer(D, twips = 200) {
  return new D.Paragraph({ spacing: { before: twips }, children: [run(D, '', { size: 2 })] });
}

// Build a plain data cell
function cell(D, text) {
  return new D.TableCell({
    margins: CELL_MARGIN,
    children: [new D.Paragraph({
      children: [run(D, String(text ?? ''), { size: 20 })]
    })]
  });
}

// Build a header cell (white text on Xerox Red)
function headerCell(D, text) {
  return new D.TableCell({
    shading: { type: D.ShadingType.SOLID, color: XEROX_RED },
    margins: CELL_MARGIN,
    children: [new D.Paragraph({
      children: [run(D, text, { bold: true, size: 20, color: WHITE })]
    })]
  });
}

// Build a colored status cell
function statusCell(D, text, bgColor) {
  return new D.TableCell({
    shading: { type: D.ShadingType.SOLID, color: bgColor },
    margins: CELL_MARGIN,
    children: [new D.Paragraph({
      alignment: D.AlignmentType.CENTER,
      children: [run(D, text, { bold: true, size: 18, color: WHITE })]
    })]
  });
}

function thinBorder(D) {
  return { style: D.BorderStyle.SINGLE, size: 4, color: BORDER_COLOR };
}

function tableBorders(D) {
  const b = thinBorder(D);
  return { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b };
}

// Usable page width in twips (letter 12240 minus 2×1200 margins)
const PAGE_WIDTH = 9840;

// Convert percentage array to twips array
function pctToTwips(pcts) {
  if (!pcts) return undefined;
  return pcts.map((p) => Math.round((p / 100) * PAGE_WIDTH));
}

// Generic table builder — colWidths is optional array of percentages e.g. [30, 20, 50]
function makeTable(D, headers, dataRows, colWidths) {
  const hCells = headers.map((text) => headerCell(D, text));
  const hRow = new D.TableRow({ tableHeader: true, children: hCells });

  const bodyRows = dataRows.map((cells) => new D.TableRow({
    children: cells.map((content) => {
      if (content instanceof D.TableCell) return content;
      if (typeof content === 'object' && content?._cell) return content._cell;
      return cell(D, content);
    })
  }));

  const tableOpts = {
    width: { size: 100, type: D.WidthType.PERCENTAGE },
    rows: [hRow, ...bodyRows],
    borders: tableBorders(D)
  };
  const tw = pctToTwips(colWidths);
  if (tw) tableOpts.columnWidths = tw;

  return new D.Table(tableOpts);
}

// ═══════════════════════════════════════
//  COVER PAGE
// ═══════════════════════════════════════

function buildCoverPage({ D, tender, analysis }) {
  const s = analysis?.summary || {};
  const rfpTitle = s.title || tender?.title || 'Untitled RFP';
  const noBorder = { style: D.BorderStyle.NONE, size: 0, color: WHITE };
  const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder };

  return [
    // Top red accent bar (thick — 3 lines of red background)
    ...redBar(D),

    spacer(D, 1800),

    // "PROPOSAL RESPONSE" label
    new D.Paragraph({
      alignment: D.AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [run(D, 'P R O P O S A L   R E S P O N S E', { bold: true, size: 24, color: XEROX_RED })]
    }),

    // RFP Title — large and bold
    new D.Paragraph({
      alignment: D.AlignmentType.CENTER,
      spacing: { after: 300 },
      children: [run(D, rfpTitle, { bold: true, size: 48, color: DARK_NAVY })]
    }),

    // Red divider line
    new D.Paragraph({
      alignment: D.AlignmentType.CENTER,
      border: { bottom: { style: D.BorderStyle.SINGLE, size: 12, color: XEROX_RED, space: 1 } },
      spacing: { after: 300 },
      children: [run(D, '', { size: 2 })]
    }),

    // Info grid — borderless table with cell padding
    new D.Table({
      width: { size: 100, type: D.WidthType.PERCENTAGE },
      columnWidths: pctToTwips([40, 60]),
      borders: noBorders,
      rows: [
        coverInfoRow(D, 'Submitted to', s.issuer || 'N/A', noBorders),
        coverInfoRow(D, 'Closing Date', s.closingDate || 'N/A', noBorders),
        coverInfoRow(D, 'Estimated Value', s.estimatedValue || 'N/A', noBorders),
        coverInfoRow(D, 'Contract Type', s.contractType || 'N/A', noBorders),
        coverInfoRow(D, 'Contract Term', s.contractTerm || 'N/A', noBorders),
        coverInfoRow(D, 'Delivery Location', s.deliveryLocation || 'N/A', noBorders),
        coverInfoRow(D, 'Submission Method', s.submissionMethod || 'N/A', noBorders)
      ]
    }),

    spacer(D, 1200),

    // Company name
    new D.Paragraph({
      alignment: D.AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [run(D, 'XEROX IT SOLUTIONS', { bold: true, size: 32, color: XEROX_RED })]
    }),
    new D.Paragraph({
      alignment: D.AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [run(D, 'A Xerox Business Solutions Company  |  Saskatchewan, Canada', { size: 20, color: MED_GRAY, italics: true })]
    }),

    // Date
    new D.Paragraph({
      alignment: D.AlignmentType.CENTER,
      spacing: { before: 200 },
      children: [run(D, new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' }), { size: 20, color: MED_GRAY })]
    }),

    spacer(D, 600),

    // Bottom red accent bar
    ...redBar(D)
  ];
}

function redBar(D) {
  // Single paragraph with thick top+bottom red borders as a visible bar
  return [new D.Paragraph({
    border: {
      top: { style: D.BorderStyle.SINGLE, size: 36, color: XEROX_RED, space: 0 },
      bottom: { style: D.BorderStyle.SINGLE, size: 36, color: XEROX_RED, space: 0 }
    },
    spacing: { before: 0, after: 0 },
    children: [run(D, '', { size: 2 })]
  })];
}

function coverInfoRow(D, label, value, noBorders) {
  const cellMargins = { top: 30, bottom: 30, left: 80, right: 80 };
  return new D.TableRow({
    children: [
      new D.TableCell({
        borders: noBorders,
        margins: cellMargins,
        verticalAlign: D.VerticalAlign.CENTER,
        children: [new D.Paragraph({
          alignment: D.AlignmentType.RIGHT,
          children: [run(D, label, { bold: true, size: 20, color: MED_GRAY })]
        })]
      }),
      new D.TableCell({
        borders: noBorders,
        margins: cellMargins,
        verticalAlign: D.VerticalAlign.CENTER,
        children: [new D.Paragraph({
          children: [run(D, value, { size: 22, color: DARK_NAVY })]
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
  const score = bid.score || 0;
  const scoreLabel = score >= 80 ? 'STRONG BID' : score >= 60 ? 'MODERATE FIT' : score >= 40 ? 'PARTIAL FIT' : 'NO-BID';
  const scoreColor = score >= 80 ? '059669' : score >= 60 ? 'D97706' : score >= 40 ? 'F97316' : 'DC2626';

  items.push(new D.Paragraph({
    shading: { type: D.ShadingType.SOLID, color: LIGHT_GRAY },
    spacing: { before: 200, after: 200 },
    children: [
      run(D, `Bid Score: ${score}/100`, { bold: true, size: 28, color: scoreColor }),
      run(D, `  —  ${scoreLabel}`, { bold: true, size: 24, color: scoreColor })
    ]
  }));

  if (bid.recommendation) {
    items.push(new D.Paragraph({
      spacing: { after: 160 },
      children: [
        run(D, 'Recommendation: ', { bold: true, size: 22 }),
        run(D, bid.recommendation, { size: 22 })
      ]
    }));
  }

  if (bid.fitFactors?.length > 0) {
    items.push(spacer(D, 160));
    items.push(new D.Paragraph({
      spacing: { after: 120 },
      children: [run(D, 'Fit Factors', { bold: true, size: 24, color: DARK_NAVY })]
    }));
    items.push(makeTable(D, ['Factor', 'Score', 'Rationale'],
      bid.fitFactors.map((f) => [
        f.factor,
        statusCell(D, `${f.score}`, f.score >= 70 ? '059669' : f.score >= 50 ? 'D97706' : 'DC2626'),
        f.rationale
      ]),
      [25, 10, 65]
    ));
  }

  if (bid.dealBreakers?.length > 0) {
    items.push(spacer(D, 200));
    items.push(new D.Paragraph({
      spacing: { after: 120 },
      children: [run(D, 'Deal Breakers', { bold: true, size: 24, color: 'DC2626' })]
    }));
    for (const d of bid.dealBreakers) {
      items.push(new D.Paragraph({
        bullet: { level: 0 },
        spacing: { after: 80 },
        children: [run(D, d, { color: 'DC2626', size: 22 })]
      }));
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
    criteria.map((c) => [c.criterion, c.weight, c.maxPoints, c.notes]),
    [35, 15, 15, 35]
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
        if (line.startsWith('- ') || line.startsWith('* ')) {
          items.push(new D.Paragraph({
            bullet: { level: 0 },
            spacing: { after: 80 },
            children: [run(D, line.replace(/^[-*]\s*/, ''), { size: 22 })]
          }));
        } else {
          items.push(para(D, line));
        }
      }
      if (match.citations?.length > 0) {
        items.push(new D.Paragraph({
          spacing: { before: 100, after: 60 },
          children: [
            run(D, 'Sources: ', { bold: true, size: 18, color: MED_GRAY, italics: true }),
            run(D, match.citations.join(', '), { size: 18, color: MED_GRAY, italics: true })
          ]
        }));
      }
      if (match.gaps?.length > 0) {
        items.push(new D.Paragraph({
          shading: { type: D.ShadingType.SOLID, color: 'FFF7ED' },
          spacing: { before: 100, after: 100 },
          children: [
            run(D, '  Gaps: ', { bold: true, size: 20, color: 'F97316' }),
            run(D, match.gaps.join(' | '), { size: 20, color: 'F97316' })
          ]
        }));
      }
    } else {
      if (section.keyPoints?.length > 0) {
        for (const point of section.keyPoints) {
          items.push(new D.Paragraph({
            bullet: { level: 0 },
            spacing: { after: 80 },
            children: [run(D, point, { size: 22 })]
          }));
        }
      }
      if (section.evidenceNeeded?.length > 0) {
        items.push(new D.Paragraph({
          shading: { type: D.ShadingType.SOLID, color: 'FFF7ED' },
          spacing: { before: 100, after: 100 },
          children: [run(D, '  Evidence needed: ' + section.evidenceNeeded.join('; '), { size: 20, color: 'F97316', italics: true })]
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

  const colWidths = [8, 10, 8, 30, 8, 22, 14];
  const dataRows = reqs.map((r) => {
    const matched = findMatchingSection(r, outlineSections, draftTitles);
    return [
      r.reqId || '',
      r.reqType || '',
      r.mustHave ? statusCell(D, 'YES', 'DC2626') : 'No',
      (r.statement || '').slice(0, 150),
      r.sectionRef || '',
      matched.section || '\u2014',
      matched.addressed ? statusCell(D, 'Addressed', '059669') : statusCell(D, 'Needs Review', 'F97316')
    ];
  });

  items.push(makeTable(D, ['ID', 'Type', 'Must Have', 'Requirement', 'Ref', 'Response Section', 'Status'], dataRows, colWidths));

  const total = reqs.length;
  const mandatory = reqs.filter((r) => r.mustHave).length;
  const addressed = reqs.filter((r) => findMatchingSection(r, outlineSections, draftTitles).addressed).length;

  items.push(new D.Paragraph({
    shading: { type: D.ShadingType.SOLID, color: LIGHT_GRAY },
    spacing: { before: 200, after: 160 },
    indent: { left: 200 },
    children: [
      run(D, `Total: ${total}`, { bold: true, size: 22 }),
      run(D, `    Mandatory: ${mandatory}`, { bold: true, size: 22, color: 'DC2626' }),
      run(D, `    Addressed: ${addressed}/${total}`, { bold: true, size: 22, color: addressed === total ? '059669' : 'F97316' })
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
  const colWidths = [20, 6, 18, 18, 14, 10, 14];

  const grouped = {};
  for (const s of skus) { const cat = s.category || 'other'; (grouped[cat] ??= []).push(s); }

  for (const [cat, catSkus] of Object.entries(grouped)) {
    items.push(h2(D, cat.charAt(0).toUpperCase() + cat.slice(1)));
    items.push(makeTable(D,
      ['Item', 'Qty', 'Specs', 'Xerox Match', 'Vendors', 'Est. Cost', 'Notes'],
      catSkus.map((s) => [s.item, s.quantity, s.specs, s.xeroxPortfolioMatch, s.vendorOptions, s.estimatedUnitCost, s.notes]),
      colWidths
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
      statusCell(D, (r.severity || '').toUpperCase(), SEVERITY_COLORS[r.severity] || MED_GRAY),
      r.category, r.risk, r.mitigation
    ]),
    [12, 14, 37, 37]
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

  const flags = [
    ['NWPTA Applies', c.nwptaApplies],
    ['CFTA Applies', c.cftaApplies],
    ['US Content Restrictions', c.usContentRestrictions]
  ];
  items.push(makeTable(D, ['Trade Agreement', 'Applies'],
    flags.map(([label, val]) => [
      label,
      val ? statusCell(D, 'YES', 'DC2626') : statusCell(D, 'NO', '059669')
    ]),
    [70, 30]
  ));

  if (c.localPreferenceNotes) {
    items.push(spacer(D, 200));
    items.push(new D.Paragraph({
      spacing: { after: 120 },
      children: [
        run(D, 'Local Preference: ', { bold: true, size: 22 }),
        run(D, c.localPreferenceNotes, { size: 22 })
      ]
    }));
  }
  if (c.tradeAgreementNotes) {
    items.push(new D.Paragraph({
      spacing: { after: 120 },
      children: [
        run(D, 'Trade Agreements: ', { bold: true, size: 22 }),
        run(D, c.tradeAgreementNotes, { size: 22 })
      ]
    }));
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
  items.push(makeTable(D, ['Event', 'Date', 'Notes'],
    dates.map((d) => [d.event, d.date, d.notes]),
    [35, 20, 45]
  ));
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
