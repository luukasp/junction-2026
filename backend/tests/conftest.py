import os
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from app.ingestion import ingest
from app.models import metadata

DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "processed"


@pytest.fixture(scope="session")
def data_dir():
    return DATA_DIR


@pytest.fixture(scope="session")
def engine():
    # TEST_DATABASE_URL must point to a disposable database: these tables are dropped.
    url = os.environ.get("TEST_DATABASE_URL")
    engine = (
        create_engine(url)
        if url
        else create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
    )
    metadata.create_all(engine)
    ingest(engine, DATA_DIR, force=True)
    yield engine
    metadata.drop_all(engine)
    engine.dispose()
