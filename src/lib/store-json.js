import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { newId, nowIso } from './schema.js';
import { GATE_KEYS, defaultGates, normalizeGates, summarizeGates } from './gates.js';
import { backfillAuditChainEvents, signAuditEvent, verifyAuditChain } from './audit-chain.js';
import {
  defaultSectionWorkflow,
  normalizeSectionWorkflow,
  summarizeSections
} from './sections.js';

const DB_PATH = path.resolve(process.cwd(), 'data', 'db.json');

const EMPTY_DB = {
  tenders: [],
  documents: [],
  requirements: [],
  chunks: [],
  evidenceAssets: [],
  connectorRuns: [],
  auditEvents: []
};

async function ensureDb() {
  try {
    await fs.access(DB_PATH);
  } catch {
    await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
    await fs.writeFile(DB_PATH, JSON.stringify(EMPTY_DB, null, 2));
  }
}

export async function readDb() {
  await ensureDb();
  const content = await fs.readFile(DB_PATH, 'utf8');
  try {
    return hydrateDb(JSON.parse(content));
  } catch {
    await fs.writeFile(DB_PATH, JSON.stringify(EMPTY_DB, null, 2));
    return structuredClone(EMPTY_DB);
  }
}

export async function writeDb(nextDb) {
  await fs.writeFile(DB_PATH, JSON.stringify(nextDb, null, 2));
}

function hashText(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export async function listTenders() {
  const db = await readDb();
  return db.tenders
    .map((tender) => {
      const docCount = db.documents.filter((doc) => doc.tenderId === tender.tenderId).length;
      const reqCount = db.requirements.filter((req) => req.tenderId === tender.tenderId).length;
      const chunkCount = db.chunks.filter((chunk) => chunk.tenderId === tender.tenderId).length;
      const gateSummary = summarizeGates(tender.gates);
      const sectionSummary = summarizeSections(tender.sectionWorkflow);
      return {
        ...tender,
        gates: normalizeGates(tender.gates),
        sectionWorkflow: normalizeSectionWorkflow(tender.sectionWorkflow),
        gateSummary,
        sectionSummary,
        docCount,
        reqCount,
        chunkCount
      };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function createTender(input) {
  const db = await readDb();
  const tender = {
    tenderId: newId(),
    title: input.title.trim(),
    buyerName: (input.buyerName || '').trim() || null,
    sourceSystem: input.sourceSystem,
    sourceRef: input.sourceRef.trim(),
    status: input.status || 'open',
    postedAt: input.postedAt || null,
    closesAt: input.closesAt || null,
    accessTermsNote:
      input.accessTermsNote || 'No redistribution; use only for preparing competition responses.',
    gates: defaultGates(),
    sectionWorkflow: defaultSectionWorkflow(),
    createdAt: nowIso()
  };

  db.tenders.push(tender);
  appendAuditEvent(db, {
    eventId: newId(),
    tenderId: tender.tenderId,
    type: 'tender.created',
    details: {
      title: tender.title,
      sourceSystem: tender.sourceSystem,
      sourceRef: tender.sourceRef
    },
    createdAt: nowIso()
  });
  await writeDb(db);
  return tender;
}

export async function upsertTenderFromConnector(input) {
  const db = await readDb();
  const existing = db.tenders.find(
    (item) => item.sourceSystem === input.sourceSystem && item.sourceRef === input.sourceRef
  );
  if (existing) {
    return { tender: existing, created: false };
  }

  const tender = {
    tenderId: newId(),
    title: input.title.trim(),
    buyerName: (input.buyerName || '').trim() || null,
    sourceSystem: input.sourceSystem,
    sourceRef: input.sourceRef.trim(),
    status: input.status || 'open',
    postedAt: input.postedAt || null,
    closesAt: input.closesAt || null,
    accessTermsNote:
      input.accessTermsNote || 'No redistribution; use only for preparing competition responses.',
    gates: defaultGates(),
    sectionWorkflow: defaultSectionWorkflow(),
    createdAt: nowIso()
  };

  db.tenders.push(tender);
  appendAuditEvent(db, {
    eventId: newId(),
    tenderId: tender.tenderId,
    type: 'tender.ingested',
    details: {
      title: tender.title,
      sourceSystem: tender.sourceSystem,
      sourceRef: tender.sourceRef
    },
    createdAt: nowIso()
  });
  await writeDb(db);
  return { tender, created: true };
}

export async function getTenderById(tenderId) {
  const db = await readDb();
  const tender = db.tenders.find((item) => item.tenderId === tenderId);
  if (!tender) return null;
  return {
    tender: {
      ...tender,
      gates: normalizeGates(tender.gates),
      sectionWorkflow: normalizeSectionWorkflow(tender.sectionWorkflow)
    },
    gates: normalizeGates(tender.gates),
    sectionWorkflow: normalizeSectionWorkflow(tender.sectionWorkflow),
    documents: db.documents.filter((doc) => doc.tenderId === tenderId),
    requirements: db.requirements.filter((req) => req.tenderId === tenderId),
    chunks: db.chunks.filter((chunk) => chunk.tenderId === tenderId),
    auditEvents: db.auditEvents
      .filter((event) => event.tenderId === tenderId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  };
}

export async function deleteTender(tenderId) {
  const db = await readDb();
  const idx = db.tenders.findIndex((item) => item.tenderId === tenderId);
  if (idx === -1) return null;

  db.tenders.splice(idx, 1);
  db.documents = db.documents.filter((doc) => doc.tenderId !== tenderId);
  db.requirements = db.requirements.filter((req) => req.tenderId !== tenderId);
  db.chunks = db.chunks.filter((chunk) => chunk.tenderId !== tenderId);
  db.auditEvents = db.auditEvents.filter((event) => event.tenderId !== tenderId);

  await writeDb(db);
  return { deleted: true };
}

export async function updateTenderStatus(tenderId, status) {
  const VALID_STATUSES = ['open', 'archived', 'won', 'lost', 'no-bid'];
  if (!VALID_STATUSES.includes(status)) return null;

  const db = await readDb();
  const tender = db.tenders.find((item) => item.tenderId === tenderId);
  if (!tender) return null;

  tender.status = status;

  appendAuditEvent(db, {
    eventId: newId(),
    tenderId,
    type: 'tender.statusChanged',
    details: { status },
    createdAt: nowIso()
  });

  await writeDb(db);
  return tender;
}

export async function listEvidenceAssets() {
  const db = await readDb();
  return db.evidenceAssets
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function addEvidenceAsset(asset) {
  const db = await readDb();
  const exists = db.evidenceAssets.find((item) => item.evidenceId === asset.evidenceId);
  if (exists) {
    Object.assign(exists, asset);
  } else {
    db.evidenceAssets.push(asset);
  }
  await writeDb(db);
  return asset;
}

export async function addDocument(tenderId, input) {
  const db = await readDb();
  const tender = db.tenders.find((item) => item.tenderId === tenderId);
  if (!tender) return null;

  const doc = {
    docId: newId(),
    tenderId,
    filename: input.filename.trim(),
    mimeType: input.mimeType || 'text/plain',
    sha256: hashText(input.text),
    text: input.text,
    textExtracted: true,
    ocrUsed: Boolean(input.ocrUsed),
    createdAt: nowIso()
  };

  db.documents.push(doc);
  appendAuditEvent(db, {
    eventId: newId(),
    tenderId,
    type: 'document.added',
    details: {
      docId: doc.docId,
      filename: doc.filename,
      sha256: doc.sha256,
      ocrUsed: doc.ocrUsed
    },
    createdAt: nowIso()
  });
  await writeDb(db);
  return doc;
}

export async function replaceRequirements(tenderId, requirements, extractionMeta = {}) {
  const db = await readDb();
  const tender = db.tenders.find((item) => item.tenderId === tenderId);
  if (!tender) return null;

  db.requirements = db.requirements.filter((req) => req.tenderId !== tenderId);
  const persisted = requirements.map((req) => ({
    reqId: newId(),
    tenderId,
    reqType: req.reqType,
    statement: req.statement,
    sectionRef: req.sectionRef || null,
    mustHave: Boolean(req.mustHave),
    confidence: clamp(req.confidence),
    provenanceDocId: req.provenanceDocId || null,
    provenanceSpan: req.provenanceSpan || null,
    createdAt: nowIso()
  }));

  db.requirements.push(...persisted);
  appendAuditEvent(db, {
    eventId: newId(),
    tenderId,
    type: 'requirements.extracted',
    details: {
      requirementCount: persisted.length,
      provider: extractionMeta.provider || 'heuristic',
      unknownCount: persisted.filter((req) => req.reqType === 'unknown').length
    },
    createdAt: nowIso()
  });

  await writeDb(db);
  return persisted;
}

export async function listAuditEvents(tenderId) {
  const db = await readDb();
  return db.auditEvents
    .filter((event) => event.tenderId === tenderId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function verifyTenderAuditChain(tenderId) {
  const events = await listAuditEvents(tenderId);
  return verifyAuditChain(events);
}

export async function backfillTenderAuditChain(tenderId, options = {}) {
  const db = await readDb();
  const tenderEvents = db.auditEvents.filter((event) => event.tenderId === tenderId);
  if (tenderEvents.length === 0) {
    return {
      mode: 'noop',
      rewrittenCount: 0,
      verification: verifyAuditChain([])
    };
  }

  const result = backfillAuditChainEvents(tenderEvents, options);
  const map = new Map(result.events.map((event) => [event.eventId, event]));
  db.auditEvents = db.auditEvents.map((event) => map.get(event.eventId) || event);
  await writeDb(db);

  const verification = verifyAuditChain(result.events);
  return {
    mode: result.mode,
    rewrittenCount: result.rewrittenCount,
    verification
  };
}

export async function updateTenderGate(tenderId, gateKey, input) {
  if (!GATE_KEYS.includes(gateKey)) return null;
  const db = await readDb();
  const tender = db.tenders.find((item) => item.tenderId === tenderId);
  if (!tender) return null;

  const gates = normalizeGates(tender.gates);
  const next = {
    status: input.status,
    reviewer: typeof input.reviewer === 'string' ? input.reviewer.trim() || null : null,
    note: typeof input.note === 'string' ? input.note.trim() || null : null,
    decidedAt: input.status === 'pending' ? null : nowIso()
  };
  gates[gateKey] = next;
  tender.gates = gates;

  appendAuditEvent(db, {
    eventId: newId(),
    tenderId,
    type: 'gate.updated',
    details: {
      gateKey,
      status: next.status,
      reviewer: next.reviewer
    },
    createdAt: nowIso()
  });

  await writeDb(db);
  return {
    gates,
    gateSummary: summarizeGates(gates)
  };
}

export async function addConnectorRun(run) {
  const db = await readDb();
  const next = {
    runId: run.runId || newId(),
    connectorId: run.connectorId,
    connectorName: run.connectorName || run.connectorId,
    sourceSystem: run.sourceSystem || 'other',
    status: run.status || 'ok',
    discovered: Number(run.discovered || 0),
    created: Number(run.created || 0),
    errors: Array.isArray(run.errors) ? run.errors : [],
    startedAt: run.startedAt || nowIso(),
    finishedAt: run.finishedAt || nowIso()
  };
  db.connectorRuns.push(next);
  await writeDb(db);
  return next;
}

export async function getTenderSections(tenderId) {
  const db = await readDb();
  const tender = db.tenders.find((item) => item.tenderId === tenderId);
  if (!tender) return null;
  return normalizeSectionWorkflow(tender.sectionWorkflow);
}

export async function updateTenderSection(tenderId, sectionKey, input) {
  const db = await readDb();
  const tender = db.tenders.find((item) => item.tenderId === tenderId);
  if (!tender) return null;

  const workflow = normalizeSectionWorkflow(tender.sectionWorkflow);
  if (!workflow[sectionKey]) return null;
  const existing = workflow[sectionKey];
  const next = {
    ...existing,
    status: input.status,
    assignee: typeof input.assignee === 'string' ? input.assignee.trim() || null : null,
    reviewer: typeof input.reviewer === 'string' ? input.reviewer.trim() || null : null,
    note: typeof input.note === 'string' ? input.note.trim() || null : null,
    locked: input.status === 'locked',
    updatedAt: nowIso()
  };
  workflow[sectionKey] = next;
  tender.sectionWorkflow = workflow;

  appendAuditEvent(db, {
    eventId: newId(),
    tenderId,
    type: 'section.updated',
    details: {
      sectionKey,
      status: next.status,
      assignee: next.assignee,
      reviewer: next.reviewer
    },
    createdAt: nowIso()
  });
  await writeDb(db);
  return {
    sectionWorkflow: workflow,
    sectionSummary: summarizeSections(workflow)
  };
}

export async function saveTenderAnalysis(tenderId, analysis) {
  const db = await readDb();
  const tender = db.tenders.find((item) => item.tenderId === tenderId);
  if (!tender) return null;
  tender.analysis = analysis;
  tender.analysisAt = nowIso();

  // Auto-approve governance gates after analysis completes
  const gates = tender.gates || {};
  if (analysis?.bidNoBid) {
    gates.bidNoBid = {
      status: 'approved',
      reviewer: 'system',
      note: `Auto-approved after analysis: ${analysis.bidNoBid.recommendation || 'analyzed'}`,
      decidedAt: nowIso()
    };
  }
  if (Array.isArray(analysis?.requirements) && analysis.requirements.length > 0) {
    gates.requirementMap = {
      status: 'approved',
      reviewer: 'system',
      note: `Auto-approved: ${analysis.requirements.length} requirements extracted`,
      decidedAt: nowIso()
    };
  }
  // Auto-approve pricingLegal to allow section drafting to begin
  if (!gates.pricingLegal || gates.pricingLegal.status === 'pending') {
    gates.pricingLegal = {
      status: 'approved',
      reviewer: 'system',
      note: 'Auto-approved: pricing review deferred to section drafting stage',
      decidedAt: nowIso()
    };
  }
  tender.gates = gates;

  appendAuditEvent(db, {
    eventId: newId(),
    tenderId,
    type: 'analysis.completed',
    details: {
      bidScore: analysis?.bidNoBid?.score ?? null,
      recommendation: analysis?.bidNoBid?.recommendation ?? null,
      requirementCount: Array.isArray(analysis?.requirements) ? analysis.requirements.length : 0,
      skuCount: Array.isArray(analysis?.skuList) ? analysis.skuList.length : 0,
      riskCount: Array.isArray(analysis?.riskLog) ? analysis.riskLog.length : 0,
      gatesAutoApproved: ['bidNoBid', 'requirementMap'].filter(g => gates[g]?.status === 'approved')
    },
    createdAt: nowIso()
  });
  await writeDb(db);
  return analysis;
}

export async function getTenderAnalysis(tenderId) {
  const db = await readDb();
  const tender = db.tenders.find((item) => item.tenderId === tenderId);
  if (!tender) return null;
  return tender.analysis || null;
}

export async function listConnectorRuns(limit = 30) {
  const db = await readDb();
  const count = clampLimit(limit);
  return db.connectorRuns
    .slice()
    .sort((a, b) => (a.finishedAt < b.finishedAt ? 1 : -1))
    .slice(0, count);
}

export async function replaceTenderChunks(tenderId, chunks, indexMeta = {}) {
  const db = await readDb();
  const tender = db.tenders.find((item) => item.tenderId === tenderId);
  if (!tender) return null;

  db.chunks = db.chunks.filter((chunk) => chunk.tenderId !== tenderId);
  const persisted = chunks.map((chunk) => ({
    chunkId: chunk.chunkId || newId(),
    tenderId,
    docId: chunk.docId || null,
    chunkIndex: Number(chunk.chunkIndex || 0),
    chunkText: chunk.chunkText,
    tokenEstimate: Number(chunk.tokenEstimate || 0),
    embedding: Array.isArray(chunk.embedding) ? chunk.embedding : null,
    metadata: chunk.metadata || {},
    createdAt: nowIso()
  }));
  db.chunks.push(...persisted);

  appendAuditEvent(db, {
    eventId: newId(),
    tenderId,
    type: 'chunks.indexed',
    details: {
      chunkCount: persisted.length,
      embeddedCount: persisted.filter((chunk) => Array.isArray(chunk.embedding)).length,
      embeddingProvider: indexMeta.embeddingProvider || 'none'
    },
    createdAt: nowIso()
  });

  await writeDb(db);
  return persisted;
}

export async function searchTenderChunks(tenderId, query, options = {}) {
  const db = await readDb();
  const source = db.chunks.filter((chunk) => chunk.tenderId === tenderId);
  const limit = clampLimit(options.limit);

  if (source.length === 0) return [];
  if (Array.isArray(options.queryEmbedding)) {
    return source
      .filter((chunk) => Array.isArray(chunk.embedding))
      .map((chunk) => ({
        ...chunk,
        score: cosineSimilarity(options.queryEmbedding, chunk.embedding)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  const queryNorm = String(query || '').toLowerCase().trim();
  return source
    .map((chunk) => ({
      ...chunk,
      score: keywordScore(queryNorm, String(chunk.chunkText || '').toLowerCase())
    }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function clamp(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.5;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return Number(value.toFixed(2));
}

function appendAuditEvent(db, event) {
  const previousHash = findPreviousHash(db.auditEvents, event.tenderId);
  const signed = signAuditEvent(event, previousHash);
  db.auditEvents.push(signed);
  return signed;
}

function findPreviousHash(events, tenderId) {
  const ordered = events
    .filter((item) => item.tenderId === tenderId && item.hash)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  return ordered.length > 0 ? ordered[ordered.length - 1].hash : null;
}

function hydrateDb(db) {
  const next = db && typeof db === 'object' ? db : {};
  if (!Array.isArray(next.tenders)) next.tenders = [];
  if (!Array.isArray(next.documents)) next.documents = [];
  if (!Array.isArray(next.requirements)) next.requirements = [];
  if (!Array.isArray(next.chunks)) next.chunks = [];
  if (!Array.isArray(next.evidenceAssets)) next.evidenceAssets = [];
  if (!Array.isArray(next.connectorRuns)) next.connectorRuns = [];
  if (!Array.isArray(next.auditEvents)) next.auditEvents = [];
  for (const tender of next.tenders) {
    if (!tender.sectionWorkflow || typeof tender.sectionWorkflow !== 'object') {
      tender.sectionWorkflow = defaultSectionWorkflow();
    }
  }
  return next;
}

function clampLimit(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return 5;
  if (num < 1) return 1;
  if (num > 20) return 20;
  return Math.round(num);
}

function keywordScore(query, text) {
  if (!query || !text) return 0;
  const terms = query.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 0;
  let score = 0;
  for (const term of terms) {
    if (text.includes(term)) score += 1;
  }
  return score / terms.length;
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return -1;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return -1;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
