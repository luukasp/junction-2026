import csv
import io

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, func, select
from sqlalchemy.exc import OperationalError

from app import models as m
from app.db import get_connection
from app.ingestion import IngestionError, csv_rows, ingest, prepare, read_snapshot
from app.main import app


def test_full_snapshot_counts_and_deduplication(engine):
    expected = {
        m.regions: 23,
        m.screening: 24585,
        m.statfin: 45328,
        m.outcomes: 140,
        m.treatments: 106,
        m.source_tables: 333,
        m.source_rows: 6709,
    }
    with engine.connect() as conn:
        for table, count in expected.items():
            assert conn.scalar(select(func.count()).select_from(table)) == count
        assert (
            conn.scalar(
                select(func.count())
                .select_from(m.screening)
                .where(m.screening.c.county_section.is_not(None))
            )
            == 12864
        )
        missing = conn.execute(select(m.screening).where(m.screening.c.value.is_(None))).first()
        assert missing is not None  # Suppressed/missing observations survive as NULL, not zero.
        assert (
            conn.scalar(
                select(func.count()).select_from(m.outcomes).where(m.outcomes.c.area_code == "SSS")
            )
            > 0
        )


def test_unchanged_snapshot_is_noop(engine, data_dir):
    with engine.connect() as conn:
        before = conn.scalar(select(m.ingestion_state.c.imported_at))
    assert ingest(engine, data_dir)["status"] == "unchanged"
    with engine.connect() as conn:
        assert conn.scalar(select(m.ingestion_state.c.imported_at)) == before


def test_failed_database_write_rolls_back_entire_snapshot(engine, data_dir):
    with engine.connect() as conn:
        before = dict(conn.execute(select(m.ingestion_state)).mappings().one())
        sample = dict(conn.execute(select(m.screening).limit(1)).mappings().one())

    def fail_on_archive_insert(conn, clause, multiparams, params, execution_options):
        if getattr(clause, "is_insert", False) and clause.table.name == "source_rows":
            raise RuntimeError("Injected write failure after deletes and earlier inserts")

    event.listen(engine, "before_execute", fail_on_archive_insert)
    try:
        with pytest.raises(RuntimeError, match="Injected"):
            ingest(engine, data_dir, force=True)
    finally:
        event.remove(engine, "before_execute", fail_on_archive_insert)
    with engine.connect() as conn:
        assert dict(conn.execute(select(m.ingestion_state)).mappings().one()) == before
        assert (
            dict(
                conn.execute(select(m.screening).where(m.screening.c.id == sample["id"]))
                .mappings()
                .one()
            )
            == sample
        )
        assert conn.scalar(select(func.count()).select_from(m.source_rows)) == 6709
    # Also proves that the MariaDB advisory lock was released after failure.
    assert ingest(engine, data_dir)["status"] == "unchanged"


def test_forced_reimport_is_not_append(engine, data_dir):
    assert ingest(engine, data_dir, force=True)["row_counts"]["screening_observations"] == 24585
    with engine.connect() as conn:
        assert conn.scalar(select(func.count()).select_from(m.screening)) == 24585


def test_conflicting_county_observation_is_rejected(data_dir):
    snapshot, _, _ = read_snapshot(data_dir)
    key = next(k for k in snapshot if k.endswith("/county_screening.csv"))
    rows = list(csv.reader(io.StringIO(snapshot[key].decode())))
    rows[1][rows[0].index("value")] = "999999"
    stream = io.StringIO()
    csv.writer(stream).writerows(rows)
    snapshot[key] = stream.getvalue().encode()
    with pytest.raises(IngestionError, match="County screening disagrees"):
        prepare(snapshot)


def test_archive_preserves_duplicate_headers_and_raw_cells():
    headers, rows = csv_rows('name,name,\n"a,b",<5,\n'.encode(), "archive.csv")
    assert headers == ["name", "name", ""]
    assert rows == [["a,b", "<5", ""]]


@pytest.mark.parametrize("data", [b"a,b\n1\n", b"", b'a,b\n"unterminated'])
def test_malformed_csv_is_rejected(data):
    with pytest.raises(IngestionError):
        csv_rows(data, "bad.csv")


@pytest.fixture
def client(engine):
    def connection():
        with engine.connect() as conn:
            yield conn

    app.dependency_overrides[get_connection] = connection
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()


def test_api_filters_pagination_and_cors(client):
    response = client.get(
        "/api/v1/data/screening",
        params={
            "area_code": "HVA15",
            "program": "breast",
            "year": 2024,
            "limit": 2,
        },
        headers={"Origin": "http://localhost:5173"},
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    page = response.json()
    assert page["total"] > 2
    assert len(page["items"]) == 2
    assert all(r["area_code"] == "HVA15" and r["year"] == 2024 for r in page["items"])
    assert client.get("/api/v1/data/regions?limit=1001").status_code == 422
    assert client.get("/api/v1/data/regions?year=2024").status_code == 422
    assert client.get("/api/v1/data/not-a-table").status_code == 422
    assert client.get("/health/ready").json()["data_loaded"] is True
    assert client.get("/api/v1/ingestion").json()["row_counts"]["regions"] == 23
    assert client.get("/openapi.json").status_code == 200


def test_unavailable_database_returns_503(client):
    def unavailable():
        raise OperationalError("connect", {}, Exception("unavailable"))

    app.dependency_overrides[get_connection] = unavailable
    assert client.get("/health/ready").status_code == 503
    assert client.get("/health").status_code == 200
