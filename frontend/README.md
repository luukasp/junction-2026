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
