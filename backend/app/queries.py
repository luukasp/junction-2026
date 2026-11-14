from sqlalchemy import func, select

from app.schemas import Page


def paginate(conn, table, clauses, limit, offset):
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
