export async function buildProposalDocxBuffer(pkg) {
  const docxLib = await importDocx();
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = docxLib;

  const sections = [
    new Paragraph({
      text: `Proposal Package: ${pkg?.tender?.title || 'Untitled Tender'}`,
      heading: HeadingLevel.TITLE
    }),
    new Paragraph({ text: `Tender ID: ${pkg?.tender?.tenderId || 'unknown'}` }),
    new Paragraph({ text: `Source: ${pkg?.tender?.sourceSystem || 'unknown'} (${pkg?.tender?.sourceRef || 'n/a'})` }),
    new Paragraph({ text: `Generated: ${pkg?.generatedAt || ''}` }),
    new Paragraph({ text: '' }),
    new Paragraph({ text: 'Sections', heading: HeadingLevel.HEADING_1 })
  ];

  for (const section of pkg.sections || []) {
    sections.push(new Paragraph({ text: section.sectionTitle || 'Section', heading: HeadingLevel.HEADING_2 }));
    sections.push(new Paragraph({ text: section.draft || '' }));
    sections.push(
      new Paragraph({
        children: [
          new TextRun({ text: 'Citations: ', bold: true }),
          new TextRun((section.citations || []).join(', ') || 'none')
        ]
      })
    );
    const gaps = section.gaps || [];
    sections.push(
      new Paragraph({
        children: [
          new TextRun({ text: 'Gaps: ', bold: true }),
          new TextRun(gaps.length > 0 ? gaps.join(' | ') : 'none')
        ]
      })
    );
    sections.push(new Paragraph({ text: '' }));
  }

  sections.push(new Paragraph({ text: 'Compliance Matrix', heading: HeadingLevel.HEADING_1 }));
  for (const row of pkg.complianceMatrix || []) {
    sections.push(
      new Paragraph({
        text: `- [${row.reqType}] ${row.requirementSummary} | status=${row.status}`
      })
    );
  }

  sections.push(new Paragraph({ text: '' }));
  sections.push(new Paragraph({ text: 'Unresolved Gaps', heading: HeadingLevel.HEADING_1 }));
  for (const gap of pkg.unresolvedGaps?.matrix || []) {
    sections.push(new Paragraph({ text: `- Matrix ${gap.reqId}: ${(gap.gaps || []).join(' | ')}` }));
  }
  for (const gap of pkg.unresolvedGaps?.drafts || []) {
    sections.push(new Paragraph({ text: `- ${gap.sectionTitle}: ${gap.gap}` }));
  }

  const doc = new Document({ sections: [{ children: sections }] });
  return Packer.toBuffer(doc);
}

export function buildDocxFilename(pkg) {
  const tenderId = String(pkg?.tender?.tenderId || 'unknown').replace(/[^a-zA-Z0-9-_]/g, '_');
  const date = String(pkg?.generatedAt || new Date().toISOString()).slice(0, 10);
  return `proposal-package-${tenderId}-${date}.docx`;
}

export async function importDocx() {
  try {
    return await import('docx');
  } catch {
    throw new Error('DOCX export requires dependency "docx". Run npm install to add it.');
  }
}
