"""Cancer-pathway snapshot (data/processed/pathway_snapshot.json), served read-only.

The snapshot is produced by the data pipeline, not by the backend. It is passed through
unchanged after light validation of the keys clients and the AI grounding rely on.
"""

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, ValidationError

from app.config import get_settings

router = APIRouter(prefix="/api/v1", tags=["pathway"])


class _Loose(BaseModel):
    model_config = ConfigDict(extra="allow")


class Citation(_Loose):
    label: str = ""
    url: str = ""


class Action(_Loose):
    playbook_id: str
    title: str
    pathway_stage: str | None = None
    owner: str | None = None
    baseline: Any = None
    target: Any = None
    annual_volume: Any = None
    timeline: Any = None
    first_90_days: Any = None
    concrete_steps: list[Any] = []
    escalation: Any = None
    citations: list[Citation] = []


class CountyEntry(_Loose):
    code: str
    name: str
    headline: Any = None
    stage_verdicts: dict[str, Any] = {}
    values: dict[str, dict[str, Any]] = {}
    actions: list[Action] = []


class Indicator(_Loose):
    id: str
    label: str
    stage: str | None = None


class Snapshot(_Loose):
    built: Any
    national_headline: Any
    stages: list[dict[str, Any]]
    indicators: list[Indicator]
    national: dict[str, dict[str, Any]]
    verdicts: Any = None
    counties: list[CountyEntry]


_cache: dict[Path, tuple[float, dict]] = {}


class SnapshotUnavailable(Exception):
    pass


def load_snapshot(path: Path | None = None) -> dict:
    """Return the validated raw snapshot dict; cached until the file changes."""
    path = path or get_settings().pathway_snapshot_file
    try:
        mtime = path.stat().st_mtime
    except OSError:
        raise SnapshotUnavailable(
            f"Pathway snapshot not built yet ({path.name} missing); run the data pipeline"
        ) from None
    cached = _cache.get(path)
    if cached and cached[0] == mtime:
        return cached[1]
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        Snapshot.model_validate(data)
    except (OSError, ValueError, ValidationError):
        raise SnapshotUnavailable(f"Pathway snapshot {path.name} is invalid") from None
    _cache[path] = (mtime, data)
    return data


def try_snapshot() -> dict | None:
    try:
        return load_snapshot()
    except SnapshotUnavailable:
        return None


def county_entry(snapshot: dict | None, area_code: str) -> dict | None:
    if not snapshot:
        return None
    return next((c for c in snapshot["counties"] if c.get("code") == area_code), None)


@router.get("/pathway")
def get_pathway():
    try:
        return load_snapshot()
    except SnapshotUnavailable as exc:
        raise HTTPException(503, str(exc)) from None


@router.get("/pathway/{area_code}")
def get_pathway_county(area_code: str):
    try:
        snapshot = load_snapshot()
    except SnapshotUnavailable as exc:
        raise HTTPException(503, str(exc)) from None
    entry = county_entry(snapshot, area_code)
    if entry is None:
        raise HTTPException(404, "Unknown county in pathway snapshot")
    return entry
