import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from app.config import get_settings
from app.db import get_connection
from app.ingestion import ingest
from app.main import app
from app.models import metadata

# Isolate tests from any local developer .env credentials unless explicitly set in a test.
os.environ.setdefault("GEMINI_API_KEY", "")
os.environ.setdefault("LLM_API_KEY", "")
get_settings.cache_clear()

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


@pytest.fixture
def client(engine):
    def connection():
        with engine.connect() as conn:
            yield conn

    app.dependency_overrides[get_connection] = connection
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()
