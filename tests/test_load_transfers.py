"""Tests for load_transfers.py.

The APNIC log is a cumulative snapshot, so ``--append`` (``make load-append``)
must not re-insert rows already in the table. The last test checks the local
transfers.db against the local raw log and is skipped when either is absent.
"""

import collections
import contextlib
import sqlite3
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from load_transfers import COLUMNS, parse_and_load  # noqa: E402

HEADER = "|".join(COLUMNS) + "\n"
ROWS = [
    "ipv4|203.14.126.0/24|Alphawest Services Pty Ltd|AU|APNIC|19950428|Alphawest Services|AU|APNIC|20101119|Unused\n",
    # Trailing space inside a field, as in the real log.
    "asn|45783|CIGNA Worldwide Life Insurance Limited|HK|APNIC|20090529|CIGNA HLA Technology Services Company Limited |HK|APNIC|20120711|M&A\n",
    "ipv6|2403:67c0::/32|Jainiti Prasad|IN|APNIC|20180817|POWERNET TELECOM PRIVATE LIMITED|IN|APNIC|20261009|M&A\n",
]
NEW_ROW = (
    "ipv4|101.55.128.0/18|Japan Network Information Center/ICNET|JP|APNIC|20110218|"
    "Japan Network Information Center/jcn|JP|APNIC|20200227|Unused\n"
)


def write_log(path: Path, rows: list) -> Path:
    """Write a log in APNIC's layout: comment block, header, rows, trailing blank line."""
    path.write_text("#\n# CONDITIONS OF USE\n#\n" + HEADER + "".join(rows) + "\n", encoding="utf-8")
    return path


def table_rows(db: Path) -> list:
    """Return all data rows of the transfers table, without the id column."""
    with contextlib.closing(sqlite3.connect(db)) as conn:
        return conn.execute(f"SELECT {', '.join(COLUMNS)} FROM transfers ORDER BY id").fetchall()


def test_full_load_replaces_table_and_strips_fields(tmp_path: Path) -> None:
    log, db = write_log(tmp_path / "log", ROWS), tmp_path / "t.db"
    assert parse_and_load(log, db) == 3
    assert parse_and_load(log, db) == 3
    rows = table_rows(db)
    assert len(rows) == 3
    assert rows[1][6] == "CIGNA HLA Technology Services Company Limited"


def test_append_same_snapshot_inserts_nothing(tmp_path: Path) -> None:
    log, db = write_log(tmp_path / "log", ROWS), tmp_path / "t.db"
    parse_and_load(log, db)
    assert parse_and_load(log, db, drop_existing=False) == 0
    assert len(table_rows(db)) == 3


def test_append_newer_snapshot_inserts_only_new_rows(tmp_path: Path) -> None:
    old = write_log(tmp_path / "old", ROWS)
    new = write_log(tmp_path / "new", ROWS + [NEW_ROW])
    db = tmp_path / "t.db"
    parse_and_load(old, db)
    assert parse_and_load(new, db, drop_existing=False) == 1
    rows = table_rows(db)
    assert len(rows) == 4
    assert rows[-1][1] == "101.55.128.0/18"


def test_append_keeps_repeated_source_rows(tmp_path: Path) -> None:
    """Skipping is a multiset match: a row repeated in the source is kept as often as it appears."""
    log, db = write_log(tmp_path / "log", ROWS + [ROWS[0]]), tmp_path / "t.db"
    assert parse_and_load(log, db, drop_existing=False) == 4
    assert parse_and_load(log, db, drop_existing=False) == 0
    assert len(table_rows(db)) == 4


RAW_LOG = REPO / "transfer-all-apnic-latest"
LOCAL_DB = REPO / "transfers.db"


@pytest.mark.skipif(not (RAW_LOG.exists() and LOCAL_DB.exists()), reason="local data files not present")
def test_local_db_matches_raw_log() -> None:
    """transfers.db holds each data row of the raw log exactly once. If this fails, run `make load`."""
    raw: collections.Counter = collections.Counter()
    with open(RAW_LOG, encoding="utf-8") as f:
        for line in f:
            if not line.strip() or line.startswith("#") or line.startswith("resource_type|"):
                continue
            raw[tuple(p.strip() for p in line.rstrip("\n").split("|"))] += 1
    db = collections.Counter(table_rows(LOCAL_DB))
    assert sum(db.values()) == sum(raw.values())
    assert db == raw
