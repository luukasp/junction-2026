from typing import Annotated, Any, Literal

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import Connection, func, select, text
from sqlalchemy.exc import SQLAlchemyError

from app.ai_routes import router as ai_router
from app.config import get_settings
from app.db import get_connection
from app.models import DATASETS, ingestion_state, review_proposals

app = FastAPI(title="Equal Care API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
ConnectionDep = Annotated[Connection, Depends(get_connection)]
Dataset = Literal[
    "regions", "screening", "statfin", "outcomes", "treatments", "source-tables", "source-rows"
]


class Page(BaseModel):
    items: list[dict[str, Any]]
    total: int
    limit: int
    offset: int


@app.exception_handler(SQLAlchemyError)
def database_error(request, exc):
    return JSONResponse(status_code=503, content={"detail": "Database operation unavailable"})


@app.get("/health", tags=["health"])
def health():
    return {"status": "ok"}


@app.get("/health/ready", tags=["health"])
def ready(conn: ConnectionDep):
    try:
        conn.execute(text("SELECT 1"))
        for table in [*DATASETS.values(), review_proposals]:
            conn.execute(select(table).limit(0))
        state = conn.execute(select(ingestion_state.c.imported_at)).scalar_one_or_none()
    except SQLAlchemyError as exc:
        raise HTTPException(503, "Database or schema is unavailable") from exc
    return {"status": "ok", "data_loaded": state is not None, "imported_at": state}


@app.get("/api/v1/datasets", tags=["data"])
def datasets():
    return [{"name": name, "columns": list(table.c.keys())} for name, table in DATASETS.items()]


@app.get("/api/v1/ingestion", tags=["data"])
def ingestion_status(conn: ConnectionDep):
    state = conn.execute(select(ingestion_state)).mappings().first()
    return dict(state) if state else {"status": "not_imported"}


@app.get("/api/v1/data/{dataset}", response_model=Page, tags=["data"])
def list_data(
    dataset: Dataset,
    conn: ConnectionDep,
    limit: Annotated[int, Query(ge=1, le=1000)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
    area_code: str | None = None,
    year: int | None = None,
    program: str | None = None,
    cancer: str | None = None,
    sex: str | None = None,
    metric: str | None = None,
    metric_code: str | None = None,
    statfin_dataset: str | None = None,
    table_id: str | None = None,
):
    table = DATASETS[dataset]
    filters = dict(
        area_code=area_code,
        year=year,
        program=program,
        cancer=cancer,
        sex=sex,
        metric=metric,
        metric_code=metric_code,
        dataset=statfin_dataset,
        table_id=table_id,
    )
    clauses = []
    for key, value in filters.items():
        if value is not None:
            if key not in table.c:
                raise HTTPException(422, f"Filter '{key}' is not supported for {dataset}")
            clauses.append(table.c[key] == value)
    total = conn.scalar(select(func.count()).select_from(table).where(*clauses))
    rows = (
        conn.execute(
            select(table)
            .where(*clauses)
            .order_by(*table.primary_key.columns)
            .limit(limit)
            .offset(offset)
        )
        .mappings()
        .all()
    )
    return Page(items=[dict(row) for row in rows], total=total, limit=limit, offset=offset)


app.include_router(ai_router)
