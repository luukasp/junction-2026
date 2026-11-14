from typing import Any

from pydantic import BaseModel


class Page(BaseModel):
    items: list[dict[str, Any]]
    total: int
    limit: int
    offset: int


class Indicator(BaseModel):
    label: str
    value: float | None
    available_total: float | None
    year: int | None
    dataset: str
    metric_code: str
    cause_code: str | None = None
    unit: str = "persons"
    counties_reporting: int
    counties_expected: int
    missing_area_codes: list[str]
    source_urls: list[str]


class PatientSeries(BaseModel):
    cancer: str
    sex: str
    diagnosis_period: str
    definition: str
    patients: float | None
    available_patients: float | None
    incident_cases: float | None
    deaths: float | None
    counties_reporting: int
    counties_expected: int
    missing_area_codes: list[str]
    source_urls: list[str]


class PatientTotals(BaseModel):
    total: float | None = None
    reason: str = (
        "The supplied StatFin datasets contain no patient counts. Registry prevalence is "
        "reported by cancer and sex; these series cannot be summed into unique patients."
    )
    by_cancer: list[PatientSeries]


class CountyAggregate(BaseModel):
    area_codes: list[str]
    indicators: dict[str, Indicator]
    patients: PatientTotals
