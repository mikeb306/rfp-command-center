create extension if not exists vector;

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
