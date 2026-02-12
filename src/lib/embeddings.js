const EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';

export async function createEmbedding(text) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !text) return null;

  const response = await fetch(EMBEDDINGS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small',
      input: text
    })
  });

  if (!response.ok) {
    throw new Error(`Embedding API error: ${response.status}`);
  }

  const payload = await response.json();
  const vector = payload?.data?.[0]?.embedding;
  return Array.isArray(vector) ? vector : null;
}

export async function embedChunks(chunks) {
  const vectors = [];
  for (const chunk of chunks) {
    try {
      const embedding = await createEmbedding(chunk.chunkText);
      vectors.push({
        ...chunk,
        embedding
      });
    } catch {
      vectors.push({
        ...chunk,
        embedding: null
      });
    }
  }
  return vectors;
}
