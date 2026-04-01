import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addDocument,
  addConnectorRun,
  addEvidenceAsset,
  createTender,
  deleteTender,
  getTenderById,
  getTenderSections,
  listAuditEvents,
  listConnectorRuns,
  listEvidenceAssets,
  listTenders,
  replaceTenderChunks,
  replaceRequirements,
  searchTenderChunks,
  backfillTenderAuditChain,
  updateTenderSection,
  updateTenderStatus,
  upsertTenderFromConnector,
  verifyTenderAuditChain,
  updateTenderGate,
  saveTenderAnalysis,
  getTenderAnalysis
} from './lib/store.js';
import { parseDocumentBuffer } from './lib/doc-parser.js';
import { analyzeRfpDocument, computeWeightedScore } from './lib/analyzer.js';
import { multiPassAnalyze } from './lib/multi-pass-analyzer.js';
import { listResponseTemplates, addResponseTemplate, getResponseTemplate, updateResponseTemplate, deleteResponseTemplate, findSimilarTemplates, incrementUsage } from './lib/content-library.js';
import Busboy from 'busboy';
import { buildComplianceMatrix } from './lib/compliance.js';
import { extractRequirementsForTender } from './lib/extractor.js';
import { validateDocumentInput, validateTenderInput } from './lib/schema.js';
import { GATE_KEYS, validateGateUpdate } from './lib/gates.js';
import { buildChunksFromDocuments } from './lib/chunks.js';
import { createEmbedding, embedChunks } from './lib/embeddings.js';
import { buildGroundedDraft } from './lib/draft.js';
import { answerQuestionWithOpenAI } from './lib/openai.js';
import { buildProposalPackage, defaultExportSections } from './lib/export-package.js';
import { buildDocxFilename, buildProposalDocxBuffer } from './lib/docx-export.js';
import { loadConnectorsConfig, runAllConnectors } from './lib/connectors.js';
import { normalizeEvidenceInput, validateEvidenceInput } from './lib/evidence.js';
import { createSecurityControls, hasRequiredRole } from './lib/security.js';
import {
  defaultSectionWorkflow,
  evaluateSectionExportGate,
  normalizeSectionWorkflow,
  validateSectionUpdate
} from './lib/sections.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 4310);
const security = createSecurityControls();

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) return sendJson(res, 400, { error: 'Missing URL' });
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith('/api/')) {
      return await routeApi(req, res, url);
    }

    return await routeStatic(req, res, url.pathname);
  } catch (error) {
    return sendJson(res, 500, {
      error: 'Unexpected server error',
      detail: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(PORT, () => {
  console.log(`RFP app listening on http://localhost:${PORT}`);
});
startConnectorScheduler();

async function routeApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return sendJson(res, 200, { ok: true });
  }

  const auth = security.authenticateRequest(req);
  if (!auth.ok) {
    return sendJson(res, auth.status || 401, { error: auth.error || 'Unauthorized' });
  }

  const limitState = security.rateLimit(req, auth);
  if (limitState.limited) {
    return sendJson(res, 429, {
      error: 'Rate limit exceeded.',
      retryAfterSec: limitState.retryAfterSec
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/whoami') {
    return sendJson(res, 200, {
      role: auth.role,
      userName: auth.userName
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/tenders') {
    const tenders = await listTenders();
    return sendJson(res, 200, { tenders });
  }

  if (req.method === 'GET' && url.pathname === '/api/evidence') {
    const evidenceAssets = await listEvidenceAssets();
    return sendJson(res, 200, { evidenceAssets });
  }

  if (req.method === 'POST' && url.pathname === '/api/evidence') {
    if (!enforceRole(res, auth, ['editor'])) return;
    const payload = await readJson(req);
    const errors = validateEvidenceInput(payload);
    if (errors.length > 0) return sendJson(res, 400, { errors });
    const asset = normalizeEvidenceInput(payload);
    const saved = await addEvidenceAsset(asset);
    return sendJson(res, 201, { evidenceAsset: saved });
  }

  if (req.method === 'GET' && url.pathname === '/api/connectors') {
    const connectors = await loadConnectorsConfig();
    return sendJson(res, 200, { connectors });
  }

  if (req.method === 'GET' && url.pathname === '/api/connectors/runs') {
    const limit = Number(url.searchParams.get('limit') || 30);
    const runs = await listConnectorRuns(limit);
    return sendJson(res, 200, { runs });
  }

  if (req.method === 'POST' && url.pathname === '/api/connectors/run') {
    if (!enforceRole(res, auth, ['reviewer'])) return;
    const summary = await runAllConnectors({
      upsertTenderFromConnector,
      addConnectorRun,
      logger: console
    });
    return sendJson(res, 200, summary);
  }

  if (req.method === 'POST' && url.pathname === '/api/tenders') {
    if (!enforceRole(res, auth, ['editor'])) return;
    const payload = await readJson(req);
    const errors = validateTenderInput(payload);
    if (errors.length > 0) return sendJson(res, 400, { errors });
    const tender = await createTender(payload);
    return sendJson(res, 201, { tender });
  }

  const tenderIdMatch = url.pathname.match(/^\/api\/tenders\/([a-zA-Z0-9-]+)$/);

  if (req.method === 'DELETE' && tenderIdMatch) {
    if (!enforceRole(res, auth, ['editor'])) return;
    const result = await deleteTender(tenderIdMatch[1]);
    if (!result) return sendJson(res, 404, { error: 'Tender not found' });
    return sendJson(res, 200, { deleted: true });
  }

  if (req.method === 'PATCH' && tenderIdMatch) {
    if (!enforceRole(res, auth, ['editor'])) return;
    const payload = await readJson(req);
    const validStatuses = ['open', 'archived', 'won', 'lost', 'no-bid'];
    if (!payload.status || !validStatuses.includes(payload.status)) {
      return sendJson(res, 400, { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }
    const updated = await updateTenderStatus(tenderIdMatch[1], payload.status);
    if (!updated) return sendJson(res, 404, { error: 'Tender not found' });

    // Sync status change to Hub v2
    syncToHubV2(tenderIdMatch[1], payload.status, updated).catch(() => {});

    return sendJson(res, 200, { tender: updated });
  }

  if (req.method === 'GET' && tenderIdMatch) {
    const detail = await getTenderById(tenderIdMatch[1]);
    if (!detail) return sendJson(res, 404, { error: 'Tender not found' });
    return sendJson(res, 200, detail);
  }

  const addDocMatch = url.pathname.match(/^\/api\/tenders\/([a-zA-Z0-9-]+)\/documents$/);
  if (req.method === 'POST' && addDocMatch) {
    if (!enforceRole(res, auth, ['editor'])) return;
    const payload = await readJson(req);
    const errors = validateDocumentInput(payload);
    if (errors.length > 0) return sendJson(res, 400, { errors });

    const doc = await addDocument(addDocMatch[1], payload);
    if (!doc) return sendJson(res, 404, { error: 'Tender not found' });
    return sendJson(res, 201, { document: doc });
  }

  const extractMatch = url.pathname.match(/^\/api\/tenders\/([a-zA-Z0-9-]+)\/extract$/);
  if (req.method === 'POST' && extractMatch) {
    if (!enforceRole(res, auth, ['editor'])) return;
    const detail = await getTenderById(extractMatch[1]);
    if (!detail) return sendJson(res, 404, { error: 'Tender not found' });
    if (detail.documents.length === 0) {
      return sendJson(res, 400, { error: 'At least one document is required before extraction.' });
    }

    const result = await extractRequirementsForTender({
      tenderId: extractMatch[1],
      documents: detail.documents
    });
    const requirements = await replaceRequirements(extractMatch[1], result.requirements, {
      provider: result.provider
    });

    return sendJson(res, 200, {
      provider: result.provider,
      requirementCount: requirements.length,
      requirements
    });
  }

  const matrixMatch = url.pathname.match(/^\/api\/tenders\/([a-zA-Z0-9-]+)\/matrix$/);
  if (req.method === 'GET' && matrixMatch) {
    const detail = await getTenderById(matrixMatch[1]);
    if (!detail) return sendJson(res, 404, { error: 'Tender not found' });
    const evidenceAssets = await listEvidenceAssets();
    const matrix = buildComplianceMatrix(detail.requirements, evidenceAssets);
    return sendJson(res, 200, { matrix });
  }

  const auditMatch = url.pathname.match(/^\/api\/tenders\/([a-zA-Z0-9-]+)\/audit$/);
  if (req.method === 'GET' && auditMatch) {
    const auditEvents = await listAuditEvents(auditMatch[1]);
    return sendJson(res, 200, { auditEvents });
  }

  const auditVerifyMatch = url.pathname.match(/^\/api\/tenders\/([a-zA-Z0-9-]+)\/audit\/verify$/);
  if (req.method === 'GET' && auditVerifyMatch) {
    const result = await verifyTenderAuditChain(auditVerifyMatch[1]);
    return sendJson(res, 200, result);
  }

  const auditResignMatch = url.pathname.match(/^\/api\/tenders\/([a-zA-Z0-9-]+)\/audit\/resign$/);
  if (req.method === 'POST' && auditResignMatch) {
    if (!enforceRole(res, auth, ['admin'])) return;
    const payload = await readJson(req);
    try {
      const result = await backfillTenderAuditChain(auditResignMatch[1], {
        forceRewrite: Boolean(payload.forceRewrite)
      });
      return sendJson(res, 200, result);
    } catch (error) {
      return sendJson(res, 400, {
        error: error instanceof Error ? error.message : 'Failed to re-sign audit chain.'
      });
    }
  }

  const gatesMatch = url.pathname.match(/^\/api\/tenders\/([a-zA-Z0-9-]+)\/gates$/);
  if (req.method === 'GET' && gatesMatch) {
    const detail = await getTenderById(gatesMatch[1]);
    if (!detail) return sendJson(res, 404, { error: 'Tender not found' });
    return sendJson(res, 200, { gates: detail.gates });
  }

  const sectionsMatch = url.pathname.match(/^\/api\/tenders\/([a-zA-Z0-9-]+)\/sections$/);
  if (req.method === 'GET' && sectionsMatch) {
    const sections = await getTenderSections(sectionsMatch[1]);
    if (!sections) return sendJson(res, 404, { error: 'Tender not found' });
    return sendJson(res, 200, { sectionWorkflow: sections });
  }

  const sectionUpdateMatch = url.pathname.match(
    /^\/api\/tenders\/([a-zA-Z0-9-]+)\/sections\/([a-zA-Z0-9_]+)$/
  );
  if (req.method === 'POST' && sectionUpdateMatch) {
    if (!enforceRole(res, auth, ['reviewer'])) return;
    const payload = await readJson(req);
    const errors = validateSectionUpdate(payload);
    if (errors.length > 0) return sendJson(res, 400, { errors });
    const result = await updateTenderSection(sectionUpdateMatch[1], sectionUpdateMatch[2], payload);
    if (!result) return sendJson(res, 404, { error: 'Tender or section not found' });
    return sendJson(res, 200, result);
  }

  const gateUpdateMatch = url.pathname.match(/^\/api\/tenders\/([a-zA-Z0-9-]+)\/gates\/([a-zA-Z0-9_]+)$/);
  if (req.method === 'POST' && gateUpdateMatch) {
    if (!enforceRole(res, auth, ['reviewer'])) return;
    const gateKey = gateUpdateMatch[2];
    if (!GATE_KEYS.includes(gateKey)) {
      return sendJson(res, 400, { error: `Unknown gate key: ${gateKey}` });
    }
    const payload = await readJson(req);
    const errors = validateGateUpdate(payload);
    if (errors.length > 0) return sendJson(res, 400, { errors });

    const result = await updateTenderGate(gateUpdateMatch[1], gateKey, payload);
    if (!result) return sendJson(res, 404, { error: 'Tender not found' });
    return sendJson(res, 200, result);
  }

  const indexMatch = url.pathname.match(/^\/api\/tenders\/([a-zA-Z0-9-]+)\/index$/);
  if (req.method === 'POST' && indexMatch) {
    if (!enforceRole(res, auth, ['editor'])) return;
    const tenderId = indexMatch[1];
    const detail = await getTenderById(tenderId);
    if (!detail) return sendJson(res, 404, { error: 'Tender not found' });
    if (detail.documents.length === 0) {
      return sendJson(res, 400, { error: 'At least one document is required before indexing.' });
    }

    const payload = await readJson(req);
    const chunks = buildChunksFromDocuments(detail.documents, payload);
    const withEmbeddings = await embedChunks(chunks);
    const persisted = await replaceTenderChunks(tenderId, withEmbeddings, {
      embeddingProvider: process.env.OPENAI_API_KEY ? 'openai' : 'none'
    });

    return sendJson(res, 200, {
      chunkCount: persisted.length,
      embeddedCount: persisted.filter((chunk) => Array.isArray(chunk.embedding)).length
    });
  }

  const searchMatch = url.pathname.match(/^\/api\/tenders\/([a-zA-Z0-9-]+)\/search$/);
  if (req.method === 'GET' && searchMatch) {
    const tenderId = searchMatch[1];
    const query = (url.searchParams.get('q') || '').trim();
    if (!query) return sendJson(res, 400, { error: 'Query parameter q is required.' });
    const limit = Number(url.searchParams.get('limit') || 5);

    let queryEmbedding = null;
    try {
      queryEmbedding = await createEmbedding(query);
    } catch {
      queryEmbedding = null;
    }

    const results = await searchTenderChunks(tenderId, query, { limit, queryEmbedding });
    return sendJson(res, 200, {
      mode: queryEmbedding ? 'vector' : 'keyword',
      results
    });
  }

  const draftMatch = url.pathname.match(/^\/api\/tenders\/([a-zA-Z0-9-]+)\/draft$/);
  if (req.method === 'POST' && draftMatch) {
    if (!enforceRole(res, auth, ['editor'])) return;
    const tenderId = draftMatch[1];
    const detail = await getTenderById(tenderId);
    if (!detail) return sendJson(res, 404, { error: 'Tender not found' });

    const payload = await readJson(req);
    const sectionTitle = String(payload.sectionTitle || 'Approach').trim();
    const query = String(payload.query || sectionTitle).trim();
    const topK = Math.min(20, Math.max(1, Number(payload.topK || 6)));

    let queryEmbedding = null;
    try {
      queryEmbedding = await createEmbedding(query);
    } catch {
      queryEmbedding = null;
    }

    const chunks = await searchTenderChunks(tenderId, query, { limit: topK, queryEmbedding });
    const evidenceAssets = await listEvidenceAssets();
    const draft = await buildGroundedDraft({
      tender: detail.tender,
      sectionTitle,
      query,
      requirements: detail.requirements,
      chunks,
      evidenceAssets
    });

    return sendJson(res, 200, {
      mode: queryEmbedding ? 'vector' : 'keyword',
      ...draft
    });
  }

  // SKU Catalog — list all products
  if (req.method === 'GET' && url.pathname === '/api/catalog') {
    try {
      const catalogPath = path.join(import.meta.dirname, '..', 'data', 'product-catalog.json');
      const raw = await fs.readFile(catalogPath, 'utf8');
      return sendJson(res, 200, JSON.parse(raw));
    } catch (err) {
      return sendJson(res, 500, { error: 'Catalog not found: ' + err.message });
    }
  }

  // SKU Match — find products matching RFP requirements
  const skuMatchRoute = url.pathname.match(/^\/api\/tenders\/([a-zA-Z0-9-]+)\/sku-match$/);
  if (req.method === 'POST' && skuMatchRoute) {
    const tenderId = skuMatchRoute[1];
    const detail = await getTenderById(tenderId);
    if (!detail) return sendJson(res, 404, { error: 'Tender not found' });

    const payload = await readJson(req);
    const query = String(payload.query || '').trim();

    // Load catalog
    let catalog;
    try {
      const catalogPath = path.join(import.meta.dirname, '..', 'data', 'product-catalog.json');
      catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
    } catch {
      return sendJson(res, 500, { error: 'Product catalog not found' });
    }

    // Flatten all products
    const allProducts = [];
    for (const [catKey, cat] of Object.entries(catalog.categories)) {
      for (const p of cat.products) {
        allProducts.push({ ...p, category: catKey, categoryLabel: cat.label });
      }
    }

    // Get SKU list from analysis if available
    const analysis = detail.analysis || {};
    const skuList = analysis.skuList || [];

    // If query provided, use AI to match; otherwise match from existing SKU list
    if (query || skuList.length > 0) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        // Fallback: keyword matching
        const searchTerms = query ? query.toLowerCase().split(/\s+/) : skuList.map(s => (s.item || '').toLowerCase());
        const matches = allProducts.filter(p => {
          const searchable = `${p.name} ${p.type} ${p.specs} ${p.tags.join(' ')} ${p.vendor}`.toLowerCase();
          return searchTerms.some(term => searchable.includes(term));
        });
        return sendJson(res, 200, { mode: 'keyword', query, matches: matches.slice(0, 20) });
      }

      // AI-powered matching
      try {
        const matchPrompt = query
          ? `Find products from this catalog that match: "${query}"`
          : `Match products from this catalog to these RFP requirements:\n${skuList.map(s => `- ${s.item}: ${s.specs || ''} (qty: ${s.quantity || 'TBD'})`).join('\n')}`;

        const body = {
          model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
          input: [
            { role: 'system', content: 'You are a Xerox IT Solutions product specialist. Given RFP requirements and a product catalog, return the best matching SKUs as a JSON array of objects with: sku, name, reason (why it matches), confidence (high/medium/low). Return ONLY valid JSON array, no other text.' },
            { role: 'user', content: [{ type: 'input_text', text: JSON.stringify({ instruction: matchPrompt, catalog: allProducts.map(p => ({ sku: p.sku, vendor: p.vendor, name: p.name, type: p.type, specs: p.specs, category: p.categoryLabel, listPrice: p.listPrice })) }) }] }
          ]
        };

        const response = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        if (!response.ok) throw new Error(`OpenAI ${response.status}`);
        const result = await response.json();
        const text = result?.output_text || (() => {
          const outputs = Array.isArray(result?.output) ? result.output : [];
          for (const item of outputs) {
            const content = Array.isArray(item?.content) ? item.content : [];
            for (const block of content) {
              if (typeof block?.text === 'string') return block.text;
            }
          }
          return '';
        })();
        let aiMatches = [];
        try {
          // Extract JSON array from response
          const jsonMatch = text.match(/\[[\s\S]*\]/);
          if (jsonMatch) aiMatches = JSON.parse(jsonMatch[0]);
        } catch { /* fallback below */ }

        // Enrich with full product data
        const enriched = aiMatches.map(m => {
          const product = allProducts.find(p => p.sku === m.sku);
          return product ? { ...product, reason: m.reason, confidence: m.confidence } : m;
        }).filter(Boolean);

        return sendJson(res, 200, { mode: 'ai', query, matches: enriched, skuListFromRfp: skuList });
      } catch (err) {
        console.error('SKU match AI error:', err.message);
        // Fallback to keyword
        const searchTerms = (query || skuList.map(s => s.item || '').join(' ')).toLowerCase().split(/\s+/);
        const matches = allProducts.filter(p => {
          const searchable = `${p.name} ${p.type} ${p.specs} ${p.tags.join(' ')} ${p.vendor}`.toLowerCase();
          return searchTerms.some(term => term.length > 2 && searchable.includes(term));
        });
        return sendJson(res, 200, { mode: 'keyword-fallback', query, matches: matches.slice(0, 20) });
      }
    }

    return sendJson(res, 200, { mode: 'none', query: '', matches: [], message: 'No query or SKU list available. Analyze the RFP first or enter a search query.' });
  }

  // Q&A — ask questions about the RFP
  const qaMatch = url.pathname.match(/^\/api\/tenders\/([a-zA-Z0-9-]+)\/ask$/);
  if (req.method === 'POST' && qaMatch) {
    const tenderId = qaMatch[1];
    const detail = await getTenderById(tenderId);
    if (!detail) return sendJson(res, 404, { error: 'Tender not found' });

    const payload = await readJson(req);
    const question = String(payload.question || '').trim();
    if (!question) return sendJson(res, 400, { error: 'Question is required.' });

    let queryEmbedding = null;
    try {
      queryEmbedding = await createEmbedding(question);
    } catch {
      queryEmbedding = null;
    }

    const chunks = await searchTenderChunks(tenderId, question, { limit: 8, queryEmbedding });
    let answer = null;
    try {
      answer = await answerQuestionWithOpenAI({
        tender: detail.tender,
        question,
        chunks,
        requirements: detail.requirements || []
      });
    } catch (err) {
      console.error('Q&A error:', err.message);
      return sendJson(res, 200, {
        question,
        answer: `Error getting answer: ${err.message}`,
        sources: chunks.slice(0, 5).map(c => ({ chunkId: c.chunkId, text: String(c.chunkText || '').slice(0, 200) }))
      });
    }

    return sendJson(res, 200, {
      question,
      answer: answer || 'No answer could be generated. Make sure the tender has been analyzed first.',
      sources: chunks.slice(0, 5).map(c => ({ chunkId: c.chunkId, text: String(c.chunkText || '').slice(0, 200) }))
    });
  }

  const exportMatch = url.pathname.match(/^\/api\/tenders\/([a-zA-Z0-9-]+)\/export-package$/);
  if (req.method === 'POST' && exportMatch) {
    if (!enforceRole(res, auth, ['editor'])) return;
    const tenderId = exportMatch[1];
    const detail = await getTenderById(tenderId);
    if (!detail) return sendJson(res, 404, { error: 'Tender not found' });

    const payload = await readJson(req);
    if (payload.allowDraftExport && !enforceRole(res, auth, ['reviewer'])) return;
    const sectionWorkflow = normalizeSectionWorkflow(detail.sectionWorkflow || defaultSectionWorkflow());
    const gateCheck = evaluateSectionExportGate(sectionWorkflow);
    if (!payload.allowDraftExport && !gateCheck.ready) {
      return sendJson(res, 409, {
        error: 'Export blocked: section workflow is not fully approved/locked.',
        blockers: gateCheck.blockers
      });
    }
    const sectionInputs = Array.isArray(payload.sections) && payload.sections.length > 0
      ? payload.sections
      : defaultExportSections();

    const evidenceAssets = await listEvidenceAssets();
    const matrix = buildComplianceMatrix(detail.requirements, evidenceAssets);
    const drafts = [];

    for (const input of sectionInputs) {
      const sectionTitle = String(input.sectionTitle || 'Section').trim();
      const query = String(input.query || sectionTitle).trim();
      const topK = Math.min(20, Math.max(1, Number(input.topK || 6)));

      let queryEmbedding = null;
      try {
        queryEmbedding = await createEmbedding(query);
      } catch {
        queryEmbedding = null;
      }

      const chunks = await searchTenderChunks(tenderId, query, { limit: topK, queryEmbedding });
      const draft = await buildGroundedDraft({
        tender: detail.tender,
        sectionTitle,
        query,
        requirements: detail.requirements,
        chunks,
        evidenceAssets
      });
      drafts.push({
        sectionTitle,
        query,
        mode: queryEmbedding ? 'vector' : 'keyword',
        ...draft
      });
    }

    const pkg = buildProposalPackage({
      tender: detail.tender,
      matrix,
      drafts,
      gates: detail.gates,
      sectionWorkflow,
      auditEvents: detail.auditEvents,
      evidenceAssets
    });
    return sendJson(res, 200, pkg);
  }

  const exportDocxMatch = url.pathname.match(/^\/api\/tenders\/([a-zA-Z0-9-]+)\/export-docx$/);
  if (req.method === 'POST' && exportDocxMatch) {
    if (!enforceRole(res, auth, ['editor'])) return;
    const tenderId = exportDocxMatch[1];
    const detail = await getTenderById(tenderId);
    if (!detail) return sendJson(res, 404, { error: 'Tender not found' });

    const payload = await readJson(req);
    if (payload.allowDraftExport && !enforceRole(res, auth, ['reviewer'])) return;
    const sectionWorkflow = normalizeSectionWorkflow(detail.sectionWorkflow || defaultSectionWorkflow());
    const gateCheck = evaluateSectionExportGate(sectionWorkflow);
    if (!payload.allowDraftExport && !gateCheck.ready) {
      return sendJson(res, 409, {
        error: 'DOCX export blocked: section workflow is not fully approved/locked.',
        blockers: gateCheck.blockers
      });
    }
    const sectionInputs =
      Array.isArray(payload.sections) && payload.sections.length > 0
        ? payload.sections
        : defaultExportSections();

    const evidenceAssets = await listEvidenceAssets();
    const matrix = buildComplianceMatrix(detail.requirements, evidenceAssets);
    const drafts = [];
    for (const input of sectionInputs) {
      const sectionTitle = String(input.sectionTitle || 'Section').trim();
      const query = String(input.query || sectionTitle).trim();
      const topK = Math.min(20, Math.max(1, Number(input.topK || 6)));

      let queryEmbedding = null;
      try {
        queryEmbedding = await createEmbedding(query);
      } catch {
        queryEmbedding = null;
      }

      const chunks = await searchTenderChunks(tenderId, query, { limit: topK, queryEmbedding });
      const draft = await buildGroundedDraft({
        tender: detail.tender,
        sectionTitle,
        query,
        requirements: detail.requirements,
        chunks,
        evidenceAssets
      });
      drafts.push({
        sectionTitle,
        query,
        mode: queryEmbedding ? 'vector' : 'keyword',
        ...draft
      });
    }

    const pkg = buildProposalPackage({
      tender: detail.tender,
      matrix,
      drafts,
      gates: detail.gates,
      sectionWorkflow,
      auditEvents: detail.auditEvents,
      evidenceAssets
    });

    try {
      const buffer = await buildProposalDocxBuffer(pkg);
      const filename = buildDocxFilename(pkg);
      res.writeHead(200, {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename=\"${filename}\"`
      });
      res.end(buffer);
      return;
    } catch (error) {
      return sendJson(res, 500, {
        error: error instanceof Error ? error.message : 'Failed to export DOCX.'
      });
    }
  }

  // --- RFP Analyzer routes ---

  const uploadMatch = url.pathname.match(/^\/api\/tenders\/([a-zA-Z0-9-]+)\/upload$/);
  if (req.method === 'POST' && uploadMatch) {
    if (!enforceRole(res, auth, ['editor'])) return;
    const tenderId = uploadMatch[1];
    const detail = await getTenderById(tenderId);
    if (!detail) return sendJson(res, 404, { error: 'Tender not found' });

    try {
      const { buffer, filename, mimeType } = await parseMultipart(req);
      const text = await parseDocumentBuffer(buffer, filename, mimeType);
      const doc = await addDocument(tenderId, {
        filename,
        text,
        mimeType
      });
      if (!doc) return sendJson(res, 404, { error: 'Tender not found' });
      return sendJson(res, 201, {
        docId: doc.docId,
        filename: doc.filename,
        charCount: text.length,
        mimeType: doc.mimeType
      });
    } catch (err) {
      return sendJson(res, 400, {
        error: err instanceof Error ? err.message : 'Upload failed'
      });
    }
  }

  const analyzeMatch = url.pathname.match(/^\/api\/tenders\/([a-zA-Z0-9-]+)\/analyze$/);
  if (req.method === 'POST' && analyzeMatch) {
    if (!enforceRole(res, auth, ['editor'])) return;
    const tenderId = analyzeMatch[1];
    const detail = await getTenderById(tenderId);
    if (!detail) return sendJson(res, 404, { error: 'Tender not found' });
    if (detail.documents.length === 0) {
      return sendJson(res, 400, { error: 'At least one document is required before analysis.' });
    }

    const joinedText = detail.documents.map((doc) => doc.text || '').join('\n\n---\n\n');
    const firstDoc = detail.documents[0];
    const analysis = await analyzeRfpDocument({
      tenderId,
      docId: firstDoc.docId,
      filename: firstDoc.filename,
      text: joinedText
    });

    await saveTenderAnalysis(tenderId, analysis);

    if (Array.isArray(analysis.requirements) && analysis.requirements.length > 0) {
      await replaceRequirements(tenderId, analysis.requirements, { provider: 'rfp-analyzer' });
    }

    // Auto-index chunks after analysis (Phase 3A: eliminate manual indexing step)
    let indexResult = null;
    try {
      const chunks = buildChunksFromDocuments(detail.documents, {});
      const withEmbeddings = await embedChunks(chunks);
      const persisted = await replaceTenderChunks(tenderId, withEmbeddings, {
        embeddingProvider: process.env.OPENAI_API_KEY ? 'openai' : 'none'
      });
      indexResult = {
        chunkCount: persisted.length,
        embeddedCount: persisted.filter((chunk) => Array.isArray(chunk.embedding)).length
      };
    } catch (indexErr) {
      indexResult = { error: indexErr.message || 'Indexing failed' };
    }

    // Sync section count back to Hub v2
    try {
      const sectionCount = indexResult.chunkCount || 0;
      await fetch('http://localhost:3000/api/rfp/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenderId, sectionCount, status: 'analyzed' }),
        signal: AbortSignal.timeout(5000),
      });
    } catch { /* Hub v2 sync is non-critical */ }

    return sendJson(res, 200, { analysis, indexResult });
  }

  const multiPassMatch = url.pathname.match(/^\/api\/tenders\/([a-zA-Z0-9-]+)\/analyze-deep$/);
  if (req.method === 'POST' && multiPassMatch) {
    if (!enforceRole(res, auth, ['editor'])) return;
    const tenderId = multiPassMatch[1];
    const detail = await getTenderById(tenderId);
    if (!detail) return sendJson(res, 404, { error: 'Tender not found' });
    if (detail.documents.length === 0) {
      return sendJson(res, 400, { error: 'At least one document is required.' });
    }

    const existingAnalysis = await getTenderAnalysis(tenderId);
    const result = await multiPassAnalyze({
      tenderId,
      documents: detail.documents,
      existingAnalysis,
      buyerName: detail.buyerName || null
    });

    // Merge deep analysis into existing analysis
    const merged = {
      ...(existingAnalysis || {}),
      structural: result.structural,
      adversarial: result.adversarial
    };

    // Replace requirements if deep pass found more
    if (result.requirements.length > (existingAnalysis?.requirements?.length || 0)) {
      merged.requirements = result.requirements;
      await replaceRequirements(tenderId, result.requirements, { provider: 'multi-pass-analyzer' });
    }

    await saveTenderAnalysis(tenderId, merged);
    return sendJson(res, 200, { analysis: merged });
  }

  const analysisMatch = url.pathname.match(/^\/api\/tenders\/([a-zA-Z0-9-]+)\/analysis$/);
  if (req.method === 'GET' && analysisMatch) {
    const analysis = await getTenderAnalysis(analysisMatch[1]);
    return sendJson(res, 200, { analysis });
  }

  if (req.method === 'PUT' && analysisMatch) {
    if (!enforceRole(res, auth, ['editor'])) return;
    const tenderId = analysisMatch[1];
    const detail = await getTenderById(tenderId);
    if (!detail) return sendJson(res, 404, { error: 'Tender not found' });
    const payload = await readJson(req);
    if (!payload || typeof payload !== 'object') {
      return sendJson(res, 400, { error: 'Request body must be a JSON object.' });
    }
    await saveTenderAnalysis(tenderId, payload);
    return sendJson(res, 200, { ok: true });
  }

  const generateResponseMatch = url.pathname.match(/^\/api\/tenders\/([a-zA-Z0-9-]+)\/generate-response$/);
  if (req.method === 'POST' && generateResponseMatch) {
    if (!enforceRole(res, auth, ['editor'])) return;
    const tenderId = generateResponseMatch[1];
    const detail = await getTenderById(tenderId);
    if (!detail) return sendJson(res, 404, { error: 'Tender not found' });

    const analysis = await getTenderAnalysis(tenderId);
    if (!analysis) {
      return sendJson(res, 409, { error: 'No analysis exists yet. Run "Analyze RFP" first.' });
    }

    const payload = await readJson(req);
    const skipDrafts = Boolean(payload.skipDrafts);

    try {
      const { orchestrateDrafts } = await import('./lib/rfp-response-draft.js');
      const { polishDrafts } = await import('./lib/claude-polish.js');
      const { buildResponseDocxBuffer, buildResponseDocxFilename } = await import('./lib/rfp-response-docx.js');

      let drafts = await orchestrateDrafts({
        tender: detail.tender,
        analysis,
        skipDrafts
      });

      if (!skipDrafts) {
        drafts = await polishDrafts(drafts);

        // Auto-advance polished sections to 'approved'
        const sections = await getTenderSections(tenderId);
        if (sections) {
          const sectionKeyMap = {
            'executive summary': 'executive_summary',
            'technical approach': 'technical_approach',
            'security and privacy': 'security_privacy',
            'work plan': 'work_plan',
            'pricing assumptions': 'pricing_assumptions'
          };

          for (const draft of drafts) {
            if (!draft.polished) continue;
            const sectionKey = sectionKeyMap[draft.sectionTitle.toLowerCase()] || null;
            if (sectionKey && sections[sectionKey]) {
              await updateTenderSection(tenderId, sectionKey, {
                status: 'approved',
                note: 'Auto-approved after Claude polish',
                updatedAt: new Date().toISOString()
              });
            }
          }
        }
      }

      const buffer = await buildResponseDocxBuffer({
        tender: detail.tender,
        analysis,
        drafts
      });

      const filename = buildResponseDocxFilename(detail.tender, analysis);
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`
      });
      res.end(buffer);
      return;
    } catch (error) {
      return sendJson(res, 500, {
        error: error instanceof Error ? error.message : 'Failed to generate response DOCX.'
      });
    }
  }

  // --- Content Library Routes ---
  if (url.pathname === '/api/content-library' && req.method === 'GET') {
    const category = url.searchParams.get('category') || undefined;
    const search = url.searchParams.get('search') || undefined;
    const templates = await listResponseTemplates({ category, search });
    return sendJson(res, 200, { templates });
  }

  if (url.pathname === '/api/content-library' && req.method === 'POST') {
    if (!enforceRole(res, auth, ['editor'])) return;
    const payload = await readJson(req);
    if (!payload?.title || !payload?.category || !payload?.content) {
      return sendJson(res, 400, { error: 'title, category, and content are required' });
    }
    const template = await addResponseTemplate(payload);
    return sendJson(res, 201, { template });
  }

  const templateMatch = url.pathname.match(/^\/api\/content-library\/([a-zA-Z0-9-]+)$/);
  if (templateMatch && req.method === 'GET') {
    const template = await getResponseTemplate(templateMatch[1]);
    if (!template) return sendJson(res, 404, { error: 'Template not found' });
    return sendJson(res, 200, { template });
  }

  if (templateMatch && req.method === 'PUT') {
    if (!enforceRole(res, auth, ['editor'])) return;
    const payload = await readJson(req);
    const template = await updateResponseTemplate(templateMatch[1], payload);
    if (!template) return sendJson(res, 404, { error: 'Template not found' });
    return sendJson(res, 200, { template });
  }

  if (templateMatch && req.method === 'DELETE') {
    if (!enforceRole(res, auth, ['editor'])) return;
    const deleted = await deleteResponseTemplate(templateMatch[1]);
    if (!deleted) return sendJson(res, 404, { error: 'Template not found' });
    return sendJson(res, 200, { ok: true });
  }

  if (url.pathname === '/api/content-library/search' && req.method === 'POST') {
    const payload = await readJson(req);
    if (!payload?.text) return sendJson(res, 400, { error: 'text is required' });
    const templates = await findSimilarTemplates(payload.text, payload.limit || 5);
    return sendJson(res, 200, { templates });
  }

  return sendJson(res, 404, { error: 'Route not found' });
}

async function routeStatic(req, res, pathname) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const normalized = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, normalized);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const contentType = contentTypeFor(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}

function contentTypeFor(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'text/plain; charset=utf-8';
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function startConnectorScheduler() {
  const mode = String(process.env.CONNECTOR_SCHEDULER || 'on').toLowerCase();
  if (mode === 'off') return;
  const pollMinutes = Math.max(5, Number(process.env.CONNECTOR_POLL_MINUTES || 1440));
  const intervalMs = pollMinutes * 60 * 1000;

  const run = async () => {
    try {
      const summary = await runAllConnectors({
        upsertTenderFromConnector,
        addConnectorRun,
        logger: console
      });
      if (summary.runCount > 0) {
        console.log(
          `[connectors] ran ${summary.runCount} connector(s), discovered=${summary.discovered}, created=${summary.created}`
        );
      }
    } catch (error) {
      console.error('[connectors] scheduled run failed', error);
    }
  };

  setTimeout(run, 3000);
  setInterval(run, intervalMs);
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    try {
      const busboy = Busboy({ headers: req.headers });
      let fileBuffer = null;
      let fileName = '';
      let fileMimeType = '';

      busboy.on('file', (fieldname, file, info) => {
        const { filename, mimeType } = info;
        fileName = filename || 'unknown';
        fileMimeType = mimeType || 'application/octet-stream';
        const chunks = [];
        file.on('data', (data) => chunks.push(data));
        file.on('end', () => {
          fileBuffer = Buffer.concat(chunks);
        });
      });

      busboy.on('finish', () => {
        if (!fileBuffer) {
          reject(new Error('No file uploaded'));
          return;
        }
        resolve({ buffer: fileBuffer, filename: fileName, mimeType: fileMimeType });
      });

      busboy.on('error', (err) => reject(err));
      req.pipe(busboy);
    } catch (err) {
      reject(err);
    }
  });
}

function enforceRole(res, auth, allowedRoles) {
  if (hasRequiredRole(auth.role, allowedRoles)) return true;
  sendJson(res, 403, {
    error: `Forbidden: requires role ${allowedRoles.join(' or ')}`
  });
  return false;
}

// ═══════════════════════════════════════
//  HUB V2 SYNC
// ═══════════════════════════════════════

const HUB_V2_URL = process.env.HUB_V2_URL || 'http://localhost:3000';

async function syncToHubV2(tenderId, status, tender) {
  // Sync status to Hub v2
  try {
    await fetch(`${HUB_V2_URL}/api/rfp/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenderId,
        status,
        sectionCount: tender?.sectionWorkflow ? Object.keys(tender.sectionWorkflow).length : 0
      }),
      signal: AbortSignal.timeout(5000)
    });
  } catch { /* Hub v2 may be offline */ }

  // On won/lost, also POST to webhook to create deal record
  if (status === 'won' || status === 'lost') {
    try {
      await fetch(`${HUB_V2_URL}/api/rfp/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: tender?.title || tenderId,
          buyerOrg: tender?.buyerName || 'Unknown',
          value: null,
          outcome: status,
          closedAt: new Date().toISOString().split('T')[0]
        }),
        signal: AbortSignal.timeout(5000)
      });
    } catch { /* Hub v2 may be offline */ }
  }
}
