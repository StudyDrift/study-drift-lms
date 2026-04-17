#!/usr/bin/env python3
"""
Print a PostgreSQL UPDATE that sets _sqlx_migrations.checksum for a migration version
to match sqlx 0.8 (SHA-384 of UTF-8 migration file contents, same as Migration::new).

Usage (from repo root or server/):
  python3 server/scripts/print_sqlx_checksum_update.py 68
  DATABASE_URL=postgres://... python3 server/scripts/print_sqlx_checksum_update.py 68 --exec
"""
from __future__ import annotations

import argparse
import hashlib
import os
import subprocess
import sys
from pathlib import Path


def find_migration_file(migrations_dir: Path, version: int) -> Path:
    """Match sqlx naming: <VERSION>_<desc>.sql with VERSION parsing to i64 (e.g. 068_foo.sql -> 68)."""
    for p in sorted(migrations_dir.glob("*.sql")):
        stem = p.name
        if "_" not in stem:
            continue
        prefix, _ = stem.split("_", 1)
        try:
            v = int(prefix)
        except ValueError:
            continue
        if v == version:
            return p
    raise FileNotFoundError(
        f"No migration in {migrations_dir} whose version prefix parses to {version} "
        f"(expected something like {version:03d}_*.sql)."
    )


def checksum_sqlx(sql: str) -> bytes:
    return hashlib.sha384(sql.encode("utf-8")).digest()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("version", type=int, help="Migration version (e.g. 68 for 068_*.sql)")
    ap.add_argument(
        "--migrations-dir",
        type=Path,
        default=None,
        help="Default: server/migrations next to this script",
    )
    ap.add_argument(
        "--exec",
        action="store_true",
        help="Run UPDATE via psql using DATABASE_URL from the environment",
    )
    args = ap.parse_args()

    script_dir = Path(__file__).resolve().parent
    migrations_dir = args.migrations_dir or (script_dir.parent / "migrations")

    path = find_migration_file(migrations_dir, args.version)
    sql_text = path.read_text(encoding="utf-8")
    digest = checksum_sqlx(sql_text)
    hex_str = digest.hex()

    print(f"-- {path}")
    print(f"-- sha384 (hex) = {hex_str}")
    print()
    stmt = (
        f"UPDATE _sqlx_migrations SET checksum = decode('{hex_str}', 'hex') "
        f"WHERE version = {args.version};"
    )
    print(stmt)

    if args.exec:
        url = os.environ.get("DATABASE_URL")
        if not url:
            print("DATABASE_URL is not set", file=sys.stderr)
            return 1
        subprocess.run(["psql", url, "-c", stmt], check=True)
        print("-- executed OK", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
