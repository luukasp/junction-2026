# Equal Care Finland

Shows where in the cancer care pathway each Finnish wellbeing services county falls
behind, and what to do about it. Run from this directory with a Node.js version
supported by Vite.

```sh
npm ci
npm run dev
npm run build
npm run lint
npm test
npm run snapshot   # refresh the bundled offline snapshot
```

## Run with Docker

From the repository root, run `test -f .env || cp .env.example .env`, then
`docker compose up --build -d`. Open http://localhost:5173. The frontend image
builds the app with Node.js and serves the production assets with Nginx, which
proxies `/api` and `/health` to the API container. LLM credentials stay in the API
container; configure them in the root `.env`.

## What the screen shows

The page opens with a plain-English national headline from the pathway snapshot
(`national_headline`). If it is missing, the headline is computed from the lung
treatment rows, for example "4,049 of 14,774 lung cancer patients (27.4%) have no
recorded treatment — 16.4% to 43.1% by county".

The stage strip follows the pathway: Detection → Follow-up → Referral (proxies) →
Diagnosis & records → Treatment → Outcome. Each stage shows how many areas have an
Act or Verify signal, or the selected county's status. Selecting a stage or one of
its indicators recolours the map and reorders the area list. Statuses are Act,
Verify data, Monitor, In line and No data. The lung "no treatment record" view is
one of the indicators and stays the default.

Selecting an area opens the executive briefing: the county headline, status per
pathway stage, every indicator signal against the national value, and the snapshot
actions with baseline, target, annual volume, owner, first 90 days, escalation and
citations. **Export action plan** downloads the same content as Markdown. It runs
in the browser and needs neither the backend nor AI. The AI review and chat
(`CountyAI`) appear below it when the backend is reachable.

Figures are descriptive and unadjusted. Missing documentation can reflect
incomplete reporting rather than missing treatment, and referral stages use
proxies.

## Data sources and offline fallback

Run the backend on port 8000 (see `../backend/README.md`), then `npm run dev`.
Vite proxies `/api` to that backend. The app requests:

- `GET /api/v1/dashboard`: lung treatment-record counts per area (KPIs, fallback list)
- `GET /api/v1/pathway`: the pathway snapshot (`data/processed/pathway_snapshot.json`); types are in `src/data/pathway.ts`

When a request fails, or the database has no imported data, the app loads the
bundled copies and shows "Backend offline — showing cached snapshot":

- `src/data/countyLungTreatment.json` replaces `/dashboard`. It joins the
  `Ei hoitotietoa` rows of `data/processed/county_lung_treatment_2019_2023.csv` with
  `data/processed/regions.csv` by HVA code (from
  [commit 8cc42e9](https://github.com/luukasp/junction-2026/tree/8cc42e9de5549f05608fd03259cc8815170335e3)).
- `src/data/pathway_snapshot.json` replaces `/pathway`. `npm run snapshot` copies
  `../data/processed/pathway_snapshot.json` here after a basic schema check. If that
  file does not exist, the existing bundled copy is kept. If neither exists,
  the script writes a lung-only placeholder built from `countyLungTreatment.json`,
  marked `"placeholder": true`, which the page notes in its caveats.
  `npm run snapshot -- --placeholder` rebuilds the placeholder on purpose.

Both fallbacks are separate chunks loaded only when needed. Area codes are
`HVA01`–`HVA21`, `HVA90` (City of Helsinki) and `HVA91` (Åland). The map uses the
repository's `dashboard/vendor_data/hva_4500k.json` boundaries, with polygon winding
normalized for d3-geo.

For separate production hosting, set `VITE_API_BASE_URL` at build time and configure
backend CORS. Never put `GEMINI_API_KEY` or other credentials in frontend variables.

AI responses use the OpenUI renderer with components adapted from Open Intelligent
UI; attribution and its MIT license are in `src/components/intelligent-ui/`. Source
rows are shown with readable field names, English translations of Finnish registry
labels (for example `Ei hoitotietoa` → No treatment record, `Parantava` → Curative)
and strata as chips.

Tests cover the pathway helpers and Markdown export, the offline fallback, stage and
indicator switching, readable evidence labels and the map.

## Interactive map and care centers

Drag the map to pan; scroll, pinch, or use the zoom buttons to zoom. When the map
has keyboard focus, arrow keys pan, + / − zoom, and Home returns to Finland.
Selecting a county on the map or in the county selector fits its actual boundary
and lists its major care centers. Select a city marker or a list entry to see the
hospital name, visiting address, provider, facility type, and provider website.
The separate Open briefing action opens the existing county review.

`src/data/careCenters.json` contains 26 major hospitals across all 23 mapped areas,
including Helsinki and Åland, with one or two centers per area. These are selected
major facilities, rather than an exhaustive directory or a ranking. Names and
visiting addresses were checked against the linked provider pages and the Finnish
Service Data Repository (PTV) on 14 November 2026, including the new Ahvenisto
Hospital and Jorvi's Karvasmäentie entrance. Each entry retains its provider
`sourceUrl` and coordinate `locationSourceUrl`. PTV coordinates were converted from
ETRS-TM35FIN (EPSG:3067) to longitude/latitude (EPSG:4326); the remaining coordinates
come from OpenStreetMap. The app uses the bundled directory without runtime
geocoding requests. Coordinate attribution: © OpenStreetMap contributors,
[ODbL](https://www.openstreetmap.org/copyright), and the
[Finnish Service Data Repository](https://api.palvelutietovaranto.suomi.fi/).

Map tests cover county containment for every center, directory coverage, viewport
fitting, zoom limits, mouse dragging, wheel/trackpad zoom, keyboard navigation,
county selection, center details, external selection, and load-error recovery.
