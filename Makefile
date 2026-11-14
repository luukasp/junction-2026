.PHONY: check check-data check-backend check-frontend data demo

# One command to verify everything a live demo depends on.
check: check-data check-backend check-frontend
	@echo "All checks passed."

check-data:
	python scripts/smoke_pathway.py

check-backend:
	cd backend && uv run ruff check . && uv run pytest -q

check-frontend:
	cd frontend && npm ci --silent && npm run build && npm test && npm run lint

# Rebuild processed dashboard data and the pathway snapshot from the source files.
data:
	python scripts/build_pathway_snapshot.py
	cd frontend && npm run snapshot

# Full-stack demo (MariaDB + API). Then run `cd frontend && npm run dev`.
demo:
	cd backend && docker compose up --build
