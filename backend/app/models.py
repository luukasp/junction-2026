"""Shared relational schema. JSON is reserved for variable source dimensions/archives."""

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    UniqueConstraint,
)

metadata = MetaData(
    naming_convention={
        "ix": "ix_%(table_name)s_%(column_0_name)s",
        "uq": "uq_%(table_name)s_%(column_0_name)s",
        "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
        "pk": "pk_%(table_name)s",
    }
)


def table(name, *columns):
    return Table(
        name,
        metadata,
        *columns,
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_bin",
    )


def identity():
    return Column("id", Integer, primary_key=True)


def provenance():
    return [
        Column("table_id", String(100), nullable=False),
        Column("source_row", Integer, nullable=False),
        Column("source_url", Text, nullable=False),
    ]


def region_reference():
    # Registry codes include SSS (national total), which is not a county in regions.csv.
    return Column("area_code", String(10), index=True)


regions = table(
    "regions",
    Column("area_code", String(10), primary_key=True),
    Column("area_name_en", String(100), nullable=False),
    Column("area_name_fi", String(100), nullable=False),
    Column("screening_mainland_coverage", Boolean, nullable=False),
    Column("source_url", Text, nullable=False),
    Column("geography_reference", Date, nullable=False),
)

screening = table(
    "screening_observations",
    identity(),
    Column("program", String(30), nullable=False),
    Column("year", Integer, nullable=False),
    Column("section", Text, nullable=False),
    Column("dimensions", JSON, nullable=False),
    Column("metric", String(255), nullable=False),
    Column("value", Float),
    Column("value_raw", Text, nullable=False),
    *provenance(),
    region_reference(),
    Column("area", String(100)),
    Column("county_section", Text),
    Column("strata", JSON),
    Column("unit", String(30)),
    UniqueConstraint("table_id", "source_row", "metric"),
    Index("ix_screening_program_year", "program", "year"),
    Index("ix_screening_county_year_program", "area_code", "year", "program"),
)

statfin = table(
    "statfin_observations",
    identity(),
    Column("dataset", String(20), nullable=False),
    Column("year", Integer, nullable=False),
    Column("metric_code", String(100), nullable=False),
    Column("metric_label", Text, nullable=False),
    Column("dimensions", JSON, nullable=False),
    Column("dimension_key", String(64), nullable=False),
    Column("area_code", String(20), index=True),
    Column("area_label", String(100)),
    Column("sex_code", String(20)),
    Column("sex_label", String(100)),
    Column("cause_code", String(30)),
    Column("cause_label", String(255)),
    Column("value", Float),
    Column("value_raw", Text, nullable=False),
    Column("status", String(50), nullable=False),
    Column("source_url", Text, nullable=False),
    UniqueConstraint("dataset", "year", "metric_code", "dimension_key"),
    Index("ix_statfin_dataset_year", "dataset", "year"),
    Index("ix_statfin_county_dataset_metric_year", "area_code", "dataset", "metric_code", "year"),
)

outcomes = table(
    "cancer_outcomes",
    identity(),
    region_reference(),
    *provenance(),
    *[
        Column(name, String(100), nullable=False)
        for name in (
            "cancer",
            "sex",
            "area",
            "area_level",
            "collaboration_area",
            "incidence_period",
            "survival_diagnosis_period",
        )
    ],
    Column("survival_followup_through", Date, nullable=False),
    Column("survival_method", Text, nullable=False),
    Column("prevalence_definition", Text, nullable=False),
    *[Column(name, Float) for name in ("incidence_n", "prevalence_n", "mortality_n")],
    *[
        Column(metric + suffix, Text if suffix == "_raw" else Float)
        for metric in ("incidence_rate", "relative_survival_5y_pct", "mortality_rate")
        for suffix in ("", "_ci_lower", "_ci_upper", "_raw")
    ],
    UniqueConstraint("table_id", "source_row"),
    Index("ix_outcomes_cancer_sex", "cancer", "sex"),
)

treatments = table(
    "lung_treatments",
    identity(),
    region_reference(),
    *provenance(),
    *[
        Column(name, String(100), nullable=False)
        for name in ("area_fi", "collaboration_area_fi", "treatment_type_fi", "diagnosis_period")
    ],
    *[Column(name, Float) for name in ("treatment_n", "patients_n", "share_pct")],
    Column("observation_window", Text, nullable=False),
    Column("warning", Text, nullable=False),
    UniqueConstraint("table_id", "source_row"),
)

source_tables = table(
    "source_tables",
    Column("table_id", String(100), primary_key=True),
    Column("headers", JSON, nullable=False),
    Column("catalog", JSON, nullable=False),
)
source_rows = table(
    "source_rows",
    Column("table_id", String(100), ForeignKey("source_tables.table_id"), primary_key=True),
    Column("source_row", Integer, primary_key=True),
    Column("cells", JSON, nullable=False),
)
ingestion_state = table(
    "ingestion_state",
    Column("id", Integer, primary_key=True),
    Column("fingerprint", String(64), nullable=False),
    Column("imported_at", DateTime, nullable=False),
    Column("manifest", JSON, nullable=False),
    Column("row_counts", JSON, nullable=False),
)

DATASETS = {
    "regions": regions,
    "screening": screening,
    "statfin": statfin,
    "outcomes": outcomes,
    "treatments": treatments,
    "source-tables": source_tables,
    "source-rows": source_rows,
}
