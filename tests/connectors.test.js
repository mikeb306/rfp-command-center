import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHtmlLinks, parseRss, runConnector } from '../src/lib/connectors.js';

test('parseRss extracts entries', () => {
  const xml = `
    <rss><channel>
      <item><title>City of X - Network Upgrade RFP</title><link>https://example.com/a</link><pubDate>Wed, 11 Feb 2026 12:00:00 GMT</pubDate></item>
      <item><title>Utility Y - Firewall Project</title><link>https://example.com/b</link><pubDate>Wed, 11 Feb 2026 13:00:00 GMT</pubDate></item>
    </channel></rss>
  `;

  const items = parseRss(xml, { id: 'rss1', buyerHint: null, maxItems: 10 });
  assert.equal(items.length, 2);
  assert.equal(items[0].sourceRef.startsWith('rss1:'), true);
});

test('parseHtmlLinks filters by includeRegex and dedupes', () => {
  const html = `
    <a href="/tender/1">RFP - Security Assessment</a>
    <a href="/tender/1">RFP - Security Assessment</a>
    <a href="/news/2">General News</a>
  `;
  const items = parseHtmlLinks(html, {
    id: 'html1',
    includeRegex: 'rfp|tender',
    buyerHint: 'City',
    maxItems: 10
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].buyerName, 'City');
});

test('runConnector persists summary and counts created tenders', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    text: async () =>
      '<rss><channel><item><title>RFP A</title><link>https://example.com/a</link></item></channel></rss>'
  });

  const inserted = [];
  const runs = [];
  const summary = await runConnector({
    connector: {
      id: 'c1',
      name: 'Connector 1',
      active: true,
      type: 'rss',
      sourceSystem: 'sasktenders',
      url: 'https://example.com/rss',
      buyerHint: null,
      maxItems: 5,
      timeoutMs: 3000
    },
    upsertTenderFromConnector: async (item) => {
      inserted.push(item);
      return { created: true };
    },
    addConnectorRun: async (run) => {
      runs.push(run);
    },
    logger: { error: () => {} }
  });

  global.fetch = originalFetch;

  assert.equal(summary.discovered, 1);
  assert.equal(summary.created, 1);
  assert.equal(inserted.length, 1);
  assert.equal(runs.length, 1);
});
