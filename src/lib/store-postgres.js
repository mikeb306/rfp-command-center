import crypto from 'node:crypto';
import { newId, nowIso } from './schema.js';
import { GATE_KEYS, defaultGates, normalizeGates, summarizeGates } from './gates.js';
import { backfillAuditChainEvents, signAuditEvent, verifyAuditChain } from './audit-chain.js';
import {
  defaultSectionWorkflow,
  normalizeSectionWorkflow,
  summarizeSections
} from './sections.js';

let pool;
let schemaReady = false;

async function getPool() {
  if (pool) return pool;
  const { Pool } = await import('pg');
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required when STORAGE_BACKEND=postgres.');
  }
  pool = new Pool({ connectionString });
  return pool;
}

async function ensureSchema() {
  if (schemaReady) return;
  const db = await getPool();
  await db.query('create extension if not exists vector;');
  await db.query(`
    create table if not exists tender (
      tender_id uuid primary key,
      title text not null,
      buyer_name text,
      source_system text not null,
      source_ref text not null,
      status text not null,
      posted_at timestamptz,
      closes_at timestamptz,
      access_terms_note text,
      gates jsonb not null,
      section_workflow jsonb not null default '{}'::jsonb,
      created_at timestamptz not null
    );
    alter table tender add column if not exists section_workflow jsonb not null default '{}'::jsonb;
    create unique index if not exists uq_tender_source_ref on tender(source_system, source_ref);

    create table if not exists tender_document (
      doc_id uuid primary key,
      tender_id uuid not null references tender(tender_id) on delete cascade,
      filename text not null,
      mime_type text not null,
      sha256 char(64) not null,
      text_content text not null,
      text_extracted boolean not null,
      ocr_used boolean not null,
      created_at timestamptz not null
    );

    create table if not exists requirement (
      req_id uuid primary key,
      tender_id uuid not null references tender(tender_id) on delete cascade,
      req_type text not null,
      statement text not null,
      section_ref text,
      must_have boolean not null,
      confidence numeric(3,2) not null,
      provenance_doc_id uuid,
      provenance_span text,
      created_at timestamptz not null
    );

    create table if not exists audit_event (
      event_id uuid primary key,
      tender_id uuid not null references tender(tender_id) on delete cascade,
      type text not null,
      details jsonb not null,
      previous_hash text,
      hash text,
      created_at timestamptz not null
    );
    alter table audit_event add column if not exists previous_hash text;
    alter table audit_event add column if not exists hash text;

    create table if not exists connector_run (
      run_id uuid primary key,
      connector_id text not null,
      connector_name text not null,
      source_system text not null,
      status text not null,
      discovered int not null,
      created int not null,
      errors jsonb not null,
      started_at timestamptz not null,
      finished_at timestamptz not null
    );

    create table if not exists evidence_asset (
      evidence_id text primary key,
      title text not null,
      summary text not null,
      tags jsonb not null,
      req_types jsonb not null,
      uri text,
      allowed_use text not null,
      created_at timestamptz not null
    );

    create table if not exists tender_chunk (
      chunk_id uuid primary key,
      tender_id uuid not null references tender(tender_id) on delete cascade,
      doc_id uuid references tender_document(doc_id) on delete set null,
      chunk_index int not null,
      chunk_text text not null,
      token_estimate int not null,
      embedding vector(1536),
      metadata jsonb not null,
      created_at timestamptz not null
    );

    create index if not exists idx_tender_document_tender_id on tender_document(tender_id);
    create index if not exists idx_requirement_tender_id on requirement(tender_id);
    create index if not exists idx_audit_event_tender_id on audit_event(tender_id);
    create index if not exists idx_tender_chunk_tender_id on tender_chunk(tender_id);
    create index if not exists idx_connector_run_finished_at on connector_run(finished_at desc);
    create index if not exists idx_evidence_asset_created_at on evidence_asset(created_at desc);
  `);
  schemaReady = true;
}

export async function listTenders() {
  await ensureSchema();
  const db = await getPool();
  const { rows } = await db.query(`
    select
      t.*,
      (select count(*)::int from tender_document d where d.tender_id = t.tender_id) as doc_count,
      (select count(*)::int from requirement r where r.tender_id = t.tender_id) as req_count,
      (select count(*)::int from tender_chunk c where c.tender_id = t.tender_id) as chunk_count
    from tender t
    order by t.created_at desc
  `);

  return rows.map((row) => {
    const gates = normalizeGates(row.gates);
    const sectionWorkflow = normalizeSectionWorkflow(row.section_workflow);
    return {
      tenderId: row.tender_id,
      title: row.title,
      buyerName: row.buyer_name,
      sourceSystem: row.source_system,
      sourceRef: row.source_ref,
      status: row.status,
      postedAt: row.posted_at ? new Date(row.posted_at).toISOString() : null,
      closesAt: row.closes_at ? new Date(row.closes_at).toISOString() : null,
      accessTermsNote: row.access_terms_note,
      createdAt: new Date(row.created_at).toISOString(),
      gates,
      sectionWorkflow,
      gateSummary: summarizeGates(gates),
      sectionSummary: summarizeSections(sectionWorkflow),
      docCount: row.doc_count,
      reqCount: row.req_count,
      chunkCount: row.chunk_count
    };
  });
}

export async function createTender(input) {
  await ensureSchema();
  const db = await getPool();

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

  const client = await db.connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into tender (
        tender_id, title, buyer_name, source_system, source_ref, status,
        posted_at, closes_at, access_terms_note, gates, section_workflow, created_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12)`,
      [
        tender.tenderId,
        tender.title,
        tender.buyerName,
        tender.sourceSystem,
        tender.sourceRef,
        tender.status,
        tender.postedAt,
        tender.closesAt,
        tender.accessTermsNote,
        JSON.stringify(tender.gates),
        JSON.stringify(tender.sectionWorkflow),
        tender.createdAt
      ]
    );

    await appendAuditEventClient(client, {
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

    await client.query('commit');
    return tender;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function upsertTenderFromConnector(input) {
  await ensureSchema();
  const db = await getPool();

  const existingRes = await db.query(
    'select * from tender where source_system = $1 and source_ref = $2 limit 1',
    [input.sourceSystem, input.sourceRef]
  );
  if (existingRes.rowCount > 0) {
    const row = existingRes.rows[0];
    return {
      created: false,
      tender: {
        tenderId: row.tender_id,
        title: row.title,
        buyerName: row.buyer_name,
        sourceSystem: row.source_system,
        sourceRef: row.source_ref,
        status: row.status,
        postedAt: row.posted_at ? new Date(row.posted_at).toISOString() : null,
        closesAt: row.closes_at ? new Date(row.closes_at).toISOString() : null,
        accessTermsNote: row.access_terms_note,
        gates: normalizeGates(row.gates),
        sectionWorkflow: normalizeSectionWorkflow(row.section_workflow),
        createdAt: new Date(row.created_at).toISOString()
      }
    };
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

  const client = await db.connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into tender (
        tender_id, title, buyer_name, source_system, source_ref, status,
        posted_at, closes_at, access_terms_note, gates, section_workflow, created_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12)`,
      [
        tender.tenderId,
        tender.title,
        tender.buyerName,
        tender.sourceSystem,
        tender.sourceRef,
        tender.status,
        tender.postedAt,
        tender.closesAt,
        tender.accessTermsNote,
        JSON.stringify(tender.gates),
        JSON.stringify(tender.sectionWorkflow),
        tender.createdAt
      ]
    );

    await appendAuditEventClient(client, {
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

    await client.query('commit');
    return { tender, created: true };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function getTenderById(tenderId) {
  await ensureSchema();
  const db = await getPool();

  const tenderResult = await db.query('select * from tender where tender_id = $1', [tenderId]);
  if (tenderResult.rowCount === 0) return null;

  const row = tenderResult.rows[0];
  const gates = normalizeGates(row.gates);
  const sectionWorkflow = normalizeSectionWorkflow(row.section_workflow);

  const [documentsRes, requirementsRes, chunksRes, auditRes] = await Promise.all([
    db.query('select * from tender_document where tender_id = $1 order by created_at desc', [tenderId]),
    db.query('select * from requirement where tender_id = $1 order by created_at desc', [tenderId]),
    db.query(
      `select chunk_id, tender_id, doc_id, chunk_index, chunk_text, token_estimate, metadata, created_at
       from tender_chunk where tender_id = $1 order by chunk_index asc`,
      [tenderId]
    ),
    db.query('select * from audit_event where tender_id = $1 order by created_at desc', [tenderId])
  ]);

  return {
    tender: {
      tenderId: row.tender_id,
      title: row.title,
      buyerName: row.buyer_name,
      sourceSystem: row.source_system,
      sourceRef: row.source_ref,
      status: row.status,
      postedAt: row.posted_at ? new Date(row.posted_at).toISOString() : null,
      closesAt: row.closes_at ? new Date(row.closes_at).toISOString() : null,
      accessTermsNote: row.access_terms_note,
      createdAt: new Date(row.created_at).toISOString(),
      gates,
      sectionWorkflow
    },
    gates,
    sectionWorkflow,
    documents: documentsRes.rows.map((doc) => ({
      docId: doc.doc_id,
      tenderId: doc.tender_id,
      filename: doc.filename,
      mimeType: doc.mime_type,
      sha256: doc.sha256,
      text: doc.text_content,
      textExtracted: doc.text_extracted,
      ocrUsed: doc.ocr_used,
      createdAt: new Date(doc.created_at).toISOString()
    })),
    requirements: requirementsRes.rows.map((req) => ({
      reqId: req.req_id,
      tenderId: req.tender_id,
      reqType: req.req_type,
      statement: req.statement,
      sectionRef: req.section_ref,
      mustHave: req.must_have,
      confidence: Number(req.confidence),
      provenanceDocId: req.provenance_doc_id,
      provenanceSpan: req.provenance_span,
      createdAt: new Date(req.created_at).toISOString()
    })),
    chunks: chunksRes.rows.map((chunk) => ({
      chunkId: chunk.chunk_id,
      tenderId: chunk.tender_id,
      docId: chunk.doc_id,
      chunkIndex: chunk.chunk_index,
      chunkText: chunk.chunk_text,
      tokenEstimate: chunk.token_estimate,
      metadata: chunk.metadata,
      createdAt: new Date(chunk.created_at).toISOString()
    })),
    auditEvents: auditRes.rows.map((event) => ({
      eventId: event.event_id,
      tenderId: event.tender_id,
      type: event.type,
      details: event.details,
      previousHash: event.previous_hash,
      hash: event.hash,
      createdAt: new Date(event.created_at).toISOString()
    }))
  };
}

export async function addDocument(tenderId, input) {
  await ensureSchema();
  const db = await getPool();

  const exists = await db.query('select 1 from tender where tender_id = $1', [tenderId]);
  if (exists.rowCount === 0) return null;

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

  const client = await db.connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into tender_document (
        doc_id, tender_id, filename, mime_type, sha256,
        text_content, text_extracted, ocr_used, created_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        doc.docId,
        doc.tenderId,
        doc.filename,
        doc.mimeType,
        doc.sha256,
        doc.text,
        doc.textExtracted,
        doc.ocrUsed,
        doc.createdAt
      ]
    );

    await appendAuditEventClient(client, {
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

    await client.query('commit');
    return doc;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function listEvidenceAssets() {
  await ensureSchema();
  const db = await getPool();
  const { rows } = await db.query('select * from evidence_asset order by created_at desc');
  return rows.map((row) => ({
    evidenceId: row.evidence_id,
    title: row.title,
    summary: row.summary,
    tags: row.tags || [],
    reqTypes: row.req_types || [],
    uri: row.uri,
    allowedUse: row.allowed_use,
    createdAt: new Date(row.created_at).toISOString()
  }));
}

export async function addEvidenceAsset(asset) {
  await ensureSchema();
  const db = await getPool();
  await db.query(
    `insert into evidence_asset (
      evidence_id, title, summary, tags, req_types, uri, allowed_use, created_at
    ) values ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8)
    on conflict (evidence_id) do update set
      title = excluded.title,
      summary = excluded.summary,
      tags = excluded.tags,
      req_types = excluded.req_types,
      uri = excluded.uri,
      allowed_use = excluded.allowed_use`,
    [
      asset.evidenceId,
      asset.title,
      asset.summary,
      JSON.stringify(asset.tags || []),
      JSON.stringify(asset.reqTypes || []),
      asset.uri,
      asset.allowedUse,
      asset.createdAt
    ]
  );
  return asset;
}

export async function replaceRequirements(tenderId, requirements, extractionMeta = {}) {
  await ensureSchema();
  const db = await getPool();

  const exists = await db.query('select 1 from tender where tender_id = $1', [tenderId]);
  if (exists.rowCount === 0) return null;

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

  const client = await db.connect();
  try {
    await client.query('begin');
    await client.query('delete from requirement where tender_id = $1', [tenderId]);

    for (const req of persisted) {
      await client.query(
        `insert into requirement (
          req_id, tender_id, req_type, statement, section_ref,
          must_have, confidence, provenance_doc_id, provenance_span, created_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          req.reqId,
          req.tenderId,
          req.reqType,
          req.statement,
          req.sectionRef,
          req.mustHave,
          req.confidence,
          req.provenanceDocId,
          req.provenanceSpan,
          req.createdAt
        ]
      );
    }

    await appendAuditEventClient(client, {
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

    await client.query('commit');
    return persisted;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function listAuditEvents(tenderId) {
  await ensureSchema();
  const db = await getPool();
  const { rows } = await db.query(
    'select * from audit_event where tender_id = $1 order by created_at desc',
    [tenderId]
  );

  return rows.map((event) => ({
    eventId: event.event_id,
    tenderId: event.tender_id,
    type: event.type,
    details: event.details,
    previousHash: event.previous_hash,
    hash: event.hash,
    createdAt: new Date(event.created_at).toISOString()
  }));
}

export async function verifyTenderAuditChain(tenderId) {
  const events = await listAuditEvents(tenderId);
  return verifyAuditChain(events);
}

export async function backfillTenderAuditChain(tenderId, options = {}) {
  await ensureSchema();
  const db = await getPool();

  const { rows } = await db.query(
    `select event_id, tender_id, type, details, previous_hash, hash, created_at
     from audit_event where tender_id = $1 order by created_at asc, event_id asc`,
    [tenderId]
  );

  const events = rows.map((row) => ({
    eventId: row.event_id,
    tenderId: row.tender_id,
    type: row.type,
    details: row.details,
    previousHash: row.previous_hash,
    hash: row.hash,
    createdAt: new Date(row.created_at).toISOString()
  }));

  const result = backfillAuditChainEvents(events, options);
  const client = await db.connect();
  try {
    await client.query('begin');
    for (const event of result.events) {
      await client.query(
        `update audit_event
         set previous_hash = $2, hash = $3
         where event_id = $1`,
        [event.eventId, event.previousHash || null, event.hash || null]
      );
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }

  return {
    mode: result.mode,
    rewrittenCount: result.rewrittenCount,
    verification: verifyAuditChain(result.events)
  };
}

export async function updateTenderGate(tenderId, gateKey, input) {
  await ensureSchema();
  if (!GATE_KEYS.includes(gateKey)) return null;
  const db = await getPool();

  const tenderResult = await db.query('select gates from tender where tender_id = $1', [tenderId]);
  if (tenderResult.rowCount === 0) return null;

  const gates = normalizeGates(tenderResult.rows[0].gates);
  const next = {
    status: input.status,
    reviewer: typeof input.reviewer === 'string' ? input.reviewer.trim() || null : null,
    note: typeof input.note === 'string' ? input.note.trim() || null : null,
    decidedAt: input.status === 'pending' ? null : nowIso()
  };
  gates[gateKey] = next;

  const client = await db.connect();
  try {
    await client.query('begin');
    await client.query('update tender set gates = $2::jsonb where tender_id = $1', [
      tenderId,
      JSON.stringify(gates)
    ]);

    await appendAuditEventClient(client, {
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

    await client.query('commit');
    return {
      gates,
      gateSummary: summarizeGates(gates)
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function getTenderSections(tenderId) {
  await ensureSchema();
  const db = await getPool();
  const result = await db.query('select section_workflow from tender where tender_id = $1', [tenderId]);
  if (result.rowCount === 0) return null;
  return normalizeSectionWorkflow(result.rows[0].section_workflow);
}

export async function updateTenderSection(tenderId, sectionKey, input) {
  await ensureSchema();
  const db = await getPool();
  const result = await db.query('select section_workflow from tender where tender_id = $1', [tenderId]);
  if (result.rowCount === 0) return null;

  const sectionWorkflow = normalizeSectionWorkflow(result.rows[0].section_workflow);
  if (!sectionWorkflow[sectionKey]) return null;
  const next = {
    ...sectionWorkflow[sectionKey],
    status: input.status,
    assignee: typeof input.assignee === 'string' ? input.assignee.trim() || null : null,
    reviewer: typeof input.reviewer === 'string' ? input.reviewer.trim() || null : null,
    note: typeof input.note === 'string' ? input.note.trim() || null : null,
    locked: input.status === 'locked',
    updatedAt: nowIso()
  };
  sectionWorkflow[sectionKey] = next;

  const client = await db.connect();
  try {
    await client.query('begin');
    await client.query('update tender set section_workflow = $2::jsonb where tender_id = $1', [
      tenderId,
      JSON.stringify(sectionWorkflow)
    ]);
    await appendAuditEventClient(client, {
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
    await client.query('commit');
    return {
      sectionWorkflow,
      sectionSummary: summarizeSections(sectionWorkflow)
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function addConnectorRun(run) {
  await ensureSchema();
  const db = await getPool();
  const record = {
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

  await db.query(
    `insert into connector_run (
      run_id, connector_id, connector_name, source_system, status,
      discovered, created, errors, started_at, finished_at
    ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
    [
      record.runId,
      record.connectorId,
      record.connectorName,
      record.sourceSystem,
      record.status,
      record.discovered,
      record.created,
      JSON.stringify(record.errors),
      record.startedAt,
      record.finishedAt
    ]
  );
  return record;
}

export async function listConnectorRuns(limit = 30) {
  await ensureSchema();
  const db = await getPool();
  const capped = clampRunLimit(limit);
  const { rows } = await db.query(
    `select * from connector_run order by finished_at desc limit $1`,
    [capped]
  );

  return rows.map((row) => ({
    runId: row.run_id,
    connectorId: row.connector_id,
    connectorName: row.connector_name,
    sourceSystem: row.source_system,
    status: row.status,
    discovered: row.discovered,
    created: row.created,
    errors: row.errors,
    startedAt: new Date(row.started_at).toISOString(),
    finishedAt: new Date(row.finished_at).toISOString()
  }));
}

export async function replaceTenderChunks(tenderId, chunks, indexMeta = {}) {
  await ensureSchema();
  const db = await getPool();

  const exists = await db.query('select 1 from tender where tender_id = $1', [tenderId]);
  if (exists.rowCount === 0) return null;

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

  const client = await db.connect();
  try {
    await client.query('begin');
    await client.query('delete from tender_chunk where tender_id = $1', [tenderId]);

    for (const chunk of persisted) {
      await client.query(
        `insert into tender_chunk (
          chunk_id, tender_id, doc_id, chunk_index, chunk_text,
          token_estimate, embedding, metadata, created_at
        ) values ($1,$2,$3,$4,$5,$6,$7::vector,$8::jsonb,$9)`,
        [
          chunk.chunkId,
          chunk.tenderId,
          chunk.docId,
          chunk.chunkIndex,
          chunk.chunkText,
          chunk.tokenEstimate,
          vectorLiteral(chunk.embedding),
          JSON.stringify(chunk.metadata),
          chunk.createdAt
        ]
      );
    }

    await appendAuditEventClient(client, {
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

    await client.query('commit');
    return persisted;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function searchTenderChunks(tenderId, query, options = {}) {
  await ensureSchema();
  const db = await getPool();
  const limit = clampSearchLimit(options.limit);

  if (Array.isArray(options.queryEmbedding)) {
    const { rows } = await db.query(
      `select
         chunk_id, tender_id, doc_id, chunk_index, chunk_text, token_estimate, metadata, created_at,
         (1 - (embedding <=> $2::vector)) as score
       from tender_chunk
       where tender_id = $1 and embedding is not null
       order by embedding <=> $2::vector
       limit $3`,
      [tenderId, vectorLiteral(options.queryEmbedding), limit]
    );
    return rows.map((row) => ({
      chunkId: row.chunk_id,
      tenderId: row.tender_id,
      docId: row.doc_id,
      chunkIndex: row.chunk_index,
      chunkText: row.chunk_text,
      tokenEstimate: row.token_estimate,
      metadata: row.metadata,
      createdAt: new Date(row.created_at).toISOString(),
      score: Number(row.score)
    }));
  }

  const { rows } = await db.query(
    `select
       chunk_id, tender_id, doc_id, chunk_index, chunk_text, token_estimate, metadata, created_at,
       ts_rank_cd(to_tsvector('english', chunk_text), plainto_tsquery('english', $2)) as score
     from tender_chunk
     where tender_id = $1 and chunk_text ilike '%' || $2 || '%'
     order by score desc
     limit $3`,
    [tenderId, String(query || ''), limit]
  );
  return rows.map((row) => ({
    chunkId: row.chunk_id,
    tenderId: row.tender_id,
    docId: row.doc_id,
    chunkIndex: row.chunk_index,
    chunkText: row.chunk_text,
    tokenEstimate: row.token_estimate,
    metadata: row.metadata,
    createdAt: new Date(row.created_at).toISOString(),
    score: Number(row.score)
  }));
}

async function appendAuditEventClient(client, event) {
  const prev = await client.query(
    `select hash from audit_event
     where tender_id = $1 and hash is not null
     order by created_at desc, event_id desc
     limit 1`,
    [event.tenderId]
  );
  const previousHash = prev.rowCount > 0 ? prev.rows[0].hash : null;
  const signed = signAuditEvent(event, previousHash);
  await client.query(
    `insert into audit_event (
      event_id, tender_id, type, details, previous_hash, hash, created_at
    ) values ($1,$2,$3,$4::jsonb,$5,$6,$7)`,
    [
      signed.eventId,
      signed.tenderId,
      signed.type,
      JSON.stringify(signed.details || {}),
      signed.previousHash,
      signed.hash,
      signed.createdAt
    ]
  );
}

function hashText(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function clamp(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.5;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return Number(value.toFixed(2));
}

function clampSearchLimit(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return 5;
  if (num < 1) return 1;
  if (num > 20) return 20;
  return Math.round(num);
}

function vectorLiteral(vector) {
  if (!Array.isArray(vector) || vector.length === 0) return null;
  return `[${vector.join(',')}]`;
}

function clampRunLimit(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return 30;
  if (num < 1) return 1;
  if (num > 100) return 100;
  return Math.round(num);
}
