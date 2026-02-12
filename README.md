# Powerland RFP App (MVP)

Local MVP for Saskatchewan-focused RFP ingestion and response prep.

## What this build includes

- Tender intake (`sourceSystem`, `sourceRef`, buyer, close date fields)
- Document ingestion with SHA-256 hashing and OCR-used flag
- Requirement extraction workflow:
  - Optional OpenAI extraction when `OPENAI_API_KEY` is configured
  - Deterministic heuristic fallback when API key is absent/fails
- Compliance matrix generation from extracted requirements
- Audit events for tender creation, document upload, extraction runs
- Human approval gates:
  - Gate 1: bid/no-bid
  - Gate 2: requirement map approval
  - Gate 3: pricing/legal sign-off
- Single-page UI for the full flow

## Run

```bash
cd /Users/mikesmac/Documents/New\ project/rfp-app
npm install
npm start
```

Open `http://localhost:4310`.

## Dev mode

```bash
npm run dev
```

## Tests

```bash
npm test
```

## OpenAI configuration (optional)

Set env vars before start:

```bash
export OPENAI_API_KEY="<your-key>"
export OPENAI_MODEL="gpt-5-mini"
export OPENAI_EMBED_MODEL="text-embedding-3-small"
```

If unavailable, the app uses built-in heuristic extraction.

## Storage backends

Default backend is local JSON (`data/db.json`).

To run with Postgres:

```bash
export STORAGE_BACKEND="postgres"
export DATABASE_URL="postgres://user:pass@localhost:5432/rfp_app"
npm start
```

Notes:
- Schema auto-creates on first run (same DDL is in `db/schema.sql`).
- Postgres is enabled only when `STORAGE_BACKEND=postgres`.
- Postgres instance must have permission to run `create extension if not exists vector;`.
- `pgvector` is used for semantic retrieval when embeddings are available.

## Security and roles

Security is optional and off by default.

```bash
export AUTH_MODE=on
export AUTH_TOKENS="token_admin:admin,token_reviewer:reviewer,token_editor:editor,token_viewer:viewer"
```

Request headers:
- `x-api-token: <token>` (or `Authorization: Bearer <token>`)
- `x-user-name: <display-name>` (optional)

Role policy:
- `viewer`: read-only endpoints
- `editor`: create/update tender content, draft generation, standard exports
- `reviewer`: gate/section approvals, connector runs, draft-export override
- `admin`: all reviewer privileges

Optional rate limiting:

```bash
export RATE_LIMIT_MODE=on
export RATE_LIMIT_WINDOW_SEC=60
export RATE_LIMIT_MAX=120
```

Introspection:
- `GET /api/whoami`

## API summary

- `GET /api/tenders`
- `POST /api/tenders`
- `GET /api/whoami`
- `GET /api/connectors`
- `GET /api/connectors/runs?limit=20`
- `POST /api/connectors/run`
- `GET /api/evidence`
- `POST /api/evidence`
- `GET /api/tenders/:tenderId`
- `POST /api/tenders/:tenderId/documents`
- `POST /api/tenders/:tenderId/extract`
- `GET /api/tenders/:tenderId/matrix`
- `GET /api/tenders/:tenderId/audit`
- `GET /api/tenders/:tenderId/audit/verify`
- `POST /api/tenders/:tenderId/audit/resign` (admin; body: `{ \"forceRewrite\": false }`)
- `GET /api/tenders/:tenderId/gates`
- `POST /api/tenders/:tenderId/gates/:gateKey`
- `GET /api/tenders/:tenderId/sections`
- `POST /api/tenders/:tenderId/sections/:sectionKey`
- `POST /api/tenders/:tenderId/index` (chunk + embed tender documents)
- `GET /api/tenders/:tenderId/search?q=...&limit=5` (semantic search; keyword fallback)
- `POST /api/tenders/:tenderId/draft` (grounded section draft + citations + gaps)
- `POST /api/tenders/:tenderId/export-package` (full proposal handoff JSON)
- `POST /api/tenders/:tenderId/export-docx` (downloads proposal DOCX)

## Notes against your report

- Data model tracks tender/document/requirement/audit primitives from the proposed architecture.
- Persistence now supports both local JSON and Postgres with the same API surface.
- Retrieval index now supports chunking + embeddings with `pgvector` when Postgres backend is enabled.
- Section drafting can now be generated from retrieved chunks with explicit chunk-id citations.
- Export package bundles: tender metadata, gate statuses, compliance matrix, drafted sections, citations, unresolved gaps, and audit snapshot.
- DOCX export renders sections, citations, compliance matrix, and unresolved gaps into a Word document.
- Connector ingestion supports configurable Saskatchewan source connectors in `data/connectors.json`, manual runs, and scheduled polling.
- Evidence library supports managed evidence assets that auto-link into compliance matrix rows and section drafts.
- Section workflow supports assignee/reviewer/status (`draft`, `in_review`, `approved`, `locked`) with audit events and lock state persistence.
- Export endpoints are blocked unless all sections are `approved`/`locked`; use `allowDraftExport=true` payload to override intentionally.
- Audit events are signed in a per-tender hash chain (`previous_hash` + `hash`) with verification endpoint support.
- Legacy unsigned audit events can be backfilled via admin re-sign endpoint; use `forceRewrite=true` only when intentionally rebuilding a mixed/invalid chain.
- Submission-channel adapters (GEM/email/etc.) are not implemented yet in this pass.

## Connector scheduler

Connector scheduler is on by default and checks active connectors once per day.

```bash
export CONNECTOR_SCHEDULER=on
export CONNECTOR_POLL_MINUTES=1440
```

To disable:

```bash
export CONNECTOR_SCHEDULER=off
```

## Docker

```bash
cd /Users/mikesmac/Documents/New\ project/rfp-app
docker compose up --build
```

The included `docker-compose.yml` starts:
- app container
- `pgvector` Postgres container (`pgvector/pgvector:pg16`)
