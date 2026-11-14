# Equal Care backend

FastAPI + SQLAlchemy + MariaDB scaffold for a React/Vite client. All backend code,
configuration and tests live here; input data remains in `../data/processed`.

## Run with Docker

From this directory:

```bash
cp .env.example .env
docker compose up --build -d
docker compose exec api backend ingest
```

The API runs at http://localhost:8000, Swagger at http://localhost:8000/docs,
and OpenAPI at http://localhost:8000/openapi.json. MariaDB is persisted in a named
volume. Compose waits for MariaDB and creates missing tables before starting the API.
The separate import command loads all 341 CSVs; startup does not automatically import data.

Default credentials and localhost bindings are for local development. Set credentials
in `.env` before the first database start. The read API is unauthenticated; database
writes are available only through the administrative CLI.

```bash
docker compose logs -f api
docker compose down             # preserve the database volume
```

## Local Python development

Requires Python 3.11+ and a running MariaDB instance. From `backend/`:

```bash
cp .env.example .env
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

`init-db` creates missing tables and indexes, including the county indexes on existing
installations, without reloading data. It does not alter existing columns. The schema
is defined in `app/models.py`; `schema.sql` is a generated MariaDB DDL reference.
Add versioned migrations before changing persisted columns.

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

County screening data is stored in `screening_observations` with indexed `area_code`
and a composite `(area_code, year, program)` index. StatFin has an `area_code` index
and a composite `(area_code, dataset, metric_code, year)` index. All published HVA
rows already carry their county code; national and collaboration-area observations
remain distinct rather than being assigned to individual counties.

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

## County API and Vite integration

All county routes use the HVA area codes from `regions.csv` (for example `HVA15`).
The directory includes Helsinki (`HVA90`) and Åland (`HVA91`). Unknown codes and
aggregate/duplicate geographies (`SSS`, `MA1`, `MA2`, `KU091`) return 404 on county
routes. A valid county with no observations in a dataset returns an empty page.

| Endpoint | Response / filters |
| --- | --- |
| `GET /api/v1/counties` | Paginated county directory |
| `GET /api/v1/counties/{area_code}` | County labels and geography metadata |
| `GET /api/v1/counties/{area_code}/screening` | Screening observations; `year`, `program`, `metric` |
| `GET /api/v1/counties/{area_code}/statfin` | StatFin observations; `year`, `dataset`, `metric_code`, `cause_code` |
| `GET /api/v1/counties/{area_code}/outcomes` | Cancer outcomes; `cancer`, `sex` |
| `GET /api/v1/counties/{area_code}/treatments` | Lung treatment observations; `treatment_type_fi` |
| `GET /api/v1/counties/{area_code}/aggregate` | Latest county indicators and patient series |
| `GET /api/v1/counties/aggregate` | Totals across all 23 canonical county codes |

Collection endpoints accept `limit` (1–1,000) and `offset` and return
`{ "items": [...], "total": 23, "limit": 100, "offset": 0 }`, ordered by primary key.
StatFin county datasets are `statfin_11ra` and `statfin_13u5`; `statfin_11ay` is
national-only and remains available through the legacy data API.

Examples:

```text
/api/v1/counties/HVA15/screening?program=breast&year=2024
/api/v1/counties/HVA15/statfin?dataset=statfin_13u5&metric_code=ksyylkm&cause_code=04-21&year=2025
/api/v1/counties/HVA15/outcomes?cancer=lung&sex=female
/api/v1/counties/HVA15/aggregate
/api/v1/counties/aggregate?area_codes=HVA15&area_codes=HVA90
```

### Aggregate semantics

Both aggregate routes return `area_codes`, `indicators` and `patients`. Pass repeated
`area_codes` parameters to aggregate a subset; duplicate codes are counted once.
The default collection aggregate includes all 23 directory entries exactly once.
It excludes national/mainland totals, `KU091` (duplicate Helsinki) and `MA2`
(duplicate Åland). It never adds national observations to county observations.

`indicators` contains `residents`, language-group counts, foreign citizens, people
born abroad, people with foreign background, all-cause `deaths` and `cancer_deaths`.
Population measures come from `statfin_11ra`; deaths come from `statfin_13u5` using
`ksyylkm`, with cause `SSS` for all deaths and `04-21` for malignant neoplasms.
Percentages and rates are not summed, and overlapping indicators are separate series.

Each indicator uses its latest year across canonical county rows (2025 in the current
snapshot), independently of other indicators. Responses include the year, dataset,
metric/cause codes, source URLs and coverage. A missing latest county row does not
fall back to an older year. `value` is NULL if any requested county has a missing or
status-flagged observation; `available_total` gives the sum of usable observations,
with `counties_reporting`, `counties_expected` and `missing_area_codes` identifying
partial coverage. No observations yields NULL rather than zero.

For example, the county aggregate response includes:

```json
{
  "area_codes": ["HVA15"],
  "indicators": {
    "residents": {
      "value": 273731,
      "available_total": 273731,
      "year": 2025,
      "dataset": "statfin_11ra",
      "metric_code": "vaerak-vaesto",
      "counties_reporting": 1,
      "counties_expected": 1,
      "missing_area_codes": []
    }
  }
}
```

This abbreviated example omits the other indicators and provenance fields.

The supplied StatFin files contain **no patient counts**. Accordingly `patients.total`
is NULL with an explanation. `patients.by_cancer` provides the latest registry
prevalence counts per cancer and sex, plus incident cases and deaths, with the
cohort period and prevalence definition. Current registry periods are 2020–2024,
not the 2025 StatFin period. Different cancers/sex groups and lung treatment
categories are never summed into a supposed unique-patient total.

For each registry series, `patients` is NULL when coverage is incomplete, while
`available_patients` reports the count across published counties. Åland lacks
curated regional outcomes, so the default all-county patient series have partial
coverage; a subset of covered counties has complete totals. Rates, confidence
intervals and detailed provenance remain available from the county outcomes route.

### Client setup and operational routes

Set `VITE_API_URL=http://localhost:8000` in your frontend environment:

```ts
const baseUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const areaCode = "HVA15";
const response = await fetch(
  `${baseUrl}/api/v1/counties/${encodeURIComponent(areaCode)}/aggregate`
);
if (!response.ok) throw new Error(`API error: ${response.status}`);
const summary = await response.json();
const residents = summary.indicators.residents.value;
```

CORS allows `http://localhost:5173` and `http://127.0.0.1:5173` by default.
Set `CORS_ORIGINS` to a JSON array to allow other frontend origins.

`GET /health`, `GET /health/ready`, `GET /api/v1/datasets` and
`GET /api/v1/ingestion` remain available. `GET /api/v1/data/{dataset}` is deprecated
for county clients but retained for compatibility and archival/national data access.
Swagger documents the new county routes and response schemas at `/docs`.

To add the county indexes to an existing Docker installation and deploy the API:

```bash
docker compose up --build -d api
```

The startup `backend init-db` command creates missing indexes automatically.
No CSV reimport is needed for this update.

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
mid-import failure, county isolation, latest-year aggregates, missing-data coverage,
duplicate-geography exclusion, existing-index upgrades, API filters, CORS and
database-unavailable responses.
