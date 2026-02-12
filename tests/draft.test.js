import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGroundedDraft } from '../src/lib/draft.js';

test('buildGroundedDraft fallback returns citations and draft text', async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const result = await buildGroundedDraft({
    tender: { tenderId: 't1', title: 'Test Tender' },
    sectionTitle: 'Technical Approach',
    query: 'security controls',
    requirements: [
      { reqId: 'r1', reqType: 'security', mustHave: true, statement: 'Must provide MFA.' },
      { reqId: 'r2', reqType: 'pricing', mustHave: false, statement: 'Include rate card.' }
    ],
    chunks: [
      { chunkId: 'c1', chunkText: 'Security controls include MFA and encryption at rest.' },
      { chunkId: 'c2', chunkText: 'Service levels require 99.9% uptime.' }
    ]
  });

  if (previous) process.env.OPENAI_API_KEY = previous;

  assert.equal(result.provider, 'fallback');
  assert.equal(result.citations.length, 2);
  assert.equal(result.draft.includes('Technical Approach'), true);
  assert.equal(result.gaps.some((gap) => gap.includes('Pricing assumptions')), true);
});
