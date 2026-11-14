"""Published screening population groups, without pooling incompatible strata."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import Connection, case, func, literal, select

from app.db import get_connection
from app.models import screening
from app.schemas import Page

router = APIRouter(prefix="/api/v1/demographics", tags=["demographics"])
ConnectionDep = Annotated[Connection, Depends(get_connection)]
Program = Literal["breast", "cervix", "colorectal"]
Gender = Literal["male", "female", "total"]
GeographyLevel = Literal["county", "collaboration_area", "national"]

SES_UNAVAILABLE = (
    "The loaded screening data has no socio-economic-status classification. "
    "Education is available separately and is not treated as socio-economic status."
)


class DemographicGroup(BaseModel):
    age_group: str | None
    gender: Gender | None
    socioeconomic_status: str | None = None
    education_level: str | None
    language: str | None
    geographic_location: str
    geography_level: GeographyLevel
    area_code: str | None


class DemographicObservation(BaseModel):
    id: int
    program: Program
    year: int
    section: str
    dimensions: dict[str, str]
    metric: str
    value: float | None
    value_raw: str
    table_id: str
    source_row: int
    source_url: str
    area_code: str | None
    area: str | None
    county_section: str | None
    strata: dict[str, str] | None
    unit: str | None
    demographics: DemographicGroup


class DemographicPage(Page):
    items: list[DemographicObservation]


class FilterOptions(BaseModel):
    available: bool
    values: list[str]
    description: str


class DemographicFilters(BaseModel):
    source: str = "screening_observations"
    total: int
    filters: dict[str, FilterOptions]
    programs: list[str]
    years: list[int]
    metrics: list[str]
    limitations: list[str] = Field(
        default_factory=lambda: [
            SES_UNAVAILABLE,
            "Gender filters use the published Sex classification; gender identity is not recorded.",
            "Groups are separate published breakdowns. A filter combination only matches when "
            "all dimensions occur on the same observation; missing dimensions are not totals.",
            "Age groups and geographic levels overlap. Counts, percentages and totals must not "
            "be summed across observations.",
        ]
    )


class DemographicQuery(BaseModel):
    program: Program | None = None
    year: int | None = None
    metric: str | None = None
    age_group: str | None = Field(default=None, description="Exact published age/band or Total")
    gender: Gender | None = Field(
        default=None, description="Published Sex; never inferred by program"
    )
    socioeconomic_status: str | None = Field(default=None, description="Unavailable; returns 422")
    education_level: str | None = Field(default=None, description="Exact published education group")
    language: str | None = Field(default=None, description="Published native-language group")
    geographic_location: str | None = Field(
        default=None, description="County/collaboration-area name, or Whole country"
    )
    geography_level: GeographyLevel | None = None
    area_code: str | None = Field(default=None, description="HVA county code, or SSS (national)")


def group_columns():
    """Use SQLAlchemy JSON access for both MariaDB and the SQLite test database."""
    dimensions = screening.c.dimensions
    county = dimensions["Wellbeing service county"].as_string()
    collaboration = dimensions["Collaborative area"].as_string()
    national = (screening.c.area_code == "SSS") | (county == "Total") | (collaboration == "Total")
    level = case(
        (national, "national"),
        (county.is_not(None) | screening.c.area_code.is_not(None), "county"),
        (collaboration.is_not(None), "collaboration_area"),
        else_="national",
    )
    return {
        "age_group": dimensions["Age group"].as_string(),
        "gender": case(
            (dimensions["Sex"].as_string() == "Men", "male"),
            (dimensions["Sex"].as_string() == "Women", "female"),
            (dimensions["Sex"].as_string() == "Total", "total"),
            else_=literal(None),
        ),
        "education_level": dimensions["Education"].as_string(),
        "language": dimensions["Native language"].as_string(),
        "geographic_location": case(
            (level == "national", "Whole country"),
            else_=func.coalesce(county, collaboration, screening.c.area),
        ),
        "geography_level": level,
        "area_code": case((level == "national", "SSS"), else_=screening.c.area_code),
    }


def filter_clauses(filters, columns):
    if filters.socioeconomic_status is not None:
        raise HTTPException(422, SES_UNAVAILABLE)
    expressions = {
        **columns,
        "program": screening.c.program,
        "year": screening.c.year,
        "metric": screening.c.metric,
    }
    return [
        expressions[key] == value for key, value in filters.model_dump(exclude_none=True).items()
    ]


FiltersDep = Annotated[DemographicQuery, Query()]


@router.get("", response_model=DemographicPage)
def demographic_observations(
    conn: ConnectionDep,
    filters: FiltersDep,
    limit: Annotated[int, Query(ge=1, le=1000)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    """Filter published screening observations; all supplied filters are combined with AND."""
    columns = group_columns()
    clauses = filter_clauses(filters, columns)
    total = conn.scalar(select(func.count()).select_from(screening).where(*clauses))
    rows = (
        conn.execute(
            select(screening, *(column.label(f"group_{key}") for key, column in columns.items()))
            .where(*clauses)
            .order_by(screening.c.id)
            .limit(limit)
            .offset(offset)
        )
        .mappings()
        .all()
    )
    items = []
    for result in rows:
        row = dict(result)
        row["demographics"] = {key: row.pop(f"group_{key}") for key in columns}
        items.append(row)
    return {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/filters", response_model=DemographicFilters)
def demographic_filters(conn: ConnectionDep, filters: FiltersDep):
    """Discover exact published values, scoped by any of the observation filters."""
    columns = group_columns()
    clauses = filter_clauses(filters, columns)
    descriptions = {
        "age_group": "Exact published ages/bands, including Total; overlapping bands are retained.",
        "gender": "Published Sex: Men=male, Women=female, Total=total; never inferred by program.",
        "education_level": "Published education groups; unknown is retained in its source group.",
        "language": "Published native-language groups; Domestic is not split into languages.",
        "geographic_location": "County/collaboration-area names, or Whole country.",
        "geography_level": "Use to distinguish county, collaboration_area and national rows.",
        "area_code": "HVA county codes, or SSS for national observations.",
    }
    # Fetch distinct combinations once so facets reflect the same filtered set of rows.
    rows = (
        conn.execute(
            select(
                *(column.label(key) for key, column in columns.items()),
                screening.c.program,
                screening.c.year,
                screening.c.metric,
            )
            .where(*clauses)
            .distinct()
        )
        .mappings()
        .all()
    )

    def values(key):
        return sorted({row[key] for row in rows if row[key] is not None})

    options = {
        key: FilterOptions(available=bool(values(key)), values=values(key), description=description)
        for key, description in descriptions.items()
    }
    options["socioeconomic_status"] = FilterOptions(
        available=False, values=[], description=SES_UNAVAILABLE
    )
    return DemographicFilters(
        total=conn.scalar(select(func.count()).select_from(screening).where(*clauses)),
        filters=options,
        programs=values("program"),
        years=values("year"),
        metrics=values("metric"),
    )
