# Equal Care Finland — where the cancer pathway breaks, county by county

Junction 2026 · AstraZeneca challenge "Equal Care Across Finland".

**Key message (30 s):** 4,049 of 14,774 lung cancer patients (27.4 %) in 2019–2023 have no recorded treatment within 12 months, ranging from 16.4 % to 43.1 % by wellbeing services county. Equal Care Finland shows *at which pathway stage* each county diverges from the rest of Finland — detection, follow-up, referral (proxies), diagnosis & records, treatment, outcome — and turns each signal into a cited, costed action plan a county can start on in the next 90 days.

## Demo (one front door)

The React app in [`frontend/`](frontend/README.md) is the product. It works with or without the backend.

```bash
# Fastest: offline, bundled snapshot (no database, no API key)
cd frontend && npm ci && npm run dev          # http://localhost:5173 → "Backend offline — showing cached snapshot"

# Full stack: MariaDB + FastAPI + AI county reviews
make demo                                     # docker compose: init-db → ingest → uvicorn :8000
cd frontend && npm run dev
```

Two-minute walkthrough: read the national headline → pick a pathway stage → the map recolours by verdict (**Act / Verify data / Monitor / In line**) → click a county → its briefing shows where the gap emerges, the stage verdicts, and action cards with baseline, target, annual workload, owner, first-90-days steps, escalation and sources → **Export action plan** (Markdown).

Without a `GEMINI_API_KEY` the briefing falls back to a deterministic plan built from the snapshot, so the demo never dead-ends. Pre-seed AI reviews before judging with `cd backend && uv run backend generate-proposals --all`.

## How it fits together

```
public sources ──► scripts/ (collect, process, validate) ──► data/processed/*.csv
                                         │
                   scripts/build_pathway_snapshot.py (pathway_engine.py)
                                         ▼
                        data/processed/pathway_snapshot.json
                         │                               │
              backend/ (FastAPI, /api/v1/pathway,     frontend/ (bundled copy =
              AI reviews grounded in snapshot,        offline fallback)
              recommendations.json, strategy PDFs)
```

- [`data/catalog/recommendations.json`](data/catalog/recommendations.json): the single source of the six action playbooks (steps, targets, timeline, escalation, citations).
- [`docs/DATA_GUIDE.md`](docs/DATA_GUIDE.md): datasets, leave-one-out comparators, referral proxies, verdict rules and **limitations**.
- [`data/catalog/validation.json`](data/catalog/validation.json): source-integrity checks reported separately from analytical checks.
- [`data/catalog/downloads.json`](data/catalog/downloads.json), [`tables.json`](data/catalog/tables.json): provenance, hashes, queries and access failures.

No patient-level or synthetic data is used. Findings are descriptive and not risk-adjusted; a missing record is not proof of missing care — the tool says "Verify data" when that is the likelier explanation.

## Verify

```bash
make check   # data smoke test + backend lint/tests + frontend build/tests/lint
make data    # rebuild the pathway snapshot and copy it into the frontend
```
