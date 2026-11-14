"""Validate a processed CSV snapshot and replace it in one transaction."""

import csv
import hashlib
import io
import json
import math
from datetime import date, datetime, timezone
from pathlib import Path

from sqlalchemy import Date, Float, Integer, String, delete, insert, select, text

from app import models as m

CURATED = (
    "regions.csv",
    "screening_observations.csv",
    "county_screening.csv",
    "regional_cancer_outcomes_2024.csv",
    "county_lung_treatment_2019_2023.csv",
    "statfin_11ay.csv",
    "statfin_11ra.csv",
    "statfin_13u5.csv",
)
PARSER_VERSION = "1"


class IngestionError(ValueError):
    pass


def read_snapshot(root: Path):
    paths = [root / name for name in CURATED]
    archives = sorted((root / "tables").glob("*.csv"))
    if not archives:
        raise IngestionError(f"No source CSVs in {root / 'tables'}")
    paths += archives
    catalog_path = root.parent / "catalog" / "tables.json"
    if catalog_path.exists():
        paths.append(catalog_path)
    try:
        snapshot = {str(p.relative_to(root.parent)): p.read_bytes() for p in paths}
    except OSError as exc:
        raise IngestionError(str(exc)) from exc
    manifest = {name: hashlib.sha256(data).hexdigest() for name, data in snapshot.items()}
    fingerprint = hashlib.sha256(
        json.dumps([PARSER_VERSION, manifest], sort_keys=True).encode()
    ).hexdigest()
    return snapshot, manifest, fingerprint


def csv_rows(data: bytes, name: str, expected=None):
    try:
        reader = csv.reader(io.StringIO(data.decode("utf-8-sig"), newline=""), strict=True)
        headers = next(reader)
        if expected is not None and (
            set(headers) != set(expected) or len(headers) != len(expected)
        ):
            raise IngestionError(f"{name}: unexpected headers: {headers}")
        rows = []
        for line, values in enumerate(reader, 2):
            if len(values) != len(headers):
                raise IngestionError(
                    f"{name}:{line}: expected {len(headers)} cells, got {len(values)}"
                )
            rows.append(values)
        return headers, rows
    except (UnicodeError, csv.Error, StopIteration) as exc:
        raise IngestionError(f"{name}: invalid or empty CSV: {exc}") from exc


def records(data, name, expected):
    headers, rows = csv_rows(data, name, expected)
    return [dict(zip(headers, row, strict=True)) for row in rows]


def number(value):
    if value == "":
        return None
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"Non-finite numeric value: {value}")
    return result


def object_json(value):
    parsed = json.loads(value)
    if not isinstance(parsed, dict):
        raise ValueError("Dimensions must be a JSON object")
    return parsed


def typed(row, table):
    result = dict(row)
    for name, value in row.items():
        column = table.c[name]
        if name == "area_code":
            result[name] = value or None
        elif isinstance(column.type, Float):
            result[name] = number(value)
        elif isinstance(column.type, Integer):
            result[name] = int(value)
        elif isinstance(column.type, Date):
            result[name] = date.fromisoformat(value)
        elif isinstance(column.type, String) and column.type.length:
            if len(value) > column.type.length:
                raise ValueError(f"{name} exceeds {column.type.length} characters")
    return result


def prepare(snapshot):
    """Return typed rows; never infer suppressed values or merge unlike cohorts."""

    # The root directory may be renamed; resolve inputs by suffix within the snapshot.
    def data(name):
        matches = [v for k, v in snapshot.items() if k.endswith("/" + name)]
        if len(matches) != 1:
            raise IngestionError(f"Missing or ambiguous input: {name}")
        return matches[0]

    result = {table.name: [] for table in m.DATASETS.values()}
    for name, table in (
        ("regions.csv", m.regions),
        ("regional_cancer_outcomes_2024.csv", m.outcomes),
        ("county_lung_treatment_2019_2023.csv", m.treatments),
    ):
        fields = [c.name for c in table.c if c.name != "id"]
        for index, row in enumerate(records(data(name), name, fields), 2):
            try:
                converted = typed(row, table)
                if table is m.regions:
                    raw = row["screening_mainland_coverage"]
                    if raw not in ("True", "False"):
                        raise ValueError("Expected True or False for screening_mainland_coverage")
                    converted["screening_mainland_coverage"] = raw == "True"
                result[table.name].append(converted)
            except ValueError as exc:
                raise IngestionError(f"{name}:{index}: {exc}") from exc

    county_fields = (
        "program year area area_code section strata metric value value_raw unit "
        "table_id source_row source_url"
    ).split()

    def key(r):
        return (r["table_id"], r["source_row"], r["metric"])

    county = {}
    for row in records(data("county_screening.csv"), "county_screening.csv", county_fields):
        if key(row) in county:
            raise IngestionError(f"Duplicate county screening observation: {key(row)}")
        county[key(row)] = row
    fields = "program year section dimensions metric value value_raw table_id source_row source_url".split()
    seen = set()
    for index, row in enumerate(
        records(data("screening_observations.csv"), "screening_observations.csv", fields), 2
    ):
        try:
            row_key = key(row)
            if row_key in seen:
                raise ValueError(f"Duplicate screening observation: {row_key}")
            seen.add(row_key)
            converted = typed(row, m.screening)
            converted["dimensions"] = object_json(row["dimensions"])
            converted.update(area_code=None, area=None, county_section=None, strata=None, unit=None)
            enrichment = county.pop(row_key, None)
            if enrichment:
                for field in ("program", "year", "value", "value_raw", "source_url"):
                    if row[field] != enrichment[field]:
                        raise ValueError(f"County screening disagrees on {field}: {row_key}")
                converted.update(
                    area_code=enrichment["area_code"] or None,
                    area=enrichment["area"],
                    county_section=enrichment["section"],
                    strata=object_json(enrichment["strata"]),
                    unit=enrichment["unit"],
                )
            result[m.screening.name].append(converted)
        except ValueError as exc:
            raise IngestionError(f"screening_observations.csv:{index}: {exc}") from exc
    if county:
        raise IngestionError(
            "County screening contains observations missing from screening_observations"
        )

    dimension_columns = {
        "statfin_11ay": ["sukupuoli_9_20180101", "kuolinsyyt_1_20210101"],
        "statfin_11ra": ["alue_23_20260101"],
        "statfin_13u5": ["alue_23_20260101", "kuolinsyyt_1_20210101"],
    }
    for dataset, dimensions in dimension_columns.items():
        name = dataset + ".csv"
        fields = [part for d in dimensions for part in (d, d + "_label")]
        fields += "timeperiod_y timeperiod_y_label contentscode contentscode_label value status source_url".split()
        for index, row in enumerate(records(data(name), name, fields), 2):
            try:
                dims = {d: {"code": row[d], "label": row[d + "_label"]} for d in dimensions}
                dimension_key = hashlib.sha256(
                    json.dumps({d: row[d] for d in dimensions}, sort_keys=True).encode()
                ).hexdigest()
                converted = dict(
                    dataset=dataset,
                    year=int(row["timeperiod_y"]),
                    metric_code=row["contentscode"],
                    metric_label=row["contentscode_label"],
                    dimensions=dims,
                    dimension_key=dimension_key,
                    value=number(row["value"]),
                    value_raw=row["value"],
                    status=row["status"],
                    source_url=row["source_url"],
                )
                for prefix, dimension in (
                    ("area", "alue_23_20260101"),
                    ("sex", "sukupuoli_9_20180101"),
                    ("cause", "kuolinsyyt_1_20210101"),
                ):
                    converted[prefix + "_code"] = row.get(dimension)
                    converted[prefix + "_label"] = row.get(dimension + "_label")
                result[m.statfin.name].append(converted)
            except ValueError as exc:
                raise IngestionError(f"{name}:{index}: {exc}") from exc

    catalog = {}
    if "catalog/tables.json" in snapshot:
        catalog = {row["table_id"]: row for row in json.loads(snapshot["catalog/tables.json"])}
    for name, content in snapshot.items():
        if "/tables/" not in name or not name.endswith(".csv"):
            continue
        table_id = Path(name).stem
        headers, rows = csv_rows(content, name)
        result[m.source_tables.name].append(
            dict(
                table_id=table_id,
                headers=headers,
                catalog=catalog.get(table_id, {}),
            )
        )
        result[m.source_rows.name].extend(
            dict(table_id=table_id, source_row=i, cells=row) for i, row in enumerate(rows)
        )
    region_codes = {row["area_code"] for row in result[m.regions.name]} | {"SSS"}
    for table in (m.screening, m.outcomes, m.treatments):
        for row in result[table.name]:
            if row["area_code"] and row["area_code"] not in region_codes:
                raise IngestionError(f"{table.name}: unknown region {row['area_code']}")
    return result


def ingest(engine, root: Path, *, force=False):
    snapshot, manifest, fingerprint = read_snapshot(root)
    with engine.connect() as conn:
        maria = conn.dialect.name in ("mysql", "mariadb")
        locked = False
        try:
            if maria:
                locked = conn.scalar(text("SELECT GET_LOCK('equal_care_csv_ingest', 0)")) == 1
                conn.commit()
                if not locked:
                    raise IngestionError("Another CSV import is running")
            with conn.begin():
                previous = conn.execute(select(m.ingestion_state)).mappings().first()
                if previous and previous["fingerprint"] == fingerprint and not force:
                    return {"status": "unchanged", "row_counts": previous["row_counts"]}
                rows = prepare(snapshot)
                # DML only: MariaDB DDL/TRUNCATE would implicitly commit and break rollback.
                data_tables = [
                    t for t in m.metadata.sorted_tables if t.name in rows or t is m.ingestion_state
                ]
                for table in reversed(data_tables):
                    conn.execute(delete(table))
                for table in data_tables:
                    if table is m.ingestion_state:
                        continue
                    values = rows[table.name]
                    for start in range(0, len(values), 1000):
                        conn.execute(insert(table), values[start : start + 1000])
                counts = {name: len(values) for name, values in rows.items()}
                conn.execute(
                    insert(m.ingestion_state).values(
                        id=1,
                        fingerprint=fingerprint,
                        imported_at=datetime.now(timezone.utc).replace(tzinfo=None),
                        manifest=manifest,
                        row_counts=counts,
                    )
                )
                return {"status": "imported", "row_counts": counts}
        finally:
            if locked:
                conn.execute(text("SELECT RELEASE_LOCK('equal_care_csv_ingest')"))
                conn.commit()
