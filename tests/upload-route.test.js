import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocumentBuffer } from '../src/lib/doc-parser.js';

test('upload route: parseDocumentBuffer returns text for supported types', async () => {
  // Simulate what the upload route does — parse a buffer and get text back
  const txtBuffer = Buffer.from('Request for Proposal\nSection 1: Requirements\nMust provide 24/7 support.', 'utf8');
  const result = await parseDocumentBuffer(txtBuffer, 'rfp.txt', 'text/plain');
  assert.equal(typeof result, 'string');
  assert.ok(result.includes('Request for Proposal'));
  assert.ok(result.includes('24/7 support'));
  assert.ok(result.length > 0);
});

test('upload route: parseDocumentBuffer handles empty buffer gracefully', async () => {
  const emptyBuffer = Buffer.from('', 'utf8');
  const result = await parseDocumentBuffer(emptyBuffer, 'empty.txt', 'text/plain');
  assert.equal(result, '');
});

test('upload route: parseDocumentBuffer detects file type from extension when mimeType is generic', async () => {
  const csvContent = 'item,qty,cost\nServer,5,8000\nSwitch,10,2000';
  const buffer = Buffer.from(csvContent, 'utf8');
  const result = await parseDocumentBuffer(buffer, 'pricing.csv', 'application/octet-stream');
  assert.ok(result.includes('Server'));
  assert.ok(result.includes('Switch'));
});
