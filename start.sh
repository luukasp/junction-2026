#!/usr/bin/env bash
# Start the local dev stack: MariaDB (docker), FastAPI with reload (:8000), Vite (:5173).
# Ctrl+C stops the API and frontend; the database container keeps running
# (stop it with: docker compose stop db).
set -euo pipefail
cd "$(dirname "$0")"

for cmd in docker uv npm; do
  command -v "$cmd" >/dev/null || { echo "Missing required command: $cmd" >&2; exit 1; }
done

echo "→ Starting MariaDB…"
docker compose up -d --wait db

echo "→ Preparing backend…"
(cd backend && uv sync --quiet && uv run backend init-db && uv run backend ingest)

if [ "${SEED_AI:-0}" = "1" ]; then
  echo "→ Pre-seeding county AI reviews…"
  (cd backend && uv run backend generate-proposals --all) || echo "⚠ AI pre-seed skipped or partial; live/deterministic fallback remains active."
fi

if [ ! -d frontend/node_modules ]; then
  echo "→ Installing frontend dependencies…"
  (cd frontend && npm ci)
fi

pids=()
cleanup() {
  trap - INT TERM EXIT
  echo; echo "→ Stopping dev servers…"
  kill "${pids[@]}" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

(cd backend && exec uv run uvicorn app.main:app --reload --port 8000) &
pids+=($!)
(cd frontend && exec npm run dev) &
pids+=($!)

echo "→ API: http://127.0.0.1:8000   Frontend: http://localhost:5173"
wait -n "${pids[@]}"
