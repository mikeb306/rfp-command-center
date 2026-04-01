import { readDb, writeDb } from './store-json.js';
import crypto from 'node:crypto';

export async function listResponseTemplates(filters = {}) {
  const db = await readDb();
  let templates = db.responseTemplates || [];

  if (filters.category) {
    templates = templates.filter(t => t.category === filters.category);
  }
  if (filters.search) {
    const s = filters.search.toLowerCase();
    templates = templates.filter(t =>
      t.title.toLowerCase().includes(s) ||
      t.content.toLowerCase().includes(s) ||
      t.tags.some(tag => tag.toLowerCase().includes(s))
    );
  }

  return templates;
}

export async function addResponseTemplate({ title, category, content, tags = [] }) {
  const db = await readDb();
  if (!db.responseTemplates) db.responseTemplates = [];

  const template = {
    id: crypto.randomUUID(),
    title,
    category, // exec_summary, technical, security, experience, pricing, compliance
    content,
    tags,
    approved: false,
    usageCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  db.responseTemplates.push(template);
  await writeDb(db);
  return template;
}

export async function getResponseTemplate(id) {
  const db = await readDb();
  return (db.responseTemplates || []).find(t => t.id === id) || null;
}

export async function updateResponseTemplate(id, updates) {
  const db = await readDb();
  if (!db.responseTemplates) return null;
  const idx = db.responseTemplates.findIndex(t => t.id === id);
  if (idx === -1) return null;

  db.responseTemplates[idx] = {
    ...db.responseTemplates[idx],
    ...updates,
    updatedAt: new Date().toISOString()
  };

  await writeDb(db);
  return db.responseTemplates[idx];
}

export async function deleteResponseTemplate(id) {
  const db = await readDb();
  if (!db.responseTemplates) return false;
  const idx = db.responseTemplates.findIndex(t => t.id === id);
  if (idx === -1) return false;
  db.responseTemplates.splice(idx, 1);
  await writeDb(db);
  return true;
}

export async function incrementUsage(id) {
  const db = await readDb();
  if (!db.responseTemplates) return;
  const t = db.responseTemplates.find(t => t.id === id);
  if (t) {
    t.usageCount = (t.usageCount || 0) + 1;
    t.lastUsed = new Date().toISOString();
    await writeDb(db);
  }
}

export async function findSimilarTemplates(text, limit = 5) {
  const db = await readDb();
  const templates = db.responseTemplates || [];
  if (!templates.length) return [];

  // Simple keyword matching (vector embeddings can be added later)
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const scored = templates.map(t => {
    const tWords = (t.title + ' ' + t.content + ' ' + t.tags.join(' ')).toLowerCase();
    const matches = words.filter(w => tWords.includes(w)).length;
    return { ...t, relevance: matches / Math.max(words.length, 1) };
  });

  return scored
    .filter(t => t.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, limit);
}
