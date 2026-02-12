import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

/**
 * Parse a document buffer and return plain text.
 * Supports PDF, DOCX, XLSX/XLS, TXT, CSV.
 */
export async function parseDocumentBuffer(buffer, filename, mimeType) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  const mime = (mimeType || '').toLowerCase();

  if (mime === 'application/pdf' || ext === 'pdf') {
    const data = new Uint8Array(buffer);
    const parser = new PDFParse(data);
    const result = await parser.getText();
    return result.text || '';
  }

  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  }

  if (
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mime === 'application/vnd.ms-excel' ||
    ext === 'xlsx' ||
    ext === 'xls'
  ) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheets = [];
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      sheets.push(`--- Sheet: ${name} ---\n${csv}`);
    }
    return sheets.join('\n\n');
  }

  // TXT, CSV, or unknown — pass through as-is
  return buffer.toString('utf8');
}
