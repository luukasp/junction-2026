# Equal Care backend

FastAPI + SQLAlchemy + MariaDB scaffold for a React/Vite client. Backend code and
tests live here; stack configuration lives at the repository root. Input data remains
in `../data/processed`.

## Run with Docker

From the repository root:

```bash
test -f .env || cp .env.example .env
docker compose up --build -d
```

The frontend runs at http://localhost:5173. The API runs at http://localhost:8000,
Swagger at http://localhost:8000/docs,
and OpenAPI at http://localhost:8000/openapi.json. MariaDB is persisted in a named
volume. Compose waits for MariaDB, then runs `backend init-db && backend ingest` before
starting the API. Ingestion is idempotent: an unchanged snapshot (same file hashes) is a
no-op, so restarts are fast; a changed snapshot is replaced in one transaction.

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
test -f ../.env || cp ../.env.example ../.env
uv sync --extra dev
docker compose -f ../compose.yml up -d db
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

## Demographic API

`GET /api/v1/demographics` returns paginated screening observations with demographic
filters. `GET /api/v1/demographics/filters` discovers the exact published filter
values, years, programs and metrics. Both routes accept the same filters:

| Parameter | Values / meaning |
| --- | --- |
| `age_group` | Exact published age/band, such as `60`, `30-34`, or `Total` |
| `gender` | `male`, `female`, `total`, mapped from the source Sex values Men/Women/Total |
| `socioeconomic_status` | Unavailable in this snapshot; supplying it returns 422 with an explanation |
| `education_level` | `Primary education/unknown`, `Intermediate/secondary`, `Tertiary/higher education`, `Total` |
| `language` | Native-language groups: `Domestic`, `Other/missing`, `Total` |
| `geographic_location` | Published county/collaboration-area name, or `Whole country` |
| `geography_level` | `county`, `collaboration_area`, `national` |
| `area_code` | HVA county code, or `SSS` for national observations |
| `program` | `breast`, `cervix`, `colorectal` |
| `year`, `metric` | Exact observation year and metric label |

The data route accepts `limit` (1–1,000, default 100) and `offset` (default 0) and
returns `{items, total, limit, offset}`, ordered by observation ID. Each item retains
every original screening field, including raw values, suppression markers, dimensions,
strata and provenance, and adds a `demographics` object with the normalized fields
above. National observations have `demographics.area_code = "SSS"`, even when the
original `area_code` is NULL. Missing demographic dimensions remain NULL; they are
never inferred from the screening program or replaced with `Total`.

Examples (URL-encode spaces and special characters in query values):

```text
/api/v1/demographics/filters?program=colorectal&year=2024
/api/v1/demographics?program=colorectal&year=2024&age_group=60&gender=male
/api/v1/demographics?program=colorectal&year=2024&language=Other%2Fmissing&gender=male
/api/v1/demographics?education_level=Tertiary%2Fhigher%20education
/api/v1/demographics?area_code=HVA15&year=2024
/api/v1/demographics?geographic_location=Eastern%20Finland&geography_level=collaboration_area
```

Discovery is scoped by all supplied filters. Each entry under `filters` contains
`available`, `values` and `description`; `available` means the dimension has values
in the matching observations. Socio-economic status always has `available: false`:
education is a separate classification, not a substitute. The published data records
sex rather than gender identity and combines domestic languages rather than separating
Finnish and Swedish.

Filters are combined with AND on the **same observation**. The source publishes
separate breakdowns rather than a full demographic cross-tabulation. For example,
colorectal language and sex can be combined, but county plus education returns an
empty page because that combination is not published. Unrecognized string group
values also return an empty page; invalid program/gender/geography-level values and
pagination return 422. National, county and collaboration-area rows remain distinct
(Åland appears at both regional levels). Published totals and overlapping age bands
are preserved; these observations must not be summed across metrics, groups or
geographic levels. StatFin population counts and registry cancer outcomes remain
available from their existing county/data routes.

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
The frontend development server proxies `/api` to `http://127.0.0.1:8000`.
For separate hosting, set `VITE_API_BASE_URL` to the backend origin at frontend build
time, and allow that frontend origin in `CORS_ORIGINS`. Never put API keys in a
`VITE_` variable. The dashboard, map, county list, proposals and chat all use the API.

CORS allows `http://localhost:5173` and `http://127.0.0.1:5173` by default.
Set `CORS_ORIGINS` to a JSON array to allow other frontend origins.

`GET /health`, `GET /health/ready`, `GET /api/v1/datasets` and
`GET /api/v1/ingestion` remain available. `GET /api/v1/data/{dataset}` is deprecated
for county clients but retained for compatibility and archival/national data access.
Swagger documents the new county routes and response schemas at `/docs`.

To add the county indexes to an existing Docker installation and deploy the API:

```bash
docker compose -f ../compose.yml up --build -d api
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
duplicate-geography exclusion, existing-index upgrades, API filters, CORS,
database-unavailable responses, the pathway endpoints, AI grounding/ranking and the
deterministic briefing fallback (`tests/test_pathway.py`, using a small fixture snapshot).

## AI county reviews and executive chat

The repository-root `.env` is loaded by absolute source path, regardless of working directory.
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
uv run backend generate-proposals --all      # same as above, explicit pre-seeding
# One county, or explicitly create a new version:
uv run backend generate-proposals --area-code HVA90
uv run backend generate-proposals --area-code HVA90 --force
```

Generation skips an existing review for the same county, dataset fingerprint,
provider and model. Each successful county is committed independently; rerunning a
partially failed batch resumes missing reviews. Nonzero exit means some areas failed.
The UI can generate/regenerate one county and retrieves its latest saved review.

- `GET /api/v1/dashboard`: database-backed map and summary data.
- `GET /api/v1/counties/{area_code}/proposal`: latest saved review; if none exists and no
  LLM key is configured, a deterministic briefing (see below); otherwise null.
- `POST /api/v1/counties/{area_code}/proposal?force=false`: generate and persist. If the
  provider is unreachable/unconfigured and the county has no stored review, returns the
  deterministic briefing (unsaved) instead of 502.
- `POST /api/v1/counties/{area_code}/chat/conversations`: create an empty conversation.
- `GET /api/v1/counties/{area_code}/chat/conversations/{id}`: restore saved turns.
- `POST /api/v1/counties/{area_code}/chat/conversations/{id}/clear`: delete the conversation.
- `POST /api/v1/counties/{area_code}/chat` (or `/chat/stream` for SSE):
  `{question, conversation_id, version}`. Responses include `conversation_id` and the
  new `version`. Omit the ID to start a conversation; legacy `history` is accepted only
  when starting one. An outdated version returns 409; restore the conversation and retry.

`review_proposals` stores validated structured output, generation time, model/provider,
source fingerprint, the exact retrieved rows, and computed quality indicators. It is
excluded from data reimports. Older evidence snapshots remain auditable even when
source row IDs change; changed fingerprints show a stale-review notice in the UI.
Chat retrieves county data afresh and retains completed turns, structured answers and
their evidence in `chat_conversations`, independently of data reimports. Generation uses
the latest 12 saved messages for context. Failed or incomplete answers never add a turn.
The browser remembers each county's conversation ID in local storage and restores it
when the briefing reopens or the page reloads. Clear chat deletes the saved conversation.
Run `backend init-db` once on existing installations to create the new table. Conversations
use the same unauthenticated, localhost-only access model as the other AI routes.

Responses use a short takeaway, up to three bullets per finding/action, and optional
`visual_evidence_ids` selecting existing evidence rows. Reference validation also
applies to these visual selections. The frontend builds charts from the stored source
values, never from model-generated chart numbers. Older saved reviews gain the same
compact presentation immediately, with full paragraphs available in expandable details.

Retrieval uses exact county codes, question terms (matched against semantic label fields
only: program, metric, cause/sex labels, cancer, treatment type, never URLs or warnings),
headline priority (all-population strata and percentages before counts and sub-strata) and
recency (`year`, or the end year of `diagnosis_period`/`incidence_period`), with at most 24
observations per dataset and diversity across screening programs / StatFin datasets.
StatFin is restricted to key series: deaths and crude death rates for all causes, all
malignant neoplasms and screening/lung-related cancers (13u5), and core population
structure (11ra: residents, 65+ share, average age, density, language/foreign background,
rural share).
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

### Grounding sources and citable evidence ids

The model may cite only ids present in the retrieved evidence; any other id (e.g. an
invented `action:` or `policy:` id) fails validation, triggers one repair attempt and is
never stored.

| Evidence id | Source |
| --- | --- |
| `pathway:<code>:summary` | Snapshot headline, national headline and stage verdicts |
| `pathway:<code>:<indicator>` | Snapshot value, CI, n/d, verdict and national comparator |
| `action:<playbook_id>` | County action: stage, owner, baseline, target, volume, timeline, steps, citations |
| `policy:<id>` | `catalog/recommendations.json` (trigger, owner, measures, cited section/page/URL) |
| `policy_chunk:<chunk_id>` | Top-6 BM25 matches from `evidence_chunks.jsonl` (URL, page/section, excerpt) |
| `national:<dataset>:<id>` | Whole-Finland rows: outcomes (`SSS`), key StatFin series, matching screening % |
| `screening:<id>`, `statfin:<id>`, `outcomes:<id>`, `treatments:<id>` | County registry rows (as before) |

`CATALOG_DIR` (default `DATA_DIR/../catalog`) and `PATHWAY_SNAPSHOT_PATH` (default
`DATA_DIR/pathway_snapshot.json`) override the file locations. Missing files simply omit
that evidence type; `quality.grounding` reports what was available. The review fingerprint
also covers the snapshot build and recommendations, so a rebuilt snapshot marks reviews stale.

Proposals carry optional action-plan fields: `pathway_stage`, `baseline`, `target`,
`timeline`, `concrete_steps` (≤5) and `estimated_annual_volume` (number or null). The prompt
requires each proposal to cite an `action:`/`policy:` id and a pathway stage, to lead with the
key message and to put caveats afterwards. Older stored proposals without these fields are
returned unchanged and remain valid.

## Pathway snapshot API

`../data/processed/pathway_snapshot.json` is built by the data pipeline (not the backend)
and served read-only, reloaded automatically when the file changes.

| Endpoint | Response |
| --- | --- |
| `GET /api/v1/pathway` | Whole snapshot: `built`, `national_headline`, `stages[]`, `indicators[]`, `national{}`, `verdicts`, `counties[]` |
| `GET /api/v1/pathway/{area_code}` | One county: `code`, `name`, `headline`, `stage_verdicts`, `values{<ind>: {v, lo, hi, n, d, comparator, verdict}}`, `actions[]` |

Both return 503 with a clear `detail` if the snapshot is missing or invalid; the county
route returns 404 for a code not in the snapshot.

## Demo checklist

```bash
# From the repository root:
docker compose up --build -d          # init-db + idempotent ingest + API + frontend
# Optional with a GEMINI_API_KEY in .env: pre-seed every county so the demo never waits
docker compose exec api backend generate-proposals --all
```

Without an API key (or when the provider is down), opening a county briefing still works:
the backend builds a deterministic, unsaved briefing from the snapshot's actions
(`provider: "deterministic"`, `model: "pathway-snapshot"`, `fallback: true`, `id: null`).
Its summary is the county headline, findings are stage verdicts with cited indicator rows,
and proposals are the snapshot actions with baseline, target, timeline, steps and volume.
It needs `pathway_snapshot.json`; without it the endpoint behaves as before.
