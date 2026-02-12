import { nowIso } from './schema.js';

export function buildProposalPackage({
  tender,
  matrix,
  drafts,
  gates,
  sectionWorkflow = {},
  auditEvents,
  evidenceAssets = []
}) {
  const unresolvedMatrixGaps = matrix
    .filter((row) => row.status !== 'draft-ready' || (Array.isArray(row.gaps) && row.gaps.length > 0))
    .map((row) => ({
      reqId: row.reqId,
      reqType: row.reqType,
      gaps: row.gaps || []
    }));

  const unresolvedDraftGaps = drafts.flatMap((draft) =>
    (draft.gaps || []).map((gap) => ({
      sectionTitle: draft.sectionTitle,
      gap
    }))
  );

  const citationIndex = drafts.map((draft) => ({
    sectionTitle: draft.sectionTitle,
    citationChunkIds: draft.citations || []
  }));

  return {
    packageVersion: '1.0',
    generatedAt: nowIso(),
    tender: {
      tenderId: tender.tenderId,
      title: tender.title,
      sourceSystem: tender.sourceSystem,
      sourceRef: tender.sourceRef,
      closesAt: tender.closesAt || null
    },
    gates,
    sectionWorkflow,
    evidenceCatalog: evidenceAssets.map((asset) => ({
      evidenceId: asset.evidenceId,
      title: asset.title,
      reqTypes: asset.reqTypes || [],
      uri: asset.uri || null
    })),
    complianceMatrix: matrix,
    sections: drafts,
    citations: citationIndex,
    unresolvedGaps: {
      matrix: unresolvedMatrixGaps,
      drafts: unresolvedDraftGaps
    },
    auditTrailSnapshot: (auditEvents || []).slice(0, 50)
  };
}

export function defaultExportSections() {
  return [
    { sectionTitle: 'Executive Summary', query: 'project outcomes and buyer goals', topK: 6 },
    { sectionTitle: 'Technical Approach', query: 'scope deliverables and methodology', topK: 8 },
    { sectionTitle: 'Security and Privacy', query: 'security privacy compliance controls', topK: 8 },
    { sectionTitle: 'Work Plan', query: 'timeline milestones implementation plan', topK: 6 },
    { sectionTitle: 'Pricing Assumptions', query: 'pricing rates assumptions optional services', topK: 6 }
  ];
}
