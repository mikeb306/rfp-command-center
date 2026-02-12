import { newId } from './schema.js';

export function buildChunksFromDocuments(documents, options = {}) {
  const maxChunkChars = normalizeNumber(options.maxChunkChars, 1200, 300, 4000);
  const overlapChars = normalizeNumber(options.overlapChars, 120, 0, 800);

  const chunks = [];

  for (const doc of documents) {
    const text = (doc.text || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;

    let index = 0;
    let offset = 0;
    while (offset < text.length) {
      const nextOffset = Math.min(text.length, offset + maxChunkChars);
      const chunkText = text.slice(offset, nextOffset).trim();
      if (chunkText) {
        chunks.push({
          chunkId: newId(),
          docId: doc.docId,
          chunkIndex: index,
          chunkText,
          tokenEstimate: estimateTokens(chunkText),
          metadata: {
            sourceFilename: doc.filename,
            offsetStart: offset,
            offsetEnd: nextOffset
          }
        });
      }

      if (nextOffset >= text.length) break;
      offset = Math.max(0, nextOffset - overlapChars);
      index += 1;
    }
  }

  return chunks;
}

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function normalizeNumber(value, fallback, min, max) {
  const num = Number(value);
  if (Number.isNaN(num)) return fallback;
  if (num < min) return min;
  if (num > max) return max;
  return Math.round(num);
}
