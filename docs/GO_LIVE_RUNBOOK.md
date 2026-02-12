# RFP App Go-Live Runbook

## 1) Preflight
- Copy `.env.production.example` to your deployment secret manager or `.env` equivalent.
- Set strong random API tokens per role.
- Confirm Postgres connectivity and permissions.
- Confirm `pgvector` extension availability.

## 2) Deploy
- Install dependencies and start app.
- Verify health endpoint: `GET /api/health`.
- Verify auth: `GET /api/whoami` with `x-api-token`.

## 3) Smoke test (critical path)
- Create tender.
- Add one document.
- Run extraction.
- Run chunk indexing.
- Run search.
- Add one evidence asset.
- Generate draft.
- Approve/lock all sections.
- Export package JSON and DOCX.
- Verify audit chain (`GET /api/tenders/:id/audit/verify`).

## 4) Connector activation order (recommended)
1. Activate only one connector in `data/connectors.json` (set `active: true`).
2. Run manual ingestion: `POST /api/connectors/run`.
3. Validate discovered vs created counts and tender quality.
4. Repeat for second connector.
5. Enable scheduler only after manual validation passes.

## 5) Post-launch checks
- Audit chain verification must report `valid: true`.
- Export gating should block when sections are not approved/locked.
- Confirm role boundaries:
  - viewer cannot mutate
  - editor cannot run connector ingestion
  - reviewer/admin can approve and run ingestion

## 6) Incident controls
- If audit chain has unsigned legacy prefix, run:
  - `POST /api/tenders/:id/audit/resign` (admin)
- Use force rewrite only for explicit chain rebuild:
  - `POST /api/tenders/:id/audit/resign` with `{ "forceRewrite": true }`
