import argparse
import json
import sys
from pathlib import Path

from sqlalchemy.exc import SQLAlchemyError

from app.config import get_settings
from app.db import get_engine, init_schema
from app.ingestion import IngestionError, ingest, prepare, read_snapshot


def main():
    parser = argparse.ArgumentParser(description="Equal Care database management")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser(
        "init-db", help="Create missing tables and indexes; preserves existing data"
    )
    for name in ("ingest", "validate"):
        command = commands.add_parser(name)
        command.add_argument("--data-dir", type=Path, default=get_settings().data_dir)
        if name == "ingest":
            command.add_argument(
                "--force", action="store_true", help="Reimport an unchanged snapshot"
            )
    args = parser.parse_args()
    try:
        if args.command == "init-db":
            init_schema(get_engine())
            result = {"status": "schema_ready"}
        elif args.command == "validate":
            rows = prepare(read_snapshot(args.data_dir)[0])
            result = {"status": "valid", "row_counts": {k: len(v) for k, v in rows.items()}}
        else:
            result = ingest(get_engine(), args.data_dir, force=args.force)
        print(json.dumps(result, indent=2))
    except (IngestionError, OSError, ValueError) as exc:
        print(f"Import failed: {exc}", file=sys.stderr)
        sys.exit(1)
    except SQLAlchemyError as exc:
        # Do not print SQL parameters or connection credentials.
        print(
            f"Database operation failed ({type(exc).__name__}); check schema and database availability.",
            file=sys.stderr,
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
