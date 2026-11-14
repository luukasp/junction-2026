"""Deterministic retrieval with intact dimensions and auditable data-quality measures.

Evidence ids the AI may cite (any other id is rejected by the answer validator):

- ``screening:<id>``, ``statfin:<id>``, ``outcomes:<id>``, ``treatments:<id>``: county rows
- ``national:<dataset>:<id>``: national (SSS / whole-country) comparator rows
- ``pathway:<code>:summary`` and ``pathway:<code>:<indicator>``: pathway snapshot values
- ``action:<playbook_id>``: county action plan from the pathway snapshot
- ``policy:<id>``: curated recommendation from ``catalog/recommendations.json``
- ``policy_chunk:<chunk_id>``: keyword-matched passage from ``evidence_chunks.jsonl``
"""

import hashlib
import json
import math
import re
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import select

from app import models as m
from app.config import get_settings
from app.pathway import county_entry, try_snapshot

PER_DATASET = 24
CHUNK_TOP_K = 6

# Semantic label fields used for question relevance. URLs, warnings and windows are excluded
# so that e.g. "treatment" in a warning or "cancerregistry" in a URL never boosts a row.
LABEL_FIELDS = (
    "program",
    "metric",
    "county_section",
    "strata",
    "unit",
    "dataset",
    "metric_label",
    "cause_label",
    "sex_label",
    "cancer",
    "sex",
    "treatment_type_fi",
)

# StatFin is restricted to series that matter for a cancer-care briefing.
KEY_CAUSES = {"SSS", "04-21", "07", "08", "11", "13", "14"}
KEY_STATFIN = {
    "statfin_13u5": {"ksyylkm", "ksyycdr"},
    "statfin_11ra": {
        "vaerak-vaesto",
        "vaesto_yli64_p",
        "vaesto_keski_ika",
        "vaerak-vaesto_maa_pa",
        "vaesto_kieli_sv_p",
        "vaesto_kieli_ulk_p",
        "vaesto_tausta_ulk_p",
        "vaesto_ms_p",
    },
}


def json_row(row):
    return {k: v.isoformat() if isinstance(v, date) else v for k, v in dict(row).items()}


def tokens(text: str) -> list[str]:
    # Crude prefix stemming helps with Finnish inflection and English plurals alike.
    return [t[:7] for t in re.findall(r"\w{3,}", str(text).lower())]


def _label_text(row) -> str:
    parts = []
    for key in LABEL_FIELDS:
        value = row.get(key)
        if isinstance(value, dict):
            parts.extend(f"{k} {v}" for k, v in value.items())
        elif value is not None:
            parts.append(str(value))
    dims = row.get("dimensions")
    if isinstance(dims, dict):
        for value in dims.values():
            parts.append(str(value.get("label", "")) if isinstance(value, dict) else str(value))
    return " ".join(parts)


def row_year(row) -> int:
    """Year for ranking: ``year`` or the end year of a period field (e.g. ``2019-2023``)."""
    if isinstance(row.get("year"), int):
        return row["year"]
    for key in ("period", "diagnosis_period", "incidence_period", "survival_diagnosis_period"):
        years = re.findall(r"(?:19|20)\d{2}", str(row.get(key) or ""))
        if years:
            return int(years[-1])
    return 0


def _headline(name, row) -> int:
    """Higher means a headline row: all-population strata and comparable percentages."""
    if name == "screening":
        strata = row.get("strata")
        score = 2 if strata in (None, {}, "", "{}") else 0
        if row.get("unit") == "percent" or str(row.get("metric", "")).endswith("| %"):
            score += 1
        return score
    if name == "statfin":
        return 1 if row.get("cause_code") in ("SSS", "04-21") else 0
    return 0


def _is_key_statfin(row) -> bool:
    keys = KEY_STATFIN.get(row.get("dataset"))
    if not keys or row.get("metric_code") not in keys:
        return False
    return row["dataset"] != "statfin_13u5" or row.get("cause_code") in KEY_CAUSES


def _flat(value):
    if isinstance(value, dict):
        return "; ".join(f"{k}: {_flat(v)}" for k, v in value.items())
    if isinstance(value, list):
        return [_flat(v) for v in value]
    return value


def _file_cache(loader):
    cache: dict = {}

    def wrapper(path: Path):
        try:
            mtime = path.stat().st_mtime
        except OSError:
            return None
        if cache.get(path, (None,))[0] != mtime:
            try:
                cache[path] = (mtime, loader(path))
            except (OSError, ValueError, KeyError, TypeError):
                return None
        return cache[path][1]

    return wrapper


@_file_cache
def load_policies(path: Path):
    items = json.loads(path.read_text(encoding="utf-8"))
    return [item for item in items if isinstance(item, dict) and item.get("id")]


class ChunkIndex:
    """Small in-memory BM25 index over evidence chunks."""

    def __init__(self, chunks):
        self.chunks = chunks
        self.docs = [Counter(tokens(c.get("text", ""))) for c in chunks]
        self.lengths = [sum(d.values()) for d in self.docs]
        self.avg = (sum(self.lengths) / len(self.lengths)) if self.lengths else 0
        df = Counter(t for d in self.docs for t in d)
        n = len(chunks)
        self.idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}

    def search(self, query: str, k: int = CHUNK_TOP_K, per_document: int = 2):
        terms = set(tokens(query))
        if not terms or not self.avg:
            return []
        k1, b = 1.5, 0.75
        scored = []
        for i, doc in enumerate(self.docs):
            score = 0.0
            for term in terms & doc.keys():
                tf = doc[term]
                score += (
                    self.idf[term]
                    * tf
                    * (k1 + 1)
                    / (tf + k1 * (1 - b + b * self.lengths[i] / self.avg))
                )
            if score > 0:
                scored.append((score, i))
        scored.sort(reverse=True)
        results, per_doc = [], Counter()
        for score, i in scored:
            chunk = self.chunks[i]
            if per_doc[chunk.get("document_id")] >= per_document:
                continue
            per_doc[chunk.get("document_id")] += 1
            results.append((round(score, 3), chunk))
            if len(results) >= k:
                break
        return results


@_file_cache
def load_chunk_index(path: Path):
    chunks = []
    with path.open(encoding="utf-8") as source:
        for line in source:
            if line.strip():
                chunk = json.loads(line)
                # Only citable passages: a public source URL is required.
                url = str(chunk.get("source_url") or "")
                text = str(chunk.get("text") or "")
                # Skip number-dump table extracts; they are better served by the data rows.
                numeric = sum(ch.isdigit() for ch in text) > 0.2 * max(len(text), 1)
                if chunk.get("chunk_id") and text and url.startswith("http") and not numeric:
                    chunks.append(chunk)
    return ChunkIndex(chunks)


def pathway_evidence(snapshot, entry):
    if not entry:
        return []
    code = entry["code"]
    indicators = {i["id"]: i for i in snapshot.get("indicators", [])}
    stages = {s.get("id"): s.get("label") for s in snapshot.get("stages", [])}
    national = snapshot.get("national", {})
    evidence = [
        {
            "id": f"pathway:{code}:summary",
            "dataset": "pathway",
            "row": {
                "area_code": code,
                "area": entry.get("name"),
                "metric": "Pathway headline",
                "headline": _flat(entry.get("headline")),
                "national_headline": _flat(snapshot.get("national_headline")),
                **{
                    f"stage_{stage}": _flat(verdict)
                    for stage, verdict in (entry.get("stage_verdicts") or {}).items()
                },
                "built": snapshot.get("built"),
            },
        }
    ]
    for ind_id, value in (entry.get("values") or {}).items():
        meta = indicators.get(ind_id, {})
        nat = national.get(ind_id) or {}
        evidence.append(
            {
                "id": f"pathway:{code}:{ind_id}",
                "dataset": "pathway",
                "row": {
                    "area_code": code,
                    "indicator": ind_id,
                    "metric": meta.get("label", ind_id),
                    "stage": stages.get(meta.get("stage"), meta.get("stage")),
                    "stage_id": meta.get("stage"),
                    "unit": meta.get("unit"),
                    "polarity": meta.get("polarity"),
                    "period": meta.get("period"),
                    "is_proxy": meta.get("is_proxy"),
                    "value": value.get("v"),
                    "ci_lower": value.get("lo"),
                    "ci_upper": value.get("hi"),
                    "numerator": value.get("n"),
                    "denominator": value.get("d"),
                    "comparator": _flat(value.get("comparator")),
                    "verdict": _flat(value.get("verdict")),
                    "national_value": nat.get("v"),
                    "national_ci_lower": nat.get("lo"),
                    "national_ci_upper": nat.get("hi"),
                    "source_url": meta.get("source_url"),
                },
            }
        )
    seen = set()
    for action in entry.get("actions") or []:
        pid = action.get("playbook_id")
        if not pid or pid in seen:
            continue
        seen.add(pid)
        citations = [c for c in action.get("citations") or [] if isinstance(c, dict)]
        evidence.append(
            {
                "id": f"action:{pid}",
                "dataset": "action",
                "row": {
                    "area_code": code,
                    "playbook_id": pid,
                    "metric": action.get("title"),
                    "pathway_stage": action.get("pathway_stage"),
                    "owner": action.get("owner"),
                    "baseline": _flat(action.get("baseline")),
                    "target": _flat(action.get("target")),
                    "annual_volume": _flat(action.get("annual_volume")),
                    "timeline": _flat(action.get("timeline")),
                    "first_90_days": _flat(action.get("first_90_days")),
                    "concrete_steps": _flat(action.get("concrete_steps") or []),
                    "escalation": _flat(action.get("escalation")),
                    "citations": [
                        f"{c.get('label', '')} {c.get('url', '')}".strip() for c in citations
                    ],
                    "source_url": next((c["url"] for c in citations if c.get("url")), None),
                },
            }
        )
    return evidence


def policy_evidence(policies):
    evidence = []
    for item in policies or []:
        refs = [r for r in item.get("evidence") or [] if isinstance(r, dict)]
        evidence.append(
            {
                "id": f"policy:{item['id']}",
                "dataset": "policy",
                "row": {
                    "metric": item.get("proposal"),
                    "trigger": item.get("trigger"),
                    "owner": item.get("owner"),
                    "measure": _flat(item.get("measure")),
                    "goal": item.get("goal"),
                    "evidence_status": item.get("evidence_status"),
                    "citations": [
                        " ".join(
                            p
                            for p in (
                                f"section {r['section']}" if r.get("section") else "",
                                f"p. {r['pdf_page']}" if r.get("pdf_page") else "",
                                r.get("url", ""),
                            )
                            if p
                        )
                        for r in refs
                    ],
                    "source_url": next((r["url"] for r in refs if r.get("url")), None),
                },
            }
        )
    return evidence


def chunk_evidence(index, query):
    if not index:
        return []
    evidence = []
    for score, chunk in index.search(query):
        text = re.sub(r"\s+", " ", chunk["text"]).strip()
        page = chunk.get("pdf_page")
        evidence.append(
            {
                "id": f"policy_chunk:{chunk['chunk_id']}",
                "dataset": "policy_chunk",
                "row": {
                    "metric": chunk.get("document_id"),
                    "section": f"page {page}" if page else text[:80],
                    "pdf_page": page,
                    "text": text[:700],
                    "score": score,
                    "source_url": chunk.get("source_url"),
                },
            }
        )
    return evidence


def national_evidence(conn, county_selected):
    rows = []
    for row in conn.execute(select(m.outcomes).where(m.outcomes.c.area_code == "SSS")).mappings():
        rows.append(("outcomes", json_row(row)))
    statfin_rows = [
        json_row(r)
        for r in conn.execute(select(m.statfin).where(m.statfin.c.area_code == "SSS")).mappings()
    ]
    statfin_rows = [r for r in statfin_rows if _is_key_statfin(r)]
    latest = defaultdict(int)
    for r in statfin_rows:
        latest[r["dataset"]] = max(latest[r["dataset"]], r["year"])
    rows.extend(("statfin", r) for r in statfin_rows if r["year"] == latest[r["dataset"]])
    # Whole-country screening rows matching selected county percentage metrics.
    wanted = {
        (e["row"]["program"], e["row"]["metric"], e["row"]["year"])
        for e in county_selected
        if e["dataset"] == "screening" and str(e["row"].get("metric", "")).endswith("| %")
    }
    if wanted:
        candidates = conn.execute(
            select(m.screening)
            .where(
                m.screening.c.area_code.is_(None),
                m.screening.c.section.like("%Whole country%"),
                m.screening.c.year.in_({w[2] for w in wanted}),
                m.screening.c.metric.in_({w[1] for w in wanted}),
            )
            .order_by(m.screening.c.id)
        ).mappings()
        seen = set()
        for row in candidates:
            key = (row["program"], row["metric"], row["year"])
            dims = row["dimensions"] or {}
            if key in wanted and key not in seen and all(v == "Total" for v in dims.values()):
                seen.add(key)
                rows.append(("screening", json_row(row)))
    return [
        {"id": f"national:{name}:{row['id']}", "dataset": "national", "row": row}
        for name, row in rows
    ]


def _county_rows(conn, area_code, terms):
    evidence, coverage = [], []
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
        candidates = [r for r in rows if _is_key_statfin(r)] if name == "statfin" else list(rows)
        # Rank by relevance in label fields, headline priority, then recency.
        candidates.sort(
            key=lambda r: (
                len(terms & set(tokens(_label_text(r)))),
                _headline(name, r),
                row_year(r),
            ),
            reverse=True,
        )
        selected, seen = [], set()
        groups = defaultdict(list)
        for row in candidates:
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
        while len(selected) < PER_DATASET and any(groups.values()):
            for group_rows in groups.values():
                if group_rows and len(selected) < PER_DATASET:
                    selected.append(group_rows.pop(0))
        evidence.extend(selected)
        years = [row_year(r) for r in rows if row_year(r)]
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
    return evidence, coverage


def _chunk_query(question, region, entry, policies):
    if question.strip():
        return f"{question} {region['area_name_en']}"
    parts = ["cancer screening diagnosis treatment pathway equity"]
    if entry:
        parts.append(str(_flat(entry.get("headline")) or ""))
        for action in entry.get("actions") or []:
            parts.extend(str(action.get(k) or "") for k in ("title", "pathway_stage"))
    else:
        parts.extend(str(p.get("trigger", "")) for p in policies or [])
    return " ".join(parts)


def county_evidence(conn, area_code: str, question: str = ""):
    region = (
        conn.execute(select(m.regions).where(m.regions.c.area_code == area_code)).mappings().first()
    )
    if not region:
        raise HTTPException(404, "Unknown county")
    state = conn.execute(select(m.ingestion_state)).mappings().first()
    if not state:
        raise HTTPException(503, "Import the source datasets before generating a briefing")
    settings = get_settings()
    terms = set(tokens(question))
    county, coverage = _county_rows(conn, area_code, terms)
    national = national_evidence(conn, county)
    snapshot = try_snapshot()
    entry = county_entry(snapshot, area_code)
    pathway = pathway_evidence(snapshot, entry)
    policies = load_policies(settings.catalog_path / "recommendations.json")
    policy = policy_evidence(policies)
    chunks = chunk_evidence(
        load_chunk_index(settings.data_dir / "evidence_chunks.jsonl"),
        _chunk_query(question, region, entry, policies),
    )
    # Pathway and policy evidence first: they carry the key message and the action plan.
    evidence = [*pathway, *policy, *county, *national, *chunks]
    extras = [
        snapshot.get("built") if entry else None,
        json.dumps(policies, sort_keys=True) if policies else None,
    ]
    fingerprint = state["fingerprint"]
    if any(extras):
        fingerprint = hashlib.sha256(
            json.dumps([fingerprint, *extras], default=str).encode()
        ).hexdigest()
    quality = {
        "coverage": coverage,
        "grounding": {
            "pathway_snapshot": bool(entry),
            "pathway_built": snapshot.get("built") if snapshot else None,
            "actions": sum(e["dataset"] == "action" for e in pathway),
            "policies": len(policy),
            "policy_chunks": len(chunks),
            "national_comparators": len(national),
        },
        "imported_at": state["imported_at"].isoformat(),
        "screening_mainland_coverage": region["screening_mainland_coverage"],
        "limitations": [
            "Missing treatment records do not prove absence of treatment.",
            "Area comparisons are not risk-adjusted; treatment categories overlap.",
            "Datasets use different periods, populations and definitions; do not pool them.",
            "Retrieval is a bounded, relevance-ranked sample, not an exhaustive analysis.",
            "Missing or suppressed values remain null and must not be interpreted as zero.",
            "Policy passages are keyword-matched excerpts; read the cited source in full.",
        ],
    }
    return {
        "region": json_row(region),
        "fingerprint": fingerprint,
        "evidence": evidence,
        "quality": quality,
        "pathway": entry,
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
