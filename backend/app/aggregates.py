"""County totals with explicit coverage and latest years per indicator."""

from collections import defaultdict

from sqlalchemy import and_, func, or_, select

from app.models import outcomes, regions, statfin
from app.schemas import CountyAggregate, Indicator, PatientSeries, PatientTotals

# Only additive person counts. Rates, percentages, overlapping causes and age/sex totals
# must never be summed as though they were independent residents/patients.
COUNTS = {
    "residents": ("statfin_11ra", "vaerak-vaesto", None, "Population at 31 December"),
    "finnish_speakers": ("statfin_11ra", "vaesto_kieli_fi", None, "Finnish speakers"),
    "swedish_speakers": ("statfin_11ra", "vaesto_kieli_sv", None, "Swedish speakers"),
    "sami_speakers": ("statfin_11ra", "vaesto_kieli_se", None, "Sami speakers"),
    "foreign_language_speakers": (
        "statfin_11ra",
        "vaesto_kieli_ulk",
        None,
        "Foreign-language speakers",
    ),
    "foreign_citizens": ("statfin_11ra", "vaesto_kansa_ulk", None, "Foreign citizens"),
    "born_abroad": ("statfin_11ra", "vaesto_svaltio_ulk", None, "Persons born abroad"),
    "foreign_background": (
        "statfin_11ra",
        "vaesto_tausta_ulk",
        None,
        "Persons with foreign background",
    ),
    "deaths": ("statfin_13u5", "ksyylkm", "SSS", "Deaths, all causes"),
    "cancer_deaths": ("statfin_13u5", "ksyylkm", "04-21", "Deaths from malignant neoplasms"),
}


def aggregate_counties(conn, area_codes):
    selected = set(area_codes)
    conditions = [
        and_(
            statfin.c.dataset == dataset,
            statfin.c.metric_code == metric,
            statfin.c.cause_code.is_(None) if cause is None else statfin.c.cause_code == cause,
        )
        for dataset, metric, cause, _ in COUNTS.values()
    ]
    # Use the latest year across canonical counties, even if the requested county is
    # missing that year's row. Never backfill a missing county using an older value.
    latest = (
        select(
            statfin.c.dataset,
            statfin.c.metric_code,
            statfin.c.cause_code,
            func.max(statfin.c.year).label("latest_year"),
        )
        .join(regions, statfin.c.area_code == regions.c.area_code)
        .where(or_(*conditions))
        .group_by(statfin.c.dataset, statfin.c.metric_code, statfin.c.cause_code)
        .subquery()
    )
    rows = (
        conn.execute(
            select(
                latest,
                statfin.c.area_code,
                statfin.c.value,
                statfin.c.status,
                statfin.c.source_url,
            ).select_from(
                latest.outerjoin(
                    statfin,
                    and_(
                        statfin.c.dataset == latest.c.dataset,
                        statfin.c.metric_code == latest.c.metric_code,
                        statfin.c.cause_code.is_not_distinct_from(latest.c.cause_code),
                        statfin.c.year == latest.c.latest_year,
                        statfin.c.area_code.in_(area_codes),
                    ),
                )
            )
        )
        .mappings()
        .all()
    )
    groups = defaultdict(list)
    for row in rows:
        groups[row["dataset"], row["metric_code"], row["cause_code"]].append(row)
    indicators = {}
    for name, (dataset, metric, cause, label) in COUNTS.items():
        series = groups[dataset, metric, cause]
        valid = [r for r in series if r["value"] is not None and not r["status"]]
        missing = sorted(selected - {r["area_code"] for r in valid})
        total = sum(r["value"] for r in valid) if valid else None
        indicators[name] = Indicator(
            label=label,
            value=total if not missing else None,
            available_total=total,
            year=series[0]["latest_year"] if series else None,
            dataset=dataset,
            metric_code=metric,
            cause_code=cause,
            counties_reporting=len(valid),
            counties_expected=len(selected),
            missing_area_codes=missing,
            source_urls=sorted({r["source_url"] for r in series if r["source_url"]}),
        )
    return CountyAggregate(
        area_codes=sorted(selected),
        indicators=indicators,
        patients=PatientTotals(by_cancer=patient_series(conn, area_codes)),
    )


def patient_series(conn, area_codes):
    # A county occurs once per cancer/sex/cohort, excluding national/collaboration totals.
    cohorts = defaultdict(list)
    for row in conn.execute(
        select(outcomes).where(
            outcomes.c.area_code.in_(area_codes), outcomes.c.area_level == "county"
        )
    ).mappings():
        cohorts[
            row["cancer"], row["sex"], row["incidence_period"], row["prevalence_definition"]
        ].append(row)
    latest = {}
    for (cancer, sex, period, definition), rows in cohorts.items():
        # Curated periods are YYYY-YYYY; retain only the latest end year per series.
        key = cancer, sex
        if key not in latest or period > latest[key][0]:
            latest[key] = period, definition, rows
    result = []
    for (cancer, sex), (period, definition, rows) in sorted(latest.items()):
        available = {row["area_code"] for row in rows if row["prevalence_n"] is not None}
        missing = sorted(set(area_codes) - available)

        def count(field):
            reporting = {r["area_code"] for r in rows if r[field] is not None}
            if reporting != set(area_codes):
                return None
            return sum(r[field] for r in rows)

        result.append(
            PatientSeries(
                cancer=cancer,
                sex=sex,
                diagnosis_period=period,
                definition=definition,
                patients=count("prevalence_n"),
                available_patients=sum(
                    r["prevalence_n"] for r in rows if r["prevalence_n"] is not None
                )
                if available
                else None,
                incident_cases=count("incidence_n"),
                deaths=count("mortality_n"),
                counties_reporting=len(available),
                counties_expected=len(area_codes),
                missing_area_codes=missing,
                source_urls=sorted({r["source_url"] for r in rows}),
            )
        )
    return result
