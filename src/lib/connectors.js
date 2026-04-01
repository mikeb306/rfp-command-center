import fs from 'node:fs/promises';
import path from 'node:path';
import { newId, nowIso } from './schema.js';

const CONNECTOR_CONFIG_PATH = path.resolve(process.cwd(), 'data', 'connectors.json');

export async function loadConnectorsConfig() {
  try {
    const raw = await fs.readFile(CONNECTOR_CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const connectors = Array.isArray(parsed?.connectors) ? parsed.connectors : [];
    return connectors.map(normalizeConnector);
  } catch {
    return [];
  }
}

export async function runAllConnectors({ upsertTenderFromConnector, addConnectorRun, logger = console }) {
  const connectors = await loadConnectorsConfig();
  const active = connectors.filter((connector) => connector.active);
  const summaries = [];

  for (const connector of active) {
    const summary = await runConnector({ connector, upsertTenderFromConnector, addConnectorRun, logger });
    summaries.push(summary);
  }

  return {
    connectorCount: active.length,
    runCount: summaries.length,
    discovered: summaries.reduce((sum, item) => sum + item.discovered, 0),
    created: summaries.reduce((sum, item) => sum + item.created, 0),
    summaries
  };
}

export async function runConnector({ connector, upsertTenderFromConnector, addConnectorRun, logger = console }) {
  const startedAt = nowIso();
  const runId = newId();
  const errors = [];

  let discoveredItems = [];
  try {
    discoveredItems = await discoverFromConnector(connector);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    logger.error('connector discovery failed', connector.id, error);
  }

  let created = 0;
  for (const item of discoveredItems) {
    try {
      const result = await upsertTenderFromConnector({
        title: item.title,
        buyerName: item.buyerName,
        sourceSystem: connector.sourceSystem,
        sourceRef: item.sourceRef,
        status: item.status || 'open',
        postedAt: item.postedAt || null,
        closesAt: item.closesAt || null,
        accessTermsNote:
          'No redistribution; use only for preparing competition responses. (ingested via connector)'
      });
      if (result?.created) created += 1;
    } catch (error) {
      errors.push(`upsert failed for ${item.sourceRef}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const finishedAt = nowIso();
  const run = {
    runId,
    connectorId: connector.id,
    connectorName: connector.name,
    sourceSystem: connector.sourceSystem,
    status: errors.length > 0 ? 'error' : 'ok',
    discovered: discoveredItems.length,
    created,
    errors,
    startedAt,
    finishedAt
  };

  await addConnectorRun(run);
  return run;
}

async function discoverFromConnector(connector) {
  const htmlOrXml = await fetchText(connector.url, connector.timeoutMs);
  if (connector.type === 'rss') {
    return parseRss(htmlOrXml, connector);
  }
  if (connector.type === 'html') {
    return parseHtmlLinks(htmlOrXml, connector);
  }
  throw new Error(`Unsupported connector type: ${connector.type}`);
}

export function parseRss(xml, connector) {
  const items = [];
  const blocks = matchAll(xml, /<item\b[\s\S]*?<\/item>/gi);
  for (const block of blocks) {
    const title = decodeXml(firstMatch(block, /<title>([\s\S]*?)<\/title>/i) || '').trim();
    const link = decodeXml(firstMatch(block, /<link>([\s\S]*?)<\/link>/i) || '').trim();
    const pubDate = decodeXml(firstMatch(block, /<pubDate>([\s\S]*?)<\/pubDate>/i) || '').trim();
    if (!title || !link) continue;
    items.push({
      title,
      sourceRef: computeSourceRef(connector, link, title),
      buyerName: inferBuyer(title, connector.buyerHint),
      postedAt: toIsoOrNull(pubDate),
      closesAt: null,
      status: 'open'
    });
  }
  return items.slice(0, connector.maxItems);
}

export function parseHtmlLinks(html, connector) {
  const items = [];
  const anchors = matchAll(html, /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);
  for (const anchor of anchors) {
    const href = anchor.match(/href=["']([^"']+)["']/i)?.[1] || '';
    const text = stripTags(anchor.replace(/<a\b[^>]*>|<\/a>/gi, '')).trim();
    if (!href || !text) continue;
    if (connector.includeRegex) {
      const re = new RegExp(connector.includeRegex, 'i');
      if (!re.test(text) && !re.test(href)) continue;
    }
    items.push({
      title: text,
      sourceRef: computeSourceRef(connector, href, text),
      buyerName: inferBuyer(text, connector.buyerHint),
      postedAt: null,
      closesAt: null,
      status: 'open'
    });
  }
  return dedupeItems(items).slice(0, connector.maxItems);
}

function normalizeConnector(input) {
  return {
    id: String(input.id || '').trim(),
    name: String(input.name || input.id || 'connector').trim(),
    active: Boolean(input.active),
    type: input.type === 'html' ? 'html' : 'rss',
    sourceSystem: String(input.sourceSystem || 'other').trim(),
    url: String(input.url || '').trim(),
    includeRegex: input.includeRegex ? String(input.includeRegex) : null,
    buyerHint: input.buyerHint ? String(input.buyerHint) : null,
    maxItems: clamp(input.maxItems, 25, 1, 100),
    timeoutMs: clamp(input.timeoutMs, 15000, 1000, 60000)
  };
}

async function fetchText(url, timeoutMs = 15000) {
  if (!url) throw new Error('Connector URL is missing.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'XeroxITS-RFP-Connector/1.0'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return response.text();
  } finally {
    clearTimeout(timer);
  }
}

function computeSourceRef(connector, link, title) {
  const base = `${connector.id}:${link || title}`;
  return base.slice(0, 280);
}

function inferBuyer(title, hint) {
  if (hint) return hint;
  const parts = title.split('-').map((x) => x.trim()).filter(Boolean);
  return parts.length > 1 ? parts[0] : null;
}

function toIsoOrNull(value) {
  const ms = Date.parse(value || '');
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

function decodeXml(value) {
  return String(value || '')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

function stripTags(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ');
}

function matchAll(text, regex) {
  return [...String(text || '').matchAll(regex)].map((m) => m[0]);
}

function firstMatch(text, regex) {
  const m = String(text || '').match(regex);
  return m?.[1] || null;
}

function dedupeItems(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (seen.has(item.sourceRef)) continue;
    seen.add(item.sourceRef);
    out.push(item);
  }
  return out;
}

function clamp(value, fallback, min, max) {
  const num = Number(value);
  if (Number.isNaN(num)) return fallback;
  if (num < min) return min;
  if (num > max) return max;
  return Math.round(num);
}
