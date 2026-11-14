import csv

import pytest
from sqlalchemy import delete, insert, inspect, select, update

from app.aggregates import aggregate_counties
from app.db import init_schema
from app.models import screening, statfin


def test_county_routes_isolate_data_and_preserve_filters(client):
    assert client.get("/api/v1/counties").json()["total"] == 23
    assert client.get("/api/v1/counties/HVA15").json()["area_name_en"] == "Central Finland"
    for dataset in ("screening", "statfin", "outcomes", "treatments"):
        response = client.get(f"/api/v1/counties/HVA15/{dataset}?limit=2")
        assert response.status_code == 200
        assert response.json()["total"] > 0
        assert all(row["area_code"] == "HVA15" for row in response.json()["items"])
    page = client.get(
        "/api/v1/counties/HVA15/statfin",
        params={
            "dataset": "statfin_13u5",
            "metric_code": "ksyylkm",
            "cause_code": "04-21",
            "year": 2025,
        },
    ).json()
    assert page["total"] == 1
    assert page["items"][0]["value"] == 608
    screening_page = client.get(
        "/api/v1/counties/HVA15/screening?program=breast&year=2024&limit=2&offset=2"
    ).json()
    assert len(screening_page["items"]) == 2
    assert all(r["program"] == "breast" and r["year"] == 2024 for r in screening_page["items"])
    assert client.get("/api/v1/counties/HVA15/outcomes?cancer=lung&sex=female").json()["total"] == 1
    assert client.get("/api/v1/counties/HVA91/outcomes").json()["total"] == 0
    assert client.get("/api/v1/counties/HVA15/statfin?dataset=statfin_11ay").status_code == 422
    assert client.get("/api/v1/counties/HVA15/screening?limit=1001").status_code == 422


@pytest.mark.parametrize("area_code", ["HVA99", "SSS", "MA1", "MA2", "KU091"])
def test_non_county_codes_are_rejected(client, area_code):
    for suffix in ("", "/screening", "/statfin", "/outcomes", "/treatments", "/aggregate"):
        assert client.get(f"/api/v1/counties/{area_code}{suffix}").status_code == 404
    assert client.get(f"/api/v1/counties/aggregate?area_codes={area_code}").status_code == 404


def test_county_aggregate_uses_latest_counts_and_separate_patient_series(client, data_dir):
    response = client.get("/api/v1/counties/HVA15/aggregate")
    assert response.status_code == 200
    result = response.json()
    assert result["area_codes"] == ["HVA15"]
    assert result["indicators"]["residents"]["value"] == 273731
    assert result["indicators"]["residents"]["year"] == 2025
    assert result["indicators"]["deaths"]["value"] == 2986
    assert result["indicators"]["cancer_deaths"]["value"] == 608
    assert result["patients"]["total"] is None
    assert len(result["patients"]["by_cancer"]) == 5
    with (data_dir / "regional_cancer_outcomes_2024.csv").open() as source:
        expected = next(
            r
            for r in csv.DictReader(source)
            if r["area_code"] == "HVA15" and r["cancer"] == "lung" and r["sex"] == "female"
        )
    actual = next(
        r for r in result["patients"]["by_cancer"] if r["cancer"] == "lung" and r["sex"] == "female"
    )
    assert actual["patients"] == float(expected["prevalence_n"])
    assert actual["diagnosis_period"] == "2020-2024"


def test_aggregate_sums_canonical_counties_once(client, data_dir):
    with (data_dir / "regions.csv").open() as source:
        codes = {r["area_code"] for r in csv.DictReader(source)}
    with (data_dir / "statfin_11ra.csv").open() as source:
        expected = sum(
            float(r["value"])
            for r in csv.DictReader(source)
            if r["alue_23_20260101"] in codes
            and r["timeperiod_y"] == "2025"
            and r["contentscode"] == "vaerak-vaesto"
        )
    response = client.get("/api/v1/counties/aggregate")
    assert response.status_code == 200  # Static route must precede /{area_code}.
    aggregate = response.json()
    residents = aggregate["indicators"]["residents"]
    assert residents["value"] == expected
    assert residents["counties_reporting"] == 23
    assert set(aggregate["area_codes"]) == codes
    assert all(
        r["patients"] is None
        and r["missing_area_codes"] == ["HVA91"]
        and r["available_patients"] > 0
        for r in aggregate["patients"]["by_cancer"]
    )
    subset = client.get(
        "/api/v1/counties/aggregate",
        params={
            "area_codes": ["HVA15", "HVA90", "HVA90"],
        },
    ).json()
    assert subset["area_codes"] == ["HVA15", "HVA90"]
    helsinki = client.get("/api/v1/counties/HVA90/aggregate").json()
    assert subset["indicators"]["residents"]["value"] == (
        273731 + helsinki["indicators"]["residents"]["value"]
    )
    assert all(series["patients"] is not None for series in subset["patients"]["by_cancer"])


def test_missing_latest_county_row_never_falls_back_to_previous_year(engine):
    with engine.connect() as conn:
        transaction = conn.begin()
        try:
            conn.execute(
                delete(statfin).where(
                    statfin.c.area_code == "HVA15",
                    statfin.c.dataset == "statfin_11ra",
                    statfin.c.metric_code == "vaerak-vaesto",
                    statfin.c.year == 2025,
                )
            )
            result = aggregate_counties(conn, ["HVA15", "HVA90"])
            residents = result.indicators["residents"]
            assert residents.year == 2025
            assert residents.value is None
            assert residents.available_total > 0
            assert residents.missing_area_codes == ["HVA15"]
            assert residents.counties_reporting == 1
            single = aggregate_counties(conn, ["HVA15"]).indicators["residents"]
            assert single.year == 2025 and single.value is None
        finally:
            transaction.rollback()


def test_indicators_use_their_own_latest_year_and_respect_status(engine):
    with engine.connect() as conn:
        transaction = conn.begin()
        try:
            sample = dict(
                conn.execute(
                    select(statfin).where(
                        statfin.c.area_code == "HVA15",
                        statfin.c.dataset == "statfin_11ra",
                        statfin.c.metric_code == "vaerak-vaesto",
                        statfin.c.year == 2025,
                    )
                )
                .mappings()
                .one()
            )
            sample.pop("id")
            sample.update(year=2026, value=300000, value_raw="300000")
            conn.execute(insert(statfin).values(sample))
            result = aggregate_counties(conn, ["HVA15"])
            assert result.indicators["residents"].year == 2026
            assert result.indicators["residents"].value == 300000
            assert result.indicators["deaths"].year == 2025
            conn.execute(
                update(statfin)
                .where(
                    statfin.c.area_code == "HVA15",
                    statfin.c.metric_code == "vaerak-vaesto",
                    statfin.c.year == 2026,
                )
                .values(status="suppressed", value=None, value_raw="..")
            )
            missing = aggregate_counties(conn, ["HVA15"]).indicators["residents"]
            assert missing.value is None and missing.year == 2026
            assert missing.available_total is None
        finally:
            transaction.rollback()


def test_init_schema_adds_missing_county_indexes_without_reloading_data(engine):
    expected = {
        screening: "ix_screening_county_year_program",
        statfin: "ix_statfin_county_dataset_metric_year",
    }
    with engine.connect() as conn:
        original_id = conn.scalar(select(statfin.c.id).limit(1))
    for table, name in expected.items():
        index = next(i for i in table.indexes if i.name == name)
        index.drop(engine)
    init_schema(engine)
    init_schema(engine)  # Idempotent for existing installations.
    for table, name in expected.items():
        assert name in {i["name"] for i in inspect(engine).get_indexes(table.name)}
    with engine.connect() as conn:
        assert conn.scalar(select(statfin.c.id).limit(1)) == original_id
