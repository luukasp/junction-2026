# Junction 2026 — Equal Care Across Finland

Public aggregate cancer-care evidence for the AstraZeneca challenge. Original challenge files are preserved at the root.

Start with [the data guide](docs/DATA_GUIDE.md), which explains usable datasets, Goal 3 mappings, provenance, limitations and reproduction steps.

- [Processed data](data/processed/): ready-to-use county outcomes, screening, lung treatment, demographics and mortality CSVs, plus extracted source tables.
- [Source catalog](data/catalog/downloads.json): download URLs, dates, hashes, exact queries and access failures.
- [Table catalog](data/catalog/tables.json): headings, schemas and paths for every extracted table.
- [Validation results](data/catalog/validation.json): integrity and denominator checks.
- [Recommendation evidence](data/catalog/recommendations.json): concrete proposal templates with source references.

Collection scripts are in [scripts/](scripts/). No patient data or synthetic observations are included.

## Prototype dashboard

Open `dashboard/index.html` in a browser for the interactive Finland county heatmap, evidence checks and draft action plans. No installation or server is needed. See [dashboard instructions](dashboard/README.md) for data rebuilding and interpretation.
