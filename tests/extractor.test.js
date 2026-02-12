import test from 'node:test';
import assert from 'node:assert/strict';
import { extractRequirementsHeuristic } from '../src/lib/extractor.js';

test('extractRequirementsHeuristic identifies mandatory and security lines', () => {
  const docs = [
    {
      docId: 'doc-1',
      filename: 'rfp.txt',
      text: [
        'The proponent must submit references from three similar projects.',
        'Security controls must include MFA and encryption at rest.',
        'This sentence should not be picked up.'
      ].join('\n')
    }
  ];

  const requirements = extractRequirementsHeuristic(docs);
  assert.equal(requirements.length, 2);
  assert.equal(requirements[0].mustHave, true);
  assert.equal(requirements[1].reqType, 'security');
});
