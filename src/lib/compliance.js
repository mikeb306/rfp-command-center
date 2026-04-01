import { matchEvidenceForRequirement } from './evidence.js';

export function buildComplianceMatrix(requirements, evidenceAssets = []) {
  return requirements.map((req) => ({
    ...buildRow(req, evidenceAssets)
  }));
}

function buildRow(req, evidenceAssets) {
  const matches = matchEvidenceForRequirement(req, evidenceAssets, 3);
  const evidenceIds = matches.map((match) => match.evidenceId);
  const needsEvidence = req.mustHave && evidenceIds.length === 0;
  return {
    reqId: req.reqId,
    reqType: req.reqType,
    mustHave: req.mustHave,
    requirementSummary: req.statement,
    responseSummary: suggestResponse(req),
    evidenceIds,
    status: needsEvidence ? 'needs-evidence' : 'draft-ready',
    gaps: needsEvidence ? ['Attach internal evidence_id or mark exception.'] : []
  };
}

function suggestResponse(req) {
  if (req.reqType === 'security') {
    return 'Xerox IT Solutions will provide a security controls matrix aligned to the RFP security section.';
  }
  if (req.reqType === 'pricing') {
    return 'Pricing table to be completed using approved rate card and assumptions.';
  }
  if (req.reqType === 'timeline') {
    return 'Delivery plan will map milestones to requested closing and implementation windows.';
  }
  return 'Draft response prepared; pending SME validation and evidence links.';
}
