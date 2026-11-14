from functools import lru_cache

from sqlalchemy import create_engine

from app.config import get_settings


@lru_cache
def get_engine():
    return create_engine(get_settings().database_url, pool_pre_ping=True)


def get_connection():
    with get_engine().connect() as connection:
        yield connection


def init_schema(engine):
    """Create tables and add missing indexes to existing installations without replacing data."""
    from app.models import metadata

    metadata.create_all(engine)
    for table in metadata.sorted_tables:
        for index in sorted(table.indexes, key=lambda index: index.name):
            index.create(engine, checkfirst=True)
