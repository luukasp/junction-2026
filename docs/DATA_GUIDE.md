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
- `data/catalog/validation.json`: checks and access failures.
- `data/processed/evidence_chunks.jsonl`: retrieval-ready text chunks, source paths/URLs and PDF page numbers for an AI analyst; overlapping chunks are contextual evidence, not extra observations.
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

See `data/catalog/recommendations.json` for source-linked proposal templates. These are implementation proposals supported by policy/guidance; their effects have not been estimated from Finnish county aggregates.

- For poor participation: audit invitation delivery, provide language-appropriate materials, and implement the colorectal manual's reminder process. Owner: county screening lead; measure invitation delivery, participation and equity gaps. The 2026 colorectal manual §10.5 describes a reminder after six weeks.
- For gaps after a positive FIT: audit contact with the screening nurse and the complete diagnostic follow-up route, including legitimate alternatives and exclusions. Owner: screening/endoscopy leads; measure completed follow-up and missing records separately. The observed completion percentage alone does not establish a capacity shortage or inappropriate care.
- For inconsistent stage/MDT recording: jointly review clinical workflows and coding, standardise stage and MDT documentation, and monitor missingness. Owner: county oncology lead and registry/data team; measure stage coverage and validation against clinical activity.
- For pathway delays: pilot a coordinator and standardised referral milestones with prospective aggregate reporting. Owner: primary/specialist pathway leads. Report timestamp completeness first, then median/p90 days and eligible patients within a clinically agreed target. This requires additional data.

The treatment-delay meta-analysis is relevant background on the association between delay and mortality. It does not justify applying one hazard ratio to every cancer, treatment or Finnish county, or presenting a simulated mortality reduction as observed evidence.

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
```

Successful downloads are cached. Failed requests are retried on a subsequent collection run. `--refresh` downloads sources again and replaces their snapshots; changing a POST query also invalidates its cache. Source-table IDs are positional within a report, so preserve the catalog/snapshot with any published analysis.

Keep publisher attribution and source links. Public accessibility does not imply a universal reuse license: the manifest deliberately does not apply one blanket license to registry reports, OECD publications and research articles. Check each publisher's terms before redistributing whole reports.
