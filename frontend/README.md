# National Cancer Care Pathway

Run from this directory with a Node.js version supported by Vite.

```sh
npm ci
npm run dev
npm run build
npm run lint
```

The dashboard supports documentation review. The map shows the published percentage of lung cancer patients without a treatment record in the registry observation window. Its 25% and 30% breakpoints group rates for display. The table can be sorted by missing count for audit workload or by missing share for concentration. The pooled comparison divides the total missing count by the total number of patients across reporting areas, including the selected area.

Missing documentation can reflect incomplete reporting. The figures are descriptive and unadjusted. Treatment delivery, care delays, and intervention effects require separate evidence. The briefing presents the review proposal and proposed owner from the repository.

The bundled snapshot comes from [junction-2026 commit 8cc42e9](https://github.com/luukasp/junction-2026/tree/8cc42e9de5549f05608fd03259cc8815170335e3). It joins the `Ei hoitotietoa` rows of `data/processed/county_lung_treatment_2019_2023.csv` with `data/processed/regions.csv` by HVA code. The proposal comes from `data/catalog/recommendations.json`. The map uses the repository's `dashboard/vendor_data/hva_4500k.json` boundaries, with polygon winding normalized for d3-geo.


## Backend and AI briefings

Run the backend on port 8000 (see `../backend/README.md`), then `npm run dev`.
Vite proxies `/api` to that backend. The dashboard no longer uses the bundled JSON
snapshot. A failed or empty backend displays an explicit loading/error state.

For separate production hosting, set `VITE_API_BASE_URL` at build time and configure
backend CORS. Never put `GEMINI_API_KEY` or other credentials in frontend variables.

Select a county to read its persisted AI review, generate a new version, inspect cited
rows and data quality, or ask follow-up questions in the executive briefing. Responses
use the OpenUI renderer with components adapted from Open Intelligent UI; attribution
and its MIT license are in `src/components/intelligent-ui/`.

Checks: `npm test`, `npm run build`, `npm run lint`.
