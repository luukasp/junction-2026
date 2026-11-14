import csv
import json

import pytest

BASE = "/api/v1/demographics"


def test_discovery_uses_published_groups_and_reports_unavailable_status(client):
    response = client.get(f"{BASE}/filters")
    assert response.status_code == 200
    result = response.json()
    assert result["source"] == "screening_observations"
    assert result["total"] == 24585
    filters = result["filters"]
    assert {"30", "30-34", "30-39", "70", "Total"} <= set(filters["age_group"]["values"])
    assert filters["gender"]["values"] == ["female", "male", "total"]
    assert filters["language"]["values"] == ["Domestic", "Other/missing", "Total"]
    assert filters["education_level"]["values"] == [
        "Intermediate/secondary",
        "Primary education/unknown",
        "Tertiary/higher education",
        "Total",
    ]
    assert filters["socioeconomic_status"]["available"] is False
    assert filters["socioeconomic_status"]["values"] == []
    assert "HVA91" in filters["area_code"]["values"]
    assert "Whole country" in filters["geographic_location"]["values"]
    assert result["limitations"]


@pytest.mark.parametrize(
    "params,source_dimensions",
    [
        ({"age_group": "60", "gender": "male"}, {"Age group": "60", "Sex": "Men"}),
        (
            {"education_level": "Tertiary/higher education", "gender": "female"},
            {"Education": "Tertiary/higher education", "Sex": "Women"},
        ),
        (
            {"language": "Other/missing", "gender": "male"},
            {"Native language": "Other/missing", "Sex": "Men"},
        ),
        ({"age_group": "Total", "gender": "total"}, {"Age group": "Total", "Sex": "Total"}),
    ],
)
def test_combined_filters_match_source_rows_and_preserve_values(
    client, data_dir, params, source_dimensions
):
    with (data_dir / "screening_observations.csv").open() as source:
        expected = [
            row
            for row in csv.DictReader(source)
            if row["program"] == "colorectal"
            and row["year"] == "2024"
            and all(json.loads(row["dimensions"]).get(k) == v for k, v in source_dimensions.items())
        ]
    result = client.get(BASE, params={"program": "colorectal", "year": 2024, **params}).json()
    assert result["total"] == len(expected) > 0
    actual = {(r["table_id"], r["source_row"], r["metric"]): r for r in result["items"]}
    for source in expected:
        row = actual[(source["table_id"], int(source["source_row"]), source["metric"])]
        assert row["dimensions"] == json.loads(source["dimensions"])
        assert row["value"] == (float(source["value"]) if source["value"] else None)
        assert row["value_raw"] == source["value_raw"]
        assert row["source_url"] == source["source_url"]
        assert all(row["demographics"][k] == v for k, v in params.items())
        assert row["demographics"]["socioeconomic_status"] is None


def test_geographic_filters_distinguish_levels_and_preserve_national_observations(client):
    county = client.get(BASE, params={"area_code": "HVA15", "limit": 1000}).json()
    assert county["total"] == 546
    assert all(
        row["demographics"]["geographic_location"] == "Central Finland"
        and row["demographics"]["geography_level"] == "county"
        for row in county["items"]
    )
    for level, total in [("county", 462), ("collaboration_area", 72)]:
        result = client.get(
            BASE, params={"geographic_location": "Åland", "geography_level": level, "limit": 1000}
        ).json()
        assert result["total"] == total
        assert all(row["demographics"]["geography_level"] == level for row in result["items"])

    national = client.get(
        BASE,
        params={
            "area_code": "SSS",
            "age_group": "60",
            "gender": "total",
            "program": "colorectal",
            "year": 2024,
            "metric": "Picked | N",
        },
    ).json()
    assert national["total"] == 1
    row = national["items"][0]
    assert row["value"] == 72846
    assert row["area_code"] is None  # The source remains intact.
    assert row["demographics"]["area_code"] == "SSS"
    assert row["demographics"]["geographic_location"] == "Whole country"


def test_missing_dimensions_are_not_inferred_or_cross_joined(client):
    breast = client.get(BASE, params={"program": "breast", "limit": 1}).json()
    assert breast["items"][0]["demographics"]["gender"] is None
    assert client.get(BASE, params={"program": "breast", "gender": "female"}).json()["total"] == 0
    for params in [
        {"area_code": "HVA15", "education_level": "Tertiary/higher education"},
        {"age_group": "60", "language": "Domestic"},
        {"area_code": "HVA15", "geographic_location": "Eastern Finland"},
        {"language": "Finnish"},
        {"age_group": "60' OR 1=1 --"},
    ]:
        page = client.get(BASE, params=params).json()
        assert page["total"] == 0 and page["items"] == []


def test_suppressed_values_are_preserved_as_null(client):
    result = client.get(
        BASE,
        params={
            "program": "breast",
            "year": 2023,
            "metric": "Referral to specialized healthcare (of examined) | %",
            "limit": 1000,
        },
    ).json()
    row = next(
        r for r in result["items"] if r["table_id"] == "breast_t031" and r["source_row"] == 6
    )
    assert row["value"] is None
    assert row["value_raw"] == "–"
    assert row["dimensions"] == {"Region of birth": "Unknown"}


def test_discovery_reflects_filters_and_empty_combinations(client):
    params = {"program": "colorectal", "year": 2024, "language": "Domestic", "gender": "male"}
    discovery = client.get(f"{BASE}/filters", params=params).json()
    assert discovery["total"] == client.get(BASE, params=params).json()["total"] == 9
    assert discovery["programs"] == ["colorectal"]
    assert discovery["years"] == [2024]
    assert discovery["filters"]["gender"]["values"] == ["male"]
    assert discovery["filters"]["language"]["values"] == ["Domestic"]
    assert discovery["filters"]["age_group"]["available"] is False
    assert discovery["filters"]["age_group"]["values"] == []
    assert discovery["filters"]["area_code"]["values"] == ["SSS"]
    empty = client.get(f"{BASE}/filters", params={"year": 1900}).json()
    assert empty["total"] == 0
    assert empty["years"] == []
    assert all(
        not option["available"] and not option["values"] for option in empty["filters"].values()
    )


def test_pagination_is_stable_and_counts_are_unpaginated(client):
    params = {"program": "colorectal", "language": "Other/missing", "limit": 3}
    first = client.get(BASE, params=params).json()
    second = client.get(BASE, params={**params, "offset": 3}).json()
    combined = client.get(BASE, params={**params, "limit": 6}).json()
    assert first["total"] == second["total"] == combined["total"] > 6
    assert first["items"] + second["items"] == combined["items"]
    past_end = client.get(BASE, params={**params, "offset": combined["total"]}).json()
    assert past_end["items"] == [] and past_end["total"] == combined["total"]


@pytest.mark.parametrize("suffix", ["", "/filters"])
def test_unavailable_status_and_invalid_classifications_return_422(client, suffix):
    for params in [
        {"socioeconomic_status": "low"},
        {"socioeconomic_status": ""},
        {"gender": "unknown"},
        {"program": "unknown"},
        {"geography_level": "municipality"},
        {"year": "invalid"},
    ]:
        response = client.get(f"{BASE}{suffix}", params=params)
        assert response.status_code == 422
        if "socioeconomic_status" in params:
            assert "no socio-economic-status classification" in response.json()["detail"]
    for params in [{"limit": 0}, {"limit": 1001}, {"offset": -1}]:
        assert client.get(BASE, params=params).status_code == 422


def test_openapi_documents_demographic_query_fields(client):
    schema = client.get("/openapi.json").json()
    for route in [BASE, f"{BASE}/filters"]:
        names = {parameter["name"] for parameter in schema["paths"][route]["get"]["parameters"]}
        assert {
            "age_group",
            "gender",
            "socioeconomic_status",
            "education_level",
            "language",
            "geographic_location",
            "geography_level",
            "area_code",
            "year",
            "program",
            "metric",
        } <= names
