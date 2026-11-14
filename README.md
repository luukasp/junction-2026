# Equal Care Finland

Explore where cancer care gaps emerge across Finland's wellbeing services counties, inspect the evidence, and export a practical county action plan.

Built for the **Junction 2026 AstraZeneca challenge, “Equal Care Across Finland”**, Equal Care Finland combines public cancer registry and Statistics Finland data with an interactive map, pathway indicators, and optional evidence-grounded AI briefings.

## Features

- **National Overview:** explore detection, follow-up, referral proxies, diagnosis and records, treatment, and outcomes. Select a stage or indicator to see county signals on the map.
- **County Review:** inspect baselines, comparators, uncertainty, and suggested actions with owners, targets, workload estimates, first-90-days steps, and citations. Export the action plan as Markdown.
- **Equity Analysis:** compare published screening attendance by education, language, age, sex, or geography, and inspect a screening funnel for a selected cohort. Source rows and report links remain available for inspection.
- **Interactive map:** pan and zoom across 23 mapped areas, including Helsinki and Åland, and inspect selected major care centers and their provider links.
- **Optional AI:** generate county reviews, ask follow-up questions, and create screening equity briefings from evidence retrieved by the backend. Validated generated reviews and equity briefings are saved for reuse.

The map uses **Act**, **Verify data**, **Monitor**, **In line**, and **No data** signals. These support local investigation; they are not clinical diagnoses or a ranking of care quality.

## Choose how to run it

| Mode | Requirements | Available features |
| --- | --- | --- |
| Frontend demo | Node.js and npm | Bundled national and county data, map, deterministic action plans, Markdown export |
| Full stack | Docker Desktop or Docker Engine with Compose v2 | Frontend features plus database-backed county and demographic APIs and Equity Analysis |
| Full stack with AI | Full stack plus a supported provider and API key | Generated county reviews, chat, and equity briefings |

The frontend demo uses checked-in snapshots when the API is unavailable. **Equity Analysis has no offline data fallback.** Installing dependencies initially requires network access; exploring the bundled demo data does not require downloading source reports.

## Installation

Clone the repository and enter its directory:

```sh
git clone https://github.com/luukasp/junction-2026.git
cd junction-2026
```

### Frontend demo

Use **Node.js 24 with npm**, matching the frontend Docker build.

```sh
cd frontend
npm ci
npm run dev
```

Open the local URL printed by Vite, normally [http://localhost:5173](http://localhost:5173). Without the backend, the app displays a cached-snapshot notice. National and county exploration and action-plan export still work.

To create and preview a production build:

```sh
npm run build
npm run preview
```

Vite's development server proxies `/api` and `/health` to `http://127.0.0.1:8000`. The preview command serves built assets; use the Compose stack for the configured Nginx API proxy.

### Full stack with Docker

Run these commands from the repository root. Before the first start, copy `.env.example` to `.env` and adjust settings as needed. Leave the API keys empty to start without AI.

PowerShell:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
docker compose up --build -d
```

macOS/Linux shell:

```sh
test -f .env || cp .env.example .env
docker compose up --build -d
```

Compose starts MariaDB, creates missing database tables, imports the bundled CSV data, starts FastAPI, and then serves the frontend through Nginx. The first build and import can take time.

| Service | Address |
| --- | --- |
| Application | [http://localhost:5173](http://localhost:5173) |
| API documentation (Swagger UI) | [http://localhost:8000/docs](http://localhost:8000/docs) |
| OpenAPI schema | [http://localhost:8000/openapi.json](http://localhost:8000/openapi.json) |
| API readiness and import status | [http://localhost:8000/health/ready](http://localhost:8000/health/ready) |
| MariaDB | `127.0.0.1:3306` |

Useful lifecycle commands:

```sh
docker compose ps
docker compose logs -f api
docker compose down
docker compose exec api backend init-db
docker compose exec api backend validate
docker compose exec api backend ingest
```

The database persists in the `mariadb_data` named volume. `docker compose down` preserves it. Unchanged CSV imports are skipped; changed snapshots replace imported source data transactionally. Configure database credentials before the first database start: changing `.env` later does not change credentials already stored in the database volume.

The supplied credentials and localhost port bindings are intended for local development. The API is unauthenticated, including AI generation and chat; add access controls before exposing it publicly.

### Enable AI (optional)

Edit the repository-root `.env`. The backend supports two provider modes:

| Provider | Configuration |
| --- | --- |
| Gemini | `LLM_PROVIDER=gemini`, `GEMINI_API_KEY`, and `LLM_MODEL` |
| OpenAI-compatible Chat Completions API | `LLM_PROVIDER=openai-compatible`, `LLM_API_KEY`, `LLM_BASE_URL`, and `LLM_MODEL` |

Choose a model available to your account that supports the provider's required JSON output. The Gemini integration requests JSON-schema output; the compatible integration calls `/chat/completions` with JSON-object output. The sample model setting is configuration, not a guarantee of provider availability. `LLM_TIMEOUT_SECONDS` defaults to `120`.

After changing `.env`, recreate the API container:

```sh
docker compose up -d api
```

Keep credentials on the backend. Never place API keys in `VITE_` variables, which are embedded in the browser bundle. AI generation sends selected public evidence and the question to the configured provider and may incur provider charges.

Snapshot action plans and their exports work without AI. Backend county reviews can also return a deterministic snapshot briefing when a fallback is available; chat and generated equity briefings require a working AI provider.

To generate and save county reviews ahead of a demo, after importing data and configuring AI:

```sh
docker compose exec api backend generate-proposals --all
```

Use `--area-code HVA01` instead of `--all` for one county. Existing matching reviews are reused; `--force` generates new versions.

## Local development

For development outside containers, install **Python 3.11+**, **uv**, and **Node.js 24 with npm**. Use MariaDB locally or start only the database with Compose. Create the root `.env` as above; its default `DATABASE_URL` connects to the database's published localhost port.

From the repository root:

```sh
docker compose up -d db
cd backend
uv sync --extra dev
uv run backend init-db
uv run backend validate
uv run backend ingest
uv run uvicorn app.main:app --reload --port 8000
```

Wait until the database is healthy before running `init-db`. In a second terminal, from the repository root:

```sh
cd frontend
npm ci
npm run dev
```

`backend validate` parses the import files without using the database. `init-db` creates missing tables and indexes; it does not migrate existing columns. Environment variables override the root `.env` settings.

For a separately hosted frontend, set `VITE_API_BASE_URL` to the API origin **at build time**, then configure the backend's `CORS_ORIGINS` as a JSON array of allowed frontend origins. The frontend appends `/api/v1` to that base URL.

## Data and interpretation

The repository includes public aggregate observations, extracted report tables, source text, provenance catalogs, and generated snapshots. Core sources are Finnish Cancer Registry screening and cancer quality reports, Statistics Finland datasets, and the supplied national cancer strategy and implementation roadmap. No patient-level or synthetic observations are used.

Coverage depends on the indicator and reporting period. Mapping 23 areas does not mean every source covers all of them: Åland is absent from the lung and regional outcome tables. Published denominators, suppression, and unavailable values must remain distinct.

When counts are available, pathway comparisons generally use the **rest of Finland**, excluding the selected county. Survival and mortality use the published national comparator. Signals combine uncertainty, gap size, and data-quality checks; the full method and thresholds are documented in the [data guide](docs/DATA_GUIDE.md).

Interpret results with these limits in mind:

- A missing treatment record is not proof that treatment was absent. Recording gaps need investigation.
- Referral indicators are proxies, not measurements of referral waiting time.
- Comparisons do not fully adjust for stage, age, comorbidity, or other case mix. Some reported rates are age-standardised, which is not full clinical risk adjustment.
- Lung treatment categories overlap, and pooled 2019–2023 observations cannot establish annual trends or causation.
- Action-plan volumes estimate workload, not expected health benefits. Proposed targets and actions need local clinical and operational review.

### Rebuild bundled pathway data

From the repository root, with Python 3.11+ and Node.js installed:

```sh
python scripts/build_pathway_snapshot.py
cd frontend
npm run snapshot
```

The Python builder validates source integrity and analytical consistency, writes `data/processed/pathway_snapshot.json`, and updates the validation report. It uses the Python standard library and the checked-in inputs. The npm command copies the generated snapshot into the frontend bundle. Rebuild the production frontend or let the development server reload to use the updated bundle.

This does not recollect public sources or reimport the database. After updating CSV inputs, run `backend validate` and `backend ingest` in your backend environment, or `docker compose exec api backend ingest` for a running Compose stack.

For the complete collection and processing sequence, including the Python data dependencies and Poppler `pdftotext` requirement, see [Reproduce in the data guide](docs/DATA_GUIDE.md#reproduce). Collection accesses external publishers; cached source files and acquisition failures are recorded in the catalogs.

## Checks

From the repository root:

```sh
python scripts/smoke_pathway.py
```

Backend checks, from `backend/`:

```sh
uv sync --extra dev
uv run ruff check .
uv run pytest -q
```

Backend tests use an in-memory SQLite database by default. If you set `TEST_DATABASE_URL`, use a disposable database: the test fixture creates and drops project tables.

Frontend checks, from `frontend/`:

```sh
npm ci
npm run build
npm test
npm run lint
```

If GNU Make is installed, `make check` runs the data, backend, and frontend checks together; install the backend development dependencies first. `make data` rebuilds and copies the pathway snapshot, and `make demo` starts the Compose stack in the foreground.

## Project layout

| Path | Purpose |
| --- | --- |
| [`frontend/`](frontend/README.md) | React, TypeScript, and Vite application; bundled offline data; Nginx configuration |
| [`backend/`](backend/README.md) | FastAPI API, SQLAlchemy models, CSV importer, AI provider integration, and tests |
| [`scripts/`](scripts/) | Source collection, processing, evidence indexing, validation, and snapshot generation |
| [`data/raw/`](data/raw/) | Archived source responses and extracted report text |
| [`data/processed/`](data/processed/) | Curated CSVs, extracted tables, evidence chunks, and generated pathway snapshot |
| [`data/catalog/`](data/catalog/) | Source provenance, hashes, queries, validation reports, and action playbooks |
| [`docs/DATA_GUIDE.md`](docs/DATA_GUIDE.md) | Dataset definitions, methodology, limitations, and reproduction instructions |
| [`compose.yml`](compose.yml) | MariaDB, API, and frontend services |
| [`.env.example`](.env.example) | Local configuration template |

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Cached-snapshot notice | Check `docker compose ps` and API logs. Read `/health/ready` and confirm `data_loaded` is `true`, then use **Retry live data** in the app. |
| Equity Analysis has no data | Start the backend and import the CSV data. This view cannot use the bundled pathway snapshot. Some cohort comparisons are also unpublished. |
| AI generation fails | Check the selected provider's key, model access, JSON-output support, rate limits, and timeout. Keep these settings in the backend environment. |
| Database connection fails | Wait for MariaDB health, check `DATABASE_URL` and the credentials used when the volume was created, and inspect `docker compose logs db`. |
| A port is already in use | Check for services using ports `5173`, `8000`, or `3306`. Stop the conflicting service or adjust the port mapping and any affected proxy/database settings. |
| Updated data is missing | Refresh the frontend snapshot and rebuild its bundle; reimport changed CSVs into the backend. Changing one does not refresh the other. |

## License and attribution

Project code is available under the [MIT License](LICENSE). Third-party reports and datasets retain their publishers' terms; public access does not imply a blanket redistribution license. Preserve source links and attribution, and check publisher terms before redistributing source material.

The frontend includes adapted Open Intelligent UI components with a [local MIT license](frontend/src/components/intelligent-ui/LICENSE). Care-center coordinate attribution and provider references are documented in the [frontend README](frontend/README.md#interactive-map-and-care-centers).
