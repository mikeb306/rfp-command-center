import test from 'node:test';
import assert from 'node:assert/strict';

// We test the analyzer module by mocking global fetch to return a known response.
// This avoids needing a real OpenAI API key.

test('analyzeRfpDocument parses structured OpenAI response', async () => {
  const mockAnalysis = {
    summary: {
      title: 'Test RFP',
      issuer: 'City of Saskatoon',
      closingDate: '2026-03-15',
      estimatedValue: '$500,000',
      contractType: 'Services',
      contractTerm: '3 years',
      deliveryLocation: 'Saskatoon, SK',
      submissionMethod: 'Email'
    },
    bidNoBid: {
      score: 78,
      recommendation: 'Moderate fit — worth pursuing with targeted strategy',
      fitFactors: [
        { factor: 'Portfolio Alignment', score: 85, rationale: 'Strong match with infrastructure offering' }
      ],
      dealBreakers: []
    },
    evaluationCriteria: [
      { criterion: 'Technical', weight: '40%', maxPoints: '40', notes: 'Highest weighted' }
    ],
    requirements: [
      { reqId: 'REQ-001', reqType: 'mandatory', mustHave: true, statement: 'Must provide 24/7 support', sectionRef: '3.1', confidence: 0.95 }
    ],
    skuList: [
      { category: 'hardware', item: 'Server', quantity: '5', specs: 'HPE DL380', xeroxPortfolioMatch: 'HPE ProLiant DL380', vendorOptions: 'HPE', estimatedUnitCost: '$8,000', notes: 'Standard rack server' }
    ],
    riskLog: [
      { risk: 'Tight timeline', severity: 'medium', category: 'timeline', mitigation: 'Start pre-work early' }
    ],
    responseOutline: [
      { section: 'Executive Summary', pageEstimate: '2', keyPoints: ['Overview'], evidenceNeeded: ['Case study'] }
    ],
    keyDates: [
      { event: 'Submission Deadline', date: '2026-03-15', notes: 'No extensions' }
    ],
    competitiveNotes: 'WBM likely incumbent.',
    saskatchewanCompliance: {
      nwptaApplies: true,
      cftaApplies: true,
      usContentRestrictions: false,
      localPreferenceNotes: 'None detected',
      tradeAgreementNotes: 'Standard NWPTA/CFTA thresholds apply'
    }
  };

  // Save original fetch
  const originalFetch = globalThis.fetch;

  // Mock fetch
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ output_text: JSON.stringify(mockAnalysis) })
  });

  // Set env
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key-mock';

  try {
    const { analyzeRfpDocument } = await import('../src/lib/analyzer.js');
    const result = await analyzeRfpDocument({
      tenderId: 'test-tender-1',
      docId: 'doc-1',
      filename: 'test-rfp.pdf',
      text: 'Sample RFP text about IT infrastructure procurement in Saskatchewan.'
    });

    assert.equal(result.summary.title, 'Test RFP');
    assert.equal(result.bidNoBid.score, 78);
    assert.equal(result.requirements.length, 1);
    assert.equal(result.requirements[0].reqType, 'mandatory');
    assert.equal(result.skuList.length, 1);
    assert.equal(result.skuList[0].category, 'hardware');
    assert.equal(result.riskLog.length, 1);
    assert.equal(result.saskatchewanCompliance.nwptaApplies, true);
    assert.equal(result.competitiveNotes, 'WBM likely incumbent.');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey !== undefined) {
      process.env.OPENAI_API_KEY = originalKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  }
});

test('analyzeRfpDocument throws when no API key set', async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  try {
    // Re-import to get a fresh module
    const mod = await import('../src/lib/analyzer.js');
    await assert.rejects(
      () => mod.analyzeRfpDocument({ tenderId: 't', docId: 'd', filename: 'f', text: 'x' }),
      { message: 'OPENAI_API_KEY is not set' }
    );
  } finally {
    if (originalKey !== undefined) {
      process.env.OPENAI_API_KEY = originalKey;
    }
  }
});
