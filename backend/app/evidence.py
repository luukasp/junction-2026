"""Deterministic retrieval with intact dimensions and auditable data-quality measures."""

import re
from collections import defaultdict
from datetime import date

from fastapi import HTTPException
from sqlalchemy import select

from app import models as m


def json_row(row):
    return {k: v.isoformat() if isinstance(v, date) else v for k, v in dict(row).items()}


def county_evidence(conn, area_code: str, question: str = ""):
    region = (
        conn.execute(select(m.regions).where(m.regions.c.area_code == area_code)).mappings().first()
    )
    if not region:
        raise HTTPException(404, "Unknown county")
    state = conn.execute(select(m.ingestion_state)).mappings().first()
    if not state:
        raise HTTPException(503, "Import the source datasets before generating a briefing")
    evidence, coverage = [], []
    terms = set(re.findall(r"\w{3,}", question.lower()))
    for name, table, fields in (
        ("treatments", m.treatments, ["treatment_n", "patients_n", "share_pct"]),
        ("outcomes", m.outcomes, ["incidence_rate", "mortality_rate", "relative_survival_5y_pct"]),
        ("screening", m.screening, ["value"]),
        ("statfin", m.statfin, ["value"]),
    ):
        rows = [
            json_row(r)
            for r in conn.execute(
                select(table).where(table.c.area_code == area_code).order_by(table.c.id)
            ).mappings()
        ]
        missing = sum(r[f] is None for r in rows for f in fields)
        # Rank by question relevance and recency, then take distinct strata/metrics.
        rows.sort(
            key=lambda r: (sum(term in str(r).lower() for term in terms), r.get("year", 0)),
            reverse=True,
        )
        selected, seen = [], set()
        groups = defaultdict(list)
        for row in rows:
            signature = tuple(
                str(row.get(k, ""))
                for k in (
                    "program",
                    "metric",
                    "strata",
                    "dataset",
                    "metric_code",
                    "sex_code",
                    "cause_code",
                    "dimensions",
                    "cancer",
                    "sex",
                    "treatment_type_fi",
                )
            )
            if signature in seen:
                continue
            seen.add(signature)
            group = row.get("program") or row.get("dataset") or row.get("cancer") or name
            groups[group].append({"id": f"{name}:{row['id']}", "dataset": name, "row": row})
        # Round-robin keeps all screening programs / StatFin datasets represented.
        while len(selected) < 24 and any(groups.values()):
            for group_rows in groups.values():
                if group_rows and len(selected) < 24:
                    selected.append(group_rows.pop(0))
        evidence.extend(selected)
        years = [r["year"] for r in rows if "year" in r]
        coverage.append(
            {
                "dataset": name,
                "rows": len(rows),
                "selected_rows": len(selected),
                "missing_values": missing,
                "numeric_cells": len(rows) * len(fields),
                "latest_year": max(years) if years else None,
            }
        )
    quality = {
        "coverage": coverage,
        "imported_at": state["imported_at"].isoformat(),
        "screening_mainland_coverage": region["screening_mainland_coverage"],
        "limitations": [
            "Missing treatment records do not prove absence of treatment.",
            "Area comparisons are not risk-adjusted; treatment categories overlap.",
            "Datasets use different periods, populations and definitions; do not pool them.",
            "Retrieval is a bounded, relevance-ranked sample, not an exhaustive analysis.",
            "Missing or suppressed values remain null and must not be interpreted as zero.",
        ],
    }
    return {
        "region": json_row(region),
        "fingerprint": state["fingerprint"],
        "evidence": evidence,
        "quality": quality,
    }


def dashboard(conn):
    rows = (
        conn.execute(
            select(m.treatments).where(m.treatments.c.treatment_type_fi == "Ei hoitotietoa")
        )
        .mappings()
        .all()
    )
    by_area = {r["area_code"]: r for r in rows}
    regions = []
    for region in conn.execute(select(m.regions).order_by(m.regions.c.area_code)).mappings():
        row = by_area.get(region["area_code"])
        regions.append(
            {
                "regionId": region["area_code"],
                "regionName": region["area_name_en"],
                "patients": row["patients_n"] if row else None,
                "missing": row["treatment_n"] if row else None,
                "share": row["share_pct"] if row else None,
            }
        )
    sample = rows[0] if rows else {}
    return {
        "regions": regions,
        "period": sample.get("diagnosis_period", "Unavailable"),
        "observationWindow": sample.get("observation_window", "Unavailable"),
        "sourceUrl": sample.get("source_url", ""),
        "data_loaded": conn.execute(select(m.ingestion_state.c.id)).first() is not None,
    }
