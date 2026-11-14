# Equal Care backend

FastAPI + SQLAlchemy + MariaDB scaffold for a React/Vite client. All backend code,
configuration and tests live here; input data remains in `../data/processed`.

## Run with Docker

From this directory:

```bash
test -f .env || cp .env.example .env
docker compose up --build -d
docker compose exec api backend ingest
```

The API runs at http://localhost:8000, Swagger at http://localhost:8000/docs,
and OpenAPI at http://localhost:8000/openapi.json. MariaDB is persisted in a named
volume. Compose waits for MariaDB and creates missing tables before starting the API.
The separate import command loads all 341 CSVs; startup does not automatically import data.

Default credentials and localhost bindings are for local development. Set credentials
in `.env` before the first database start. The local-development API is unauthenticated, including proposal generation and chat.
Keep it bound to localhost; add access controls before exposing it to other users.

```bash
docker compose logs -f api
docker compose down             # preserve the database volume
```

## Local Python development

Requires Python 3.11+ and a running MariaDB instance. From `backend/`:

```bash
test -f .env || cp .env.example .env
uv sync --extra dev
docker compose up -d db
uv run backend init-db
uv run backend validate
uv run backend ingest
uv run uvicorn app.main:app --reload --port 8000
```

Alternatively, use `python -m venv .venv` and install with
`.venv/bin/pip install -e '.[dev]'`. `DATABASE_URL` uses the SQLAlchemy
`mysql+pymysql://` driver. Environment variables override `.env`.
`DATA_DIR` defaults to the repository's `data/processed` directory; `--data-dir`
overrides it for `validate` and `ingest`.

`init-db` creates missing tables, **not migrations for existing tables**. The schema
is defined in `app/models.py`; `schema.sql` is a generated MariaDB DDL reference.
Add versioned migrations before changing a persisted production schema.

## Schema and duplicate handling

| Table | Input | Imported rows |
| --- | --- | ---: |
| `regions` | `regions.csv` | 23 |
| `screening_observations` | Both screening CSVs, merged by `(table_id, source_row, metric)` | 24,585 |
| `statfin_observations` | All three `statfin_*.csv` files, distinguished by dataset | 45,328 |
| `cancer_outcomes` | `regional_cancer_outcomes_2024.csv` | 140 |
| `lung_treatments` | `county_lung_treatment_2019_2023.csv` | 106 |
| `source_tables` | Metadata for all `tables/*.csv` | 333 |
| `source_rows` | Archival rows for all source tables | 6,709 |
| `ingestion_state` | Last successful snapshot hashes, counts and UTC timestamp | 1 |

The 12,864 county screening rows enrich existing observations with area code, unit,
strata and county section. They never become a second copy of the observation.
Conflicting or unmatched county observations fail the import. Original dimensions
and section text remain available alongside county metadata.

StatFin uses one shared observation table with typed year, measure, value, area,
sex and cause fields. `dimensions` retains the original classification identifiers,
codes and labels. Dataset remains part of the unique key: population, national
mortality and regional mortality are distinct series, even where values overlap.
StatFin codes are preserved exactly, without collapsing `MA2`, `KU091` or `SSS`
into HVA codes. Registry `area_code` can also be `SSS` for national totals or NULL
for collaboration areas. Consequently area codes are indexed join fields, not
foreign keys to the county-only region lookup; known registry codes are validated
on import. Source rows have a composite primary key and a foreign key to source tables.

The 333 heterogeneous source CSVs share two archival tables instead of generating
333 SQL tables (or 81 separate header-layout tables). Headers and positional cell
arrays preserve ordering, duplicate/blank headers, suppression markers and original
strings. The optional `../data/catalog/tables.json` adds headings, captions and
source metadata. Archives overlap the curated data: do not sum them together.

Numeric blanks become SQL NULL, never zero. Raw screening values, outcome intervals,
StatFin statuses, treatment warnings and source URLs are preserved. Screening
strata and denominators must remain distinct when comparing metrics. See the
repository's `docs/DATA_GUIDE.md` for interpretation limits.

`evidence_chunks.jsonl` is retrieval text, not CSV observations, and is intentionally
outside this CSV importer.

## Ingestion behavior

```bash
uv run backend validate                     # parse and validate without a database
uv run backend ingest                       # import changed snapshots
uv run backend ingest --force               # replace even if hashes are unchanged
uv run backend ingest --data-dir /path/to/processed
```

The importer expects the complete eight curated files plus source CSVs in `tables/`.
It reads a snapshot, validates headers, row widths, numbers, dates, JSON dimensions,
registry area codes and screening overlap, then replaces all imported rows in one
InnoDB transaction. Database unique constraints also reject duplicate observations.
A failed import rolls back all deletes/inserts and preserves the previous import state.
A MariaDB advisory lock prevents concurrent imports. DML `DELETE`, rather than
`TRUNCATE`, preserves transactional rollback.

Hashes include every CSV, the optional table catalog and parser version. Identical
snapshots are a no-op; changed snapshots replace the previous snapshot rather than
append records. Omitted rows disappear on successful replacement. Database surrogate
IDs are internal and may change after imports; use source identities in clients.
The importer loads the snapshot in memory, which suits this data bundle; larger
feeds should use staging tables and bounded streaming imports.

## API and Vite integration

- `GET /health` — process health.
- `GET /health/ready` — database/schema availability and whether data is loaded.
- `GET /api/v1/datasets` — dataset names and columns.
- `GET /api/v1/ingestion` — last successful import metadata.
- `GET /api/v1/data/{dataset}` — paginated records.

Dataset names: `regions`, `screening`, `statfin`, `outcomes`, `treatments`,
`source-tables`, `source-rows`. Responses use
`{ "items": [...], "total": 23, "limit": 100, "offset": 0 }`.
Ordering is by primary key; maximum page size is 1,000.

Available exact-match filters: `area_code`, `year`, `program`, `cancer`, `sex`,
`metric`, `metric_code`, `statfin_dataset`, `table_id`. A filter that does not
apply to the chosen dataset returns 422. SQL identifiers come from a fixed allowlist,
and filter values are parameterized.

```text
/api/v1/data/screening?area_code=HVA15&program=breast&year=2024
/api/v1/data/outcomes?cancer=lung&sex=female
/api/v1/data/statfin?statfin_dataset=statfin_13u5&year=2024
/api/v1/data/source-rows?table_id=lung_2019_2023_t010
```

The frontend development server proxies `/api` to `http://127.0.0.1:8000`.
For separate hosting, set `VITE_API_BASE_URL` to the backend origin at frontend build
time, and allow that frontend origin in `CORS_ORIGINS`. Never put API keys in a
`VITE_` variable. The dashboard, map, county list, proposals and chat all use the API.

CORS allows `http://localhost:5173` and `http://127.0.0.1:5173` by default.
Set `CORS_ORIGINS` to a JSON array to allow other frontend origins.

## Verification

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

Tests default to an in-memory SQLite database for speed and exercise the real
processed data. To run the same tests against MariaDB, set `TEST_DATABASE_URL`
to a **disposable database**: the suite creates and drops the backend tables.

```bash
TEST_DATABASE_URL='mysql+pymysql://user:password@localhost:3306/test_database' uv run pytest
```

The suite covers full-data counts, deduplication, NULL preservation, national codes,
unchanged/forced imports, conflict rejection, malformed CSVs, rollback after a
mid-import failure, API filters, CORS and database-unavailable responses.

## AI county reviews and executive chat

`backend/.env` is loaded by absolute source path, regardless of working directory.
Keep the existing `GEMINI_API_KEY` there. Gemini calls use `x-goog-api-key`, and
provider error bodies are never returned to the browser or printed by the CLI.

```dotenv
LLM_PROVIDER=gemini
LLM_MODEL=gemini-4-carbon
```

To use another provider implementing Chat Completions with JSON-object output:

```dotenv
LLM_PROVIDER=openai-compatible
LLM_BASE_URL=https://your-provider.example/v1
LLM_MODEL=your-model-id
LLM_API_KEY=your-server-side-key
```

Restart the backend after changing settings. `LLM_TIMEOUT_SECONDS` defaults to 120.
The provider boundary is `app/llm.py`; add another adapter there for a different wire
protocol. No frontend changes are needed to switch models or compatible providers.

Initialize the added table and generate persisted reviews for every area:

```bash
uv run backend init-db
uv run backend ingest
uv run backend generate-proposals
# One county, or explicitly create a new version:
uv run backend generate-proposals --area-code HVA90
uv run backend generate-proposals --area-code HVA90 --force
```

Generation skips an existing review for the same county, dataset fingerprint,
provider and model. Each successful county is committed independently; rerunning a
partially failed batch resumes missing reviews. Nonzero exit means some areas failed.
The UI can generate/regenerate one county and retrieves its latest saved review.

- `GET /api/v1/dashboard`: database-backed map and summary data.
- `GET /api/v1/counties/{area_code}/proposal`: latest saved review, or null.
- `POST /api/v1/counties/{area_code}/proposal?force=false`: generate and persist.
- `POST /api/v1/counties/{area_code}/chat`: `{question, history: [{role, content}]}`.

`review_proposals` stores validated structured output, generation time, model/provider,
source fingerprint, the exact retrieved rows, and computed quality indicators. It is
excluded from data reimports. Older evidence snapshots remain auditable even when
source row IDs change; changed fingerprints show a stale-review notice in the UI.
Chat retrieves county data afresh and is retained only while that briefing is open.

Responses use a short takeaway, up to three bullets per finding/action, and optional
`visual_evidence_ids` selecting existing evidence rows. Reference validation also
applies to these visual selections. The frontend builds charts from the stored source
values, never from model-generated chart numbers. Older saved reviews gain the same
compact presentation immediately, with full paragraphs available in expandable details.

Retrieval uses exact county codes, question terms and recency, with at most 24
observations per dataset and diversity across screening programs / StatFin datasets.
The full original dimensions, periods, units, confidence intervals, warnings and source
URLs travel with each selected row. Coverage counts and missing numeric cells describe
all county rows, not a model confidence score. National totals and nonmatching
geographies are not silently substituted. This is bounded retrieval, not an exhaustive
analysis or semantic search over the strategy PDFs. Model text still needs human review;
validated citation IDs prove the cited row exists, not that every inference is correct.

The frontend uses OpenUI's renderer and restricted components adapted from
[Open Intelligent UI](https://github.com/thesysdev/open-intelligent-ui), with its MIT
notice included. Validated JSON becomes escaped OpenUI text/cards; generated HTML,
JavaScript, arbitrary model links and UI actions are not executed. Original source links
come from retrieved database rows. Renderer errors fall back to readable text.
