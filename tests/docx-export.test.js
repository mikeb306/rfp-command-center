import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDocxFilename } from '../src/lib/docx-export.js';

test('buildDocxFilename sanitizes tender id', () => {
  const filename = buildDocxFilename({
    tender: { tenderId: 'abc/123', title: 'x' },
    generatedAt: '2026-02-11T12:00:00.000Z'
  });

  assert.equal(filename.includes('abc_123'), true);
  assert.equal(filename.endsWith('.docx'), true);
});
