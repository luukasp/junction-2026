from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Connection, select

from app.aggregates import aggregate_counties
from app.db import get_connection
from app.models import outcomes, regions, screening, statfin, treatments
from app.queries import paginate
from app.schemas import CountyAggregate, Page

router = APIRouter(prefix="/api/v1/counties", tags=["counties"])
ConnectionDep = Annotated[Connection, Depends(get_connection)]
Limit = Annotated[int, Query(ge=1, le=1000)]
Offset = Annotated[int, Query(ge=0)]


def require_county(area_code: str, conn: ConnectionDep):
    county = (
        conn.execute(select(regions).where(regions.c.area_code == area_code)).mappings().first()
    )
    if county is None:
        raise HTTPException(404, "Unknown county area code")
    return dict(county)


CountyDep = Annotated[dict, Depends(require_county)]


@router.get("", response_model=Page)
def list_counties(conn: ConnectionDep, limit: Limit = 100, offset: Offset = 0):
    return paginate(conn, regions, [], limit, offset)


# Declare the collection aggregate before /{area_code} so it is never parsed as a county.
@router.get("/aggregate", response_model=CountyAggregate)
def all_counties_aggregate(
    conn: ConnectionDep,
    area_codes: Annotated[list[str] | None, Query(description="Repeat to select counties")] = None,
):
    known = set(conn.scalars(select(regions.c.area_code)).all())
    selected = set(area_codes) if area_codes is not None else known
    if selected - known:
        raise HTTPException(
            404, f"Unknown county area codes: {', '.join(sorted(selected - known))}"
        )
    return aggregate_counties(conn, sorted(selected))


@router.get("/{area_code}")
def county_detail(county: CountyDep):
    return county


@router.get("/{area_code}/aggregate", response_model=CountyAggregate)
def county_aggregate(county: CountyDep, conn: ConnectionDep):
    return aggregate_counties(conn, [county["area_code"]])


@router.get("/{area_code}/screening", response_model=Page)
def county_screening(
    county: CountyDep,
    conn: ConnectionDep,
    limit: Limit = 100,
    offset: Offset = 0,
    year: int | None = None,
    program: str | None = None,
    metric: str | None = None,
):
    clauses = [screening.c.area_code == county["area_code"]]
    for column, value in (
        (screening.c.year, year),
        (screening.c.program, program),
        (screening.c.metric, metric),
    ):
        if value is not None:
            clauses.append(column == value)
    return paginate(conn, screening, clauses, limit, offset)


@router.get("/{area_code}/statfin", response_model=Page)
def county_statfin(
    county: CountyDep,
    conn: ConnectionDep,
    limit: Limit = 100,
    offset: Offset = 0,
    year: int | None = None,
    dataset: Literal["statfin_11ra", "statfin_13u5"] | None = None,
    metric_code: str | None = None,
    cause_code: str | None = None,
):
    clauses = [statfin.c.area_code == county["area_code"]]
    for column, value in (
        (statfin.c.year, year),
        (statfin.c.dataset, dataset),
        (statfin.c.metric_code, metric_code),
        (statfin.c.cause_code, cause_code),
    ):
        if value is not None:
            clauses.append(column == value)
    return paginate(conn, statfin, clauses, limit, offset)


@router.get("/{area_code}/outcomes", response_model=Page)
def county_outcomes(
    county: CountyDep,
    conn: ConnectionDep,
    limit: Limit = 100,
    offset: Offset = 0,
    cancer: str | None = None,
    sex: str | None = None,
):
    clauses = [outcomes.c.area_code == county["area_code"]]
    for column, value in ((outcomes.c.cancer, cancer), (outcomes.c.sex, sex)):
        if value is not None:
            clauses.append(column == value)
    return paginate(conn, outcomes, clauses, limit, offset)


@router.get("/{area_code}/treatments", response_model=Page)
def county_treatments(
    county: CountyDep,
    conn: ConnectionDep,
    limit: Limit = 100,
    offset: Offset = 0,
    treatment_type_fi: str | None = None,
):
    clauses = [treatments.c.area_code == county["area_code"]]
    if treatment_type_fi is not None:
        clauses.append(treatments.c.treatment_type_fi == treatment_type_fi)
    return paginate(conn, treatments, clauses, limit, offset)
