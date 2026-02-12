import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocumentBuffer } from '../src/lib/doc-parser.js';

test('parseDocumentBuffer extracts text from plain text buffer', async () => {
  const text = 'Hello world\nThis is a test document.';
  const buffer = Buffer.from(text, 'utf8');
  const result = await parseDocumentBuffer(buffer, 'test.txt', 'text/plain');
  assert.equal(result, text);
});

test('parseDocumentBuffer extracts text from CSV buffer', async () => {
  const csv = 'name,age\nAlice,30\nBob,25';
  const buffer = Buffer.from(csv, 'utf8');
  const result = await parseDocumentBuffer(buffer, 'data.csv', 'text/csv');
  assert.equal(result, csv);
});

test('parseDocumentBuffer handles unknown file type as text', async () => {
  const content = 'some content here';
  const buffer = Buffer.from(content, 'utf8');
  const result = await parseDocumentBuffer(buffer, 'readme.md', 'text/markdown');
  assert.equal(result, content);
});

test('parseDocumentBuffer returns string for XLSX buffer', async () => {
  // Build a minimal XLSX in memory using the xlsx library
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([['Name', 'Value'], ['Server', '10']]);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const result = await parseDocumentBuffer(Buffer.from(buf), 'pricing.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(typeof result, 'string');
  assert.ok(result.includes('Name'));
  assert.ok(result.includes('Server'));
  assert.ok(result.includes('Sheet1'));
});
