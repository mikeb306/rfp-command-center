import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChunksFromDocuments } from '../src/lib/chunks.js';

test('buildChunksFromDocuments creates chunk records with metadata', () => {
  const docs = [
    {
      docId: 'doc-1',
      filename: 'main-rfp.txt',
      text: 'A'.repeat(1500)
    }
  ];

  const chunks = buildChunksFromDocuments(docs, {
    maxChunkChars: 700,
    overlapChars: 100
  });

  assert.equal(chunks.length >= 2, true);
  assert.equal(chunks[0].docId, 'doc-1');
  assert.equal(typeof chunks[0].metadata.offsetStart, 'number');
  assert.equal(typeof chunks[0].tokenEstimate, 'number');
});
