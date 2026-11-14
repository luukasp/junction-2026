# Equal Care Finland — where the cancer pathway breaks, county by county

Junction 2026 · AstraZeneca challenge "Equal Care Across Finland".

**Key message (30 s):** 15 of 23 Finnish areas show an actionable cancer-pathway gap (`Act`), while 4,049 of 14,774 lung cancer patients (27.4 %, 16.4 % to 43.1 % by county, 2019–2023) have no recorded treatment within 12 months (`Verify data`). Equal Care Finland shows *at which pathway stage* each county diverges from the rest of Finland — detection, follow-up, referral (proxies), diagnosis & records, treatment, outcome — separates real care bottlenecks from recording blind spots, and turns every signal into a cited, FTE- and EUR-sized 90-day action plan at both county and national levels.

## Demo (one front door)

The React app in [`frontend/`](frontend/README.md) is the product. It works with or without the backend.

```bash
# Fastest: offline, bundled snapshot (no database, no API key)
cd frontend && npm ci && npm run dev          # http://localhost:5173 → "Backend offline — showing cached snapshot"

# Local dev stack: MariaDB (docker) + FastAPI (:8000) + Vite (:5173)
./start.sh                                    # auto-discovers .env and backend/.env; SEED_AI=1 ./start.sh pre-warms AI reviews

# Full containerised stack: MariaDB + FastAPI + frontend + AI county reviews
make demo                                     # frontend http://localhost:5173, API :8000
make seed-ai                                  # optional: pre-seed stored AI reviews for all 23 areas
```

Two-minute walkthrough:
1. **National Overview (30 s):** Read the national headline → inspect the composite **All 6 stages** bottleneck map & **23 × 6 YTA Pathway Matrix** → click any pathway stage (`01 Detection` … `06 Outcome`) to drill into specific indicators.
2. **County Briefing & Review (60 s):** Click any county (e.g. *Kymenlaakso* for an `Act` lung-pathway bottleneck or *Southwest Finland* for a `Verify data` recording audit) → Priority Action #1 opens immediately with named owner, baseline vs rest-of-Finland comparator, FTE & indicative annual EUR envelope, local demographic tailoring, and 90-day steps → adjust the **What-if Ambition & Capacity Simulator** across local hospital units → **Export action plan (.md)** or **Print / PDF**.
3. **National Roadmap & AI Analyst (30 s):** Open **Analytics** for the **5-point National 2026–2031 Implementation Roadmap**, **2024 Screening Equity Strata** (20–22 pp language gap at Detection vs equal post-referral follow-up), and **3,870 automated validation checks** — or ask a question in the grounded **County AI Analyst** (streams verified citations + charts, with deterministic fallback when offline/unconfigured).

Without a `GEMINI_API_KEY` both county briefings *and* county chat fall back deterministically to the verified snapshot, so a live demo never dead-ends.

## How it fits together

```
public sources ──► scripts/ (collect, process, validate) ──► data/processed/*.csv
                                         │
                   scripts/build_pathway_snapshot.py (pathway_engine.py)
                                         ▼
                        data/processed/pathway_snapshot.json
                         │                               │
              backend/ (FastAPI, /api/v1/pathway,     frontend/ (bundled copy =
              AI reviews & chat grounded in           offline fallback, simulator,
              snapshot, peers, equity & PDFs)         23×6 matrix & national roll-up)
```

- [`data/catalog/recommendations.json`](data/catalog/recommendations.json): single source of truth for the seven action playbooks (steps, targets, FTE/unit-cost rules, timeline, escalation, 24/24 page-verified citations) covering all 23 areas plus 5 national roll-up actions.
- [`docs/DATA_GUIDE.md`](docs/DATA_GUIDE.md): datasets, leave-one-out comparators, referral proxies, costing assumptions, verdict rules and **limitations**.
- [`data/catalog/validation.json`](data/catalog/validation.json): 406 source-integrity checks reported separately from 3,464 analytical checks.
- [`data/catalog/downloads.json`](data/catalog/downloads.json), [`tables.json`](data/catalog/tables.json): provenance, hashes, queries and documented HTTP 403 access failures.

No patient-level or synthetic data is used. Findings are descriptive and not risk-adjusted; a missing record is not proof of missing care — the tool says "Verify data" when that is the likelier explanation.

## Verify

```bash
make check   # data smoke test + backend lint/tests + frontend build/tests/lint
make data    # rebuild the pathway snapshot and copy it into the frontend
```
