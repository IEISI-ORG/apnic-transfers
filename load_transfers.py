#!/usr/bin/env python3
"""
Load APNIC resource transfer log into a single SQLite database table.
"""

import argparse
import collections
import os
import sqlite3
import sys
import time
from pathlib import Path


DEFAULT_INPUT_FILE = Path(__file__).parent / "transfer-all-apnic-latest"
DEFAULT_DB_FILE = Path(__file__).parent / "transfers.db"
DEFAULT_TABLE_NAME = "transfers"
COLUMNS = (
    "resource_type",
    "resource",
    "from_organisation",
    "from_economy",
    "from_rir",
    "previous_delegation_date",
    "to_organisation",
    "to_economy",
    "to_rir",
    "transfer_date",
    "transfer_type",
)


def create_table(conn: sqlite3.Connection, table_name: str, drop_existing: bool = True) -> None:
    """Create the transfers table and useful indexes."""
    cursor = conn.cursor()
    if drop_existing:
        cursor.execute(f"DROP TABLE IF EXISTS {table_name}")

    cursor.execute(f"""
        CREATE TABLE IF NOT EXISTS {table_name} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            resource_type TEXT NOT NULL,
            resource TEXT NOT NULL,
            from_organisation TEXT,
            from_economy TEXT,
            from_rir TEXT,
            previous_delegation_date TEXT,
            to_organisation TEXT,
            to_economy TEXT,
            to_rir TEXT,
            transfer_date TEXT,
            transfer_type TEXT
        )
    """)

    # Create helpful indexes for fast searching and querying
    cursor.execute(f"CREATE INDEX IF NOT EXISTS idx_{table_name}_resource_type ON {table_name}(resource_type)")
    cursor.execute(f"CREATE INDEX IF NOT EXISTS idx_{table_name}_resource ON {table_name}(resource)")
    cursor.execute(f"CREATE INDEX IF NOT EXISTS idx_{table_name}_transfer_date ON {table_name}(transfer_date)")
    cursor.execute(f"CREATE INDEX IF NOT EXISTS idx_{table_name}_from_org ON {table_name}(from_organisation)")
    cursor.execute(f"CREATE INDEX IF NOT EXISTS idx_{table_name}_to_org ON {table_name}(to_organisation)")
    conn.commit()


def existing_rows(conn: sqlite3.Connection, table_name: str) -> "collections.Counter[tuple]":
    """Count the rows already in the table, keyed by their data fields."""
    cursor = conn.execute(f"SELECT {', '.join(COLUMNS)} FROM {table_name}")
    return collections.Counter(tuple(row) for row in cursor)


def parse_and_load(
    input_path: Path,
    db_path: Path,
    table_name: str = DEFAULT_TABLE_NAME,
    drop_existing: bool = True,
    batch_size: int = 5000,
) -> int:
    """
    Parse the transfer log file and insert rows into the SQLite database.
    Returns the total number of inserted rows.

    The log is a cumulative snapshot, so with drop_existing=False rows that are
    already in the table (same values in all fields) are skipped rather than
    inserted again. Upstream edits to old records, such as organisation renames,
    still arrive as new rows next to the old ones; use a full load to pick them up.
    """
    if not input_path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    conn = sqlite3.connect(db_path)
    try:
        create_table(conn, table_name, drop_existing=drop_existing)
        already_loaded = collections.Counter() if drop_existing else existing_rows(conn, table_name)
        skipped = 0

        insert_sql = (
            f"INSERT INTO {table_name} ({', '.join(COLUMNS)}) "
            f"VALUES ({', '.join('?' * len(COLUMNS))})"
        )

        total_rows = 0
        batch = []
        header_found = False

        with open(input_path, "r", encoding="utf-8", errors="replace") as f:
            for line_no, raw_line in enumerate(f, start=1):
                line = raw_line.strip()
                if not line or line.startswith("#"):
                    continue

                parts = [p.strip() for p in line.split("|")]

                # Skip header row if present
                if not header_found and parts[0].lower() == "resource_type":
                    header_found = True
                    continue

                if len(parts) != 11:
                    print(
                        f"Warning: Line {line_no} has {len(parts)} columns (expected 11), padding/truncating.",
                        file=sys.stderr,
                    )
                    parts = (parts + [""] * 11)[:11]

                row = tuple(parts)
                if already_loaded[row] > 0:
                    already_loaded[row] -= 1
                    skipped += 1
                    continue
                batch.append(row)

                if len(batch) >= batch_size:
                    conn.executemany(insert_sql, batch)
                    conn.commit()
                    total_rows += len(batch)
                    batch.clear()

            if batch:
                conn.executemany(insert_sql, batch)
                conn.commit()
                total_rows += len(batch)
                batch.clear()

        if not drop_existing:
            print(f"Append: skipped {skipped:,} rows already in '{table_name}'.", file=sys.stderr)
        return total_rows
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Load APNIC transfer records into an SQLite database."
    )
    parser.add_argument(
        "-i",
        "--input",
        type=Path,
        default=DEFAULT_INPUT_FILE,
        help=f"Path to input transfer file (default: {DEFAULT_INPUT_FILE.name})",
    )
    parser.add_argument(
        "-d",
        "--db",
        type=Path,
        default=DEFAULT_DB_FILE,
        help=f"Path to output SQLite database (default: {DEFAULT_DB_FILE.name})",
    )
    parser.add_argument(
        "-t",
        "--table",
        type=str,
        default=DEFAULT_TABLE_NAME,
        help=f"Table name (default: {DEFAULT_TABLE_NAME})",
    )
    parser.add_argument(
        "--append",
        action="store_true",
        help="Append to existing table instead of recreating it; rows already present are skipped",
    )

    args = parser.parse_args()

    start_time = time.time()
    print(f"Loading '{args.input}' into '{args.db}' (table: '{args.table}')...")

    rows_inserted = parse_and_load(
        input_path=args.input,
        db_path=args.db,
        table_name=args.table,
        drop_existing=not args.append,
    )

    elapsed = time.time() - start_time
    print(f"Successfully loaded {rows_inserted:,} records in {elapsed:.2f} seconds.")


if __name__ == "__main__":
    main()
