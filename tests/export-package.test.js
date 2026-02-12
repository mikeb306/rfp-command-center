import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProposalPackage, defaultExportSections } from '../src/lib/export-package.js';

test('buildProposalPackage composes unresolved gaps and citations', () => {
  const pkg = buildProposalPackage({
    tender: {
      tenderId: 't1',
      title: 'RFP 001',
      sourceSystem: 'sasktenders',
      sourceRef: 'ABC-1',
      closesAt: null
    },
    gates: {
      bidNoBid: { status: 'approved' },
      requirementMap: { status: 'pending' },
      pricingLegal: { status: 'pending' }
    },
    sectionWorkflow: {
      executive_summary: { status: 'approved' }
    },
    matrix: [
      { reqId: 'r1', reqType: 'mandatory', status: 'needs-evidence', gaps: ['Need evidence'] },
      { reqId: 'r2', reqType: 'pricing', status: 'draft-ready', gaps: [] }
    ],
    drafts: [
      { sectionTitle: 'Executive Summary', citations: ['c1', 'c2'], gaps: ['Need KPI proof'] }
    ],
    evidenceAssets: [
      { evidenceId: 'e1', title: 'Case Study', reqTypes: ['security'], uri: 'https://example.com/e1' }
    ],
    auditEvents: [{ eventId: 'e1' }]
  });

  assert.equal(pkg.complianceMatrix.length, 2);
  assert.equal(pkg.citations[0].citationChunkIds.length, 2);
  assert.equal(pkg.unresolvedGaps.matrix.length, 1);
  assert.equal(pkg.unresolvedGaps.drafts.length, 1);
  assert.equal(pkg.evidenceCatalog.length, 1);
  assert.equal(pkg.sectionWorkflow.executive_summary.status, 'approved');
});

test('defaultExportSections has at least three sections', () => {
  const sections = defaultExportSections();
  assert.equal(sections.length >= 3, true);
});
