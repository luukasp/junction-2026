# Cancer Care Action Planner

Open `index.html` directly in a browser. No installation, server, account or API key is needed. All data and interactions run locally. Source links require internet access.

The prototype combines the county action planner with BlindSpot evidence checks:

- Click a Finnish wellbeing services county on the heatmap, choose it from the selector, or select a ranking row.
- Switch among 32 indicators and their available periods. Colour by recorded value or evidence verdict; hatching flags verification and recording gaps.
- Expand the six checks to inspect precision, interval comparison, persistence, completeness, case mix and related indicators.
- Read policy-backed action proposals with owners, local measures, guidance citations and retrieved evidence excerpts.
- Open **Draft action plan** to copy Markdown, download it or print. Markdown includes triggered observations, limitations and source URLs.

The selected period controls the map, ranking and selected indicator checks. Pathway summaries and action proposals always use each indicator's latest available period; this is labelled in the interface and export. Demographic peers use 2025 context and are not clinical risk adjustment.

## Data and rebuilding

From the repository root:

```sh
python scripts/build_dashboard_data.py
```

This generates `data.js` from the collected CSVs, evidence chunks, validation catalog and Statistics Finland 2025 boundaries under `data/raw/geo/`. It does not fetch new observations. The bundle contains 32 indicators, 1,216 observations (including comparators), 23 geographical areas and six policy playbooks. See `../docs/DATA_GUIDE.md` for the source pipeline.

The regions are 21 wellbeing services counties plus Helsinki and Åland. Missing observations are shown as missing, without imputation. Some indicators have different coverage. Lung comparators pool reported county counts; MDT comparisons include reporting counties only. Data collection validation is not clinical validation.

## Interpretation

This is a deterministic, evidence-assisted hackathon prototype, not a live generative model or a clinical decision system. Policy proposals require local review and do not carry an estimated benefit.

Comparing a county interval against the comparator point estimate is an exploratory rule, not a formal significance test. Comparator uncertainty, overlap with the county and multiple comparisons are not modelled. Age standardisation does not remove stage or comorbidity differences. Pooled periods do not establish persistence. Missing treatment codes do not establish absence of treatment. Related indicators may refer to different populations and periods. There is no cancer-specific referral delay series in this bundle.

The methodology dialog documents heuristic thresholds. No confidence score is presented as a calibrated probability.

## Interface design

The interface follows a focused polish pass using [unslop by Damir Sokolovsky](https://github.com/heydamir/unslop), licensed CC BY 4.0. Its direction is calm, exact and readable, drawn from public-health reports and regional maps. The heatmap carries the colour while controls and panels use neutral surfaces.

The pass standardises spacing on a 4px grid, raises small labels to 12px, uses sentence case and two main type weights, quiets status badges, aligns county figures, and adds consistent line icons and keyboard focus states. Mobile legends sit below the map to avoid covering county shapes. Reduced-motion preferences disable transitions. Features, evidence rules and data stay the same. No generated images are used.

## Implementation and validation

- `app.js`: map, rankings, selection, evidence panels and exports.
- `engine.js`: deterministic assessment and action matching; usable from Node without the DOM.
- `styles.css`: responsive layout, keyboard focus states and print styles.
- `data.js`: generated data; edit the builder or upstream curated data instead.

Validated every available indicator–period against all 23 areas (1,196 assessments), calculation-order independence, annual-history cutoffs, missing-data behavior and pooled-period checks. DOM smoke checks exercise every indicator and county, year/mode changes, overlay and dialogs. No external JavaScript libraries are needed.
