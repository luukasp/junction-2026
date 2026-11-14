# Equal Care Across Finland — data bundle

Collected for the AstraZeneca Junction challenge on 14 November 2026. Public aggregate data only. Original challenge documents remain at the project root. Start with the ready-to-use CSVs below; raw reports, searchable text, exact requests and hashes are retained for audit.

## Best starting points

| File in `data/processed/` | Contents | Appropriate use |
|---|---|---|
| `regional_cancer_outcomes_2024.csv` | Five series: prostate (men), breast (women), colorectal (both), lung (women), lung (men); 22 mainland counties/Helsinki, five collaboration areas and national totals; incidence, mortality, five-year relative survival, prevalence, 95% intervals | Identify outcome differences connected to Goal 3; display uncertainty |
| `county_lung_treatment_2019_2023.csv` | County counts and percentages for curative, non-curative, symptomatic care, no recorded treatment, and recorded multidisciplinary review | Locate differences in recorded treatment pathways; investigate recording quality |
| `county_screening.csv` | County screening process and diagnostic follow-up, all three programmes, 2020–2024 where available; colorectal starts 2022 | Find participation and follow-up gaps; compare like years/programmes/strata |
| `screening_observations.csv` | All screening table metrics, including language, education, age, sex, collaboration area and country of birth where published | Equity analysis beyond geography |
| `statfin_11ra.csv` | Population, age structure, language, foreign background, density and urban/rural context; 2010–2025, 43 measures | Contextualise county differences; not a causal adjustment by itself |
| `statfin_13u5.csv` | Annual deaths and crude death rates by county, all malignancies and cancer-site cause groups; 2010–2025 | More recent mortality context; crude rates require age caution |
| `statfin_11ay.csv` | National deaths, age-standardised/crude rates by sex and cause; 2010–2025 | National trends; read age-standardisation metadata before comparing sources |
| `regions.csv` | Official HVA codes, English/Finnish labels, 2026 geographic reference | Join counties across sources |
| `tables/*.csv` | Every extracted source table, including five cancer annual reports, screening reports, lung report and myeloma interactive tables | Detailed exploration; locate through `data/catalog/tables.json` |

These views overlap. Their row counts must not be added as if they were independent observations or patients. Data collection is not a working challenge demo; it provides the evidence and inputs for building one.

## Connecting the data to Goal 3

The supplied implementation roadmap is the controlling challenge reference. These are English paraphrases, with printed/PDF page numbers:

| Roadmap action | Indicator/requirement | Available evidence | Limitation |
|---|---|---|---|
| 3.1.2, pp. 56–57 | Patients receive treatment within target times | Roadmap, Swedish SVF pathway guidance, OECD Finland cancer profile | No complete county/cancer-specific timestamp series was obtained. Do not substitute screening participation or general waiting lists |
| 3.1.4, pp. 58–59 | Consistent cancer-specific quality and outcome indicators | Regional survival, mortality and lung treatment patterns | Rates do not isolate detection, referral or treatment delay |
| 3.2.1, pp. 59–60 | Quality registry information, including stage, is sufficiently complete for comparison; roadmap target 90% coverage, and automated clinical notifications for 90% of cases by 2030 | Cancer 2024 stage-coverage table; lung 2019–2023 stage-coverage table and recording limitations | These are specific completeness measures, not interchangeable with completeness of the entire future registry |
| 3.2.2–3.2.3, pp. 60–62 | Reliable evidence of regional diagnostic/treatment differences supports peer improvement and action | County lung treatment patterns and regional outcomes, with source links and confidence intervals | Recommendations need local clinical review and a named owner |

**A strong data-supported demo route:** use lung treatment patterns and recording completeness for Goal 3, show regional survival with uncertainty, then propose a county-level review and a measurable improvement plan. Screening equity can provide an additional detection pathway view. Screening participation alone mainly addresses Goal 2 and should not be the only claimed Goal 3 indicator.

## Provenance and structure

- `data/catalog/downloads.json`: URL, resolved URL, HTTP status, retrieval time, response metadata, SHA-256, size, failures, and exact POST queries. Retrieval time is acquisition time, not the observation period or publication date.
- `data/catalog/tables.json`: table identifier, source document, heading path, original header rows, caption, footer, row count and CSV path. Screening pages often have no individual table anchor: use the heading path, year and table ID to locate a table.
- `data/catalog/provided_files.json`: hashes of the supplied PDFs and brief.
- `data/catalog/processing_summary.json`: current counts.
- `data/catalog/validation.json`: checks and access failures, split into `source_integrity` (hashes, PDF signatures, CSV shapes, StatFin flattening) and `analytical` (interval ordering, numerators within denominators, county sums equal national totals, published percentages reproduce from counts, snapshot completeness and comparator arithmetic).
- `data/processed/pathway_snapshot.json`: generated county pathway verdicts, headlines and cited action plans (see below). Do not edit by hand.
- `data/processed/evidence_chunks.jsonl`: retrieval-ready text chunks, source paths/URLs and PDF page numbers for an AI analyst; overlapping chunks are contextual evidence, not extra observations. The challenge PDFs carry their public `files.hackjunction.app` URLs; only `challenge.md` has no URL, and it is never cited.
- `data/raw/`: original downloaded HTML/JSON/PDF and extracted text. HTML includes original embedded charts; no chart images have been converted into guessed numbers.
- `data/catalog/statfin_*_query.json`: reproducible StatFin selections. Metadata JSON preserves source units, notes, classification and update details.
- Myeloma tables are extracted directly from embedded R DT JSON, including rows hidden by initial filtering/pagination. Plotly traces remain available in raw HTML; they are not treated as extra independent observations.

CSV encoding is UTF-8. Source-table CSVs preserve published strings, decimal notation, suppression markers, group-heading rows and inline confidence intervals. They are archival table representations, not uniformly normalised datasets. Blank decorative chart columns can occur in source tables. Use the curated views for analysis.

In long screening files, `value_raw` retains the source cell, while `value` is numeric only when the cell is a plain number. Empty numeric fields mean unavailable/non-numeric, never zero. `dimensions`/`strata` are JSON objects; keep them when filtering to avoid pooling incompatible age/sex groups. `source_row` is zero-based in the extracted source CSV, not a patient index. Metric labels preserve the published denominator descriptions. `Picked` means selected from the population database and is not necessarily identical to an invitation successfully mailed.

## Interpretation and quality limits

1. **Survival definitions differ within reports.** The curated regional 2024 tables describe diagnoses in 2020–2024, with mortality follow-up through end-2025 (report §3.10). National summary survival elsewhere is reported for follow-up in 2022–2024. Do not silently join these as equivalent periods. Regional survival is age-standardised to the national cancer-specific patient distribution. Incidence/mortality rates use Finland 2014, per 100,000 person-years.
2. **County boundaries and residence matter.** StatFin uses the 2026 geographic classification, including historical years expressed on that basis. Registry regional incidence is assigned by residence at diagnosis; mortality by residence at death. Neither identifies the hospital that provided treatment. Helsinki is HVA90; Åland is HVA91. HUS is a provider, not an extra county to sum with Uusimaa counties.
3. **Mainland coverage.** The curated regional outcome tables contain the 21 mainland wellbeing counties plus Helsinki, not Åland. Screening 2024 excludes Åland. StatFin also provides Åland and national totals; do not add HVA91 to MA2, or Helsinki KU091 to HVA90. `regions.csv` contains 23 HVA codes to make these distinctions explicit. National registry totals need not equal the sum of the visible mainland counties.
4. **Lung care categories overlap.** The report describes care recorded during 12 months from a registry-defined start (diagnosis or a qualifying earlier hospital visit). A patient can appear in several treatment categories. Missing HILMO records and MDT codes are known limitations. Four counties do not have a published MDT row in the extracted table; they have not been filled with zeros. The curated table carries treatment/group headings forward only onto real county rows.
5. **No proof of cause.** Lower survival or curative-treatment share can reflect stage, age, case mix, coding, referral patterns or service performance. These aggregates cannot show that a particular delay caused a regional outcome difference. Age-standardisation is not full clinical risk adjustment.
6. **Incomplete staging.** Preserve the missing-stage fraction and its cohort. Do not present the distribution among known-stage cases as representative of all patients. Stage coverage in Cancer 2024 and the lung quality report uses different cohorts and definitions.
7. **Small groups and uncertainty.** Retain confidence intervals and suppression markers. Relative survival estimates may exceed 100% because of estimation noise. Avoid league tables that imply statistically established differences from point estimates alone.
8. **Screening cohorts change.** Colorectal invitations expanded to new ages and repeat rounds. The 2024 cohort includes ages turning 60, 62, 64, 66, 68 or 70; compare eligible cohorts and sex/age composition before interpreting annual changes. Follow-up percentages do not measure days to colonoscopy.
9. **Cause-of-death coding differs.** StatFin `04-21` is all malignant neoplasms (C00–C97), `04-22` includes other neoplasms too. Its lung cause group also includes larynx (C32–C34); colon and rectum are separate. Registry cancer groups are not always identical. Do not double-count aggregates and their component causes.
10. **Targets need context.** Roadmap targets concern 2026–2031 implementation. The OECD 2025 profile describes access targets, while the supplied roadmap calls for cancer-specific pathway targets to be defined. Record cancer type, start/end event, pathway source, publication date and target status. Swedish SVF times are external examples, not Finnish requirements. The older English screening manual is supplemented by the newer Finnish 2026 manual.

## Evidence for concrete recommendations

`data/catalog/recommendations.json` is the single source of truth for the six action playbooks: `screening_reminders` (detection), `positive_fit_followup` and `colposcopy_followup` (referral), `stage_mdt_completeness` (diagnosis and records), `pathway_coordination` (fast-track lung pathway; treatment) and `outcome_peer_review` (outcome). Each entry has the original fields (`trigger`, `proposal`, `owner`, `measure`, `evidence`, `goal`, `evidence_status`) plus `title`, `pathway_stage`, `triggers` (indicator ids, optionally `trigger_verdicts`), 3–6 `concrete_steps`, a measurable `target`, `timeline`, `first_90_days`, `escalation` and a `volume_rule`. `target` and steps are templates; the snapshot builder fills in the county value, comparator and the national stage-unknown figure.

Every playbook cites at least one public URL. Where a citation has a `quote`, the builder checks that the phrase occurs in the archived text of the source (on the cited PDF page) and records the result as `verified`. Examples of the cited operational rules: reminder after six weeks (colorectal manual §10.5, breast manual §6.4) or 4–8 weeks (cervical manual §8.3); the screening nurse phones FIT positives who have not made contact within about two weeks (colorectal §11.2.1); colposcopy urgency (HSIL within one month) and unit reporting duties (cervical manual table p. 27, §12.5); 90% automated clinical notifications by 2030 and 90% registry coverage including stage (roadmap 3.2.1); standardised referral criteria and direct investigation routes (roadmap 2.5.2); annual national peer reviews (roadmap 3.2.2).

These are implementation proposals supported by policy or guidance. Their effects have not been estimated from Finnish county aggregates. Annual volumes describe workload (charts to audit, people to remind), not expected health benefit. The treatment-delay meta-analysis is background on the association between delay and mortality. It does not justify applying one hazard ratio to every cancer, treatment or Finnish county, or presenting a simulated mortality reduction as observed evidence.

## Pathway snapshot and evidence checks

`scripts/build_pathway_snapshot.py` builds `data/processed/pathway_snapshot.json` from the curated CSVs; the logic is in `scripts/pathway_engine.py`. The backend serves the file unchanged and the frontend bundles a copy (`npm run snapshot`). Schema: `built`, `national_headline`, `stages`, `indicators` (with `is_proxy`), `national`, `verdicts`, and `counties` (23 areas: `headline`, `stage_verdicts`, `values` with comparator and verdict, cited `actions`). Extra fields: per-value `checks`, `reason`, `comparator_kind`; per-county `peers`; top-level `method`, `stage_unknown`, `playbooks`, `data_gaps`, `limitations`, `validation` and `analytical_checks`.

**Pathway stages.** Detection (screening attendance), follow-up (breast referral outcome recorded), referral, diagnosis and records (lung no-treatment record, MDT code), treatment (lung curative, life-prolonging and symptomatic care) and outcome (age-standardised five-year relative survival and mortality, 2020–2024). Incidence and population data are context only.

**Referral proxies.** There is no public county series for primary-to-specialist referral or its delay. The referral stage therefore uses three proxies, flagged `is_proxy: true`: colonoscopy after a positive FIT, colposcopy after a screening referral (both: did a screen-positive person reach specialist diagnostics?), and the ratio of lung patients with recorded curative treatment to those with recorded symptomatic care (a low ratio suggests patients reach specialist care late, or lack treatment access). None measures time.

**Comparator.** Wherever counts are published, the comparator is leave-one-out ("rest of Finland"): (national n − county n) / (national d − county d), so a large county is not compared with itself. The national row for screening is the published total (county sums equal it; checked). Lung comparators pool the published counties; the MDT comparator covers only the 18 counties with a published MDT row. Survival and mortality are age-standardised rates without published counts, so they are compared with the published national value, which includes the county.

**Signal.** A difference is flagged when the comparator lies outside the county 95% interval (Wilson for proportions, published intervals for rates, log-scale Katz interval for the lung ratio; the ratio interval ignores the overlap between categories). This is an exploratory rule, not a formal test: comparator uncertainty and multiple comparisons (22 indicators × 23 areas) are not modelled.

**Checks per value.** Precision (interval half-width), comparator outside interval, persistence across annual releases (screening only), recording completeness, case-mix adjustment, corroboration by related indicators, and plausibility. The lung case-mix check states the stage-unknown share read from Table 4 of the lung quality report (`data/raw/quality/lung_2019_2023.txt`: 7,097 of 14,873, 47.7%), not a hard-coded value.

**Verdicts.**

| Verdict | Label | Rule |
|---|---|---|
| `act` | Act | Adverse, outside the interval, at least 2 percentage points from the comparator (for % indicators), no quality check failed and at most one warning (two if the gap persisted in at least three annual releases). |
| `verify` | Verify data | Adverse and outside the interval, but a recording indicator (lung no-record, MDT, missing breast outcome), a failed or repeated quality check, or an implausibly large gap (> 25 pp, or outside ½–2× for rates) points to the records first. |
| `monitor` | Monitor | Adverse but the comparator is inside the interval; statistically clear but under 2 pp; or a clear difference where higher is not inherently better (life-prolonging and symptomatic care). |
| `ok` | In line | Comparator inside the interval, or better than the comparator. Not proof of equivalence. |
| `nodata` | No data | Not published for this area. |

The stage verdict is the most severe value verdict in that stage. Thresholds are judgement calls documented in `pathway_engine.py`; they are not calibrated probabilities.

**Lung treatment rule.** Lung treatment indicators are no longer automatically down-graded for missing case-mix adjustment. A significantly low curative share (or curative-to-symptomatic ratio) is `verify` when the county share of patients without any treatment record is above its rest-of-Finland comparator, because missing records could explain the gap. When the no-record share is at or below the comparator, it is `act`: a likely treatment-access or late-detection gap. Stage, age and comorbidity remain unadjusted.

**Headlines and actions.** Each county gets one sentence naming the earliest pathway stage with an `act` signal and its likely meaning (for example, low curative lung treatment together with poor lung survival → likely treatment-access or late-detection gap). The national headline is computed from the lung no-record counts. A playbook is attached when one of its trigger indicators is `act` or `verify` (the fast-track lung playbook only on `act`; the records playbook on lung `verify`). Actions carry a computed baseline, filled target, annual volume (for example 619 Southwest Finland lung patients without a treatment record over five years ≈ 124 charts a year), citations with URLs and retrieved excerpts with URLs. Outcome peer reviews suggest the nearest demographic peer (Statistics Finland 11ra: age 65+, rural share, density, foreign- and Swedish-language shares) with a better value.

**Limitations specific to the snapshot.** Verdicts are triage signals for local review, not proof of cause or care quality. Missing treatment records do not prove absence of treatment. Lung categories overlap. Pooled 2019–2023 lung data cannot show trends. Åland is absent from lung and outcome tables. Some screening values are clearly register artefacts (for example, Southwest Finland colposcopy 2024: 4 of 190); the plausibility check routes these to `verify`. Comparing a county with the national value for survival and mortality slightly understates large-county differences.

## Gaps to resolve with mentors

- Cancer-specific start/end events and currently agreed targets for suspicion, referral, diagnosis and treatment.
- County-level aggregate referral/diagnosis/treatment intervals, eligible counts, missingness and exclusions.
- Whether missing follow-up reflects incomplete reporting, justified non-participation, alternative investigations or an actual service gap.
- Case-mix variables needed to interpret lower curative treatment rates; which actions a county can implement and resource.
- Data ownership, refresh cadence, and validation responsibility for a prospective pilot.

Sotkanet indicator metadata, region metadata and the Sampo specialist waiting-time endpoint returned HTTP 403 from this environment. Those failures are logged; no THL API observations were invented or sourced from unofficial mirrors. The bundle includes THL-linked registry quality reports and Statistics Finland data despite those API access failures. Restricted patient data, biobanks and Findata permit-only extracts were not downloaded.

## Reproduce

Requires Python 3, `requests`, `beautifulsoup4`, and Poppler `pdftotext` on PATH. Run from the project root:

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -r scripts/requirements-data.txt
python scripts/collect_data.py
python scripts/process_data.py
python scripts/build_demo_data.py
python scripts/build_evidence_index.py
python scripts/validate_data.py
python scripts/build_pathway_snapshot.py   # or: make data (also copies the snapshot into the frontend)
python scripts/smoke_pathway.py            # or: make check-data
```

`build_pathway_snapshot.py` reruns source-integrity and analytical validation before writing the snapshot and rewrites `data/catalog/validation.json`; it needs only the Python standard library. It fails if validation fails.

Successful downloads are cached. Failed requests are retried on a subsequent collection run. `--refresh` downloads sources again and replaces their snapshots; changing a POST query also invalidates its cache. Source-table IDs are positional within a report, so preserve the catalog/snapshot with any published analysis.

Keep publisher attribution and source links. Public accessibility does not imply a universal reuse license: the manifest deliberately does not apply one blanket license to registry reports, OECD publications and research articles. Check each publisher's terms before redistributing whole reports.
