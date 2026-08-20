#!/usr/bin/env python3
"""
Report monthly IPv4 transfer statistics from the SQLite transfers database.
"""

import argparse
import csv
import io
import json
import sqlite3
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


DEFAULT_DB_FILE = Path(__file__).parent / "transfers.db"
DEFAULT_TABLE_NAME = "transfers"


@dataclass
class MonthlyIPv4Stat:
    month: str
    transfers: int
    total_ips: int
    slash24_equiv: float
    slash16_equiv: float
    cumul_transfers: int = 0
    cumul_ips: int = 0
    cumul_slash24_equiv: float = 0.0
    # Transfer Type breakdowns (counts & IPs)
    unused_transfers: int = 0
    unused_ips: int = 0
    ma_transfers: int = 0
    ma_ips: int = 0
    hrt_transfers: int = 0
    hrt_ips: int = 0
    # RIR Flow breakdowns (counts & IPs)
    intra_apnic_transfers: int = 0
    intra_apnic_ips: int = 0
    inbound_transfers: int = 0
    inbound_ips: int = 0
    outbound_transfers: int = 0
    outbound_ips: int = 0


def build_filter_clause(
    start_month: Optional[str] = None,
    end_month: Optional[str] = None,
    year: Optional[int] = None,
    transfer_type: Optional[str] = None,
    flow: Optional[str] = None,
    economy: Optional[str] = None,
) -> Tuple[str, List[Any]]:
    """Build dynamic WHERE conditions for filtering transfers."""
    conditions = ["resource_type = 'ipv4'"]
    params: List[Any] = []

    if year is not None:
        conditions.append("substr(transfer_date, 1, 4) = ?")
        params.append(str(year))
    else:
        if start_month:
            # normalize e.g. 2021-05 to 202105
            clean_start = start_month.replace("-", "")[:6]
            conditions.append("substr(transfer_date, 1, 6) >= ?")
            params.append(clean_start)
        if end_month:
            clean_end = end_month.replace("-", "")[:6]
            conditions.append("substr(transfer_date, 1, 6) <= ?")
            params.append(clean_end)

    if transfer_type:
        conditions.append("LOWER(transfer_type) = LOWER(?)")
        params.append(transfer_type)

    if flow:
        flow_lower = flow.lower()
        if flow_lower in ("intra", "intra-apnic"):
            conditions.append("from_rir = 'APNIC' AND to_rir = 'APNIC'")
        elif flow_lower in ("inbound", "in"):
            conditions.append("from_rir != 'APNIC' AND to_rir = 'APNIC'")
        elif flow_lower in ("outbound", "out"):
            conditions.append("from_rir = 'APNIC' AND to_rir != 'APNIC'")

    if economy:
        econ_upper = economy.upper()
        conditions.append("(from_economy = ? OR to_economy = ?)")
        params.extend([econ_upper, econ_upper])

    where_sql = " AND ".join(conditions)
    return where_sql, params


def fetch_monthly_stats(
    conn: sqlite3.Connection,
    table_name: str = DEFAULT_TABLE_NAME,
    start_month: Optional[str] = None,
    end_month: Optional[str] = None,
    year: Optional[int] = None,
    transfer_type: Optional[str] = None,
    flow: Optional[str] = None,
    economy: Optional[str] = None,
) -> List[MonthlyIPv4Stat]:
    """Query monthly IPv4 transfer statistics with breakdowns and cumulative totals."""
    where_sql, params = build_filter_clause(
        start_month=start_month,
        end_month=end_month,
        year=year,
        transfer_type=transfer_type,
        flow=flow,
        economy=economy,
    )

    query = f"""
        SELECT
            substr(transfer_date, 1, 4) || '-' || substr(transfer_date, 5, 2) AS month,
            COUNT(*) AS transfers,
            SUM(1 << (32 - CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER))) AS total_ips,
            
            -- Transfer Type breakdowns
            COUNT(CASE WHEN LOWER(transfer_type) = 'unused' THEN 1 END) AS unused_transfers,
            SUM(CASE WHEN LOWER(transfer_type) = 'unused' THEN (1 << (32 - CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER))) ELSE 0 END) AS unused_ips,
            
            COUNT(CASE WHEN LOWER(transfer_type) = 'm&a' THEN 1 END) AS ma_transfers,
            SUM(CASE WHEN LOWER(transfer_type) = 'm&a' THEN (1 << (32 - CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER))) ELSE 0 END) AS ma_ips,
            
            COUNT(CASE WHEN LOWER(transfer_type) = 'hrt' THEN 1 END) AS hrt_transfers,
            SUM(CASE WHEN LOWER(transfer_type) = 'hrt' THEN (1 << (32 - CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER))) ELSE 0 END) AS hrt_ips,
            
            -- RIR Flow breakdowns
            COUNT(CASE WHEN from_rir = 'APNIC' AND to_rir = 'APNIC' THEN 1 END) AS intra_transfers,
            SUM(CASE WHEN from_rir = 'APNIC' AND to_rir = 'APNIC' THEN (1 << (32 - CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER))) ELSE 0 END) AS intra_ips,
            
            COUNT(CASE WHEN from_rir != 'APNIC' AND to_rir = 'APNIC' THEN 1 END) AS inbound_transfers,
            SUM(CASE WHEN from_rir != 'APNIC' AND to_rir = 'APNIC' THEN (1 << (32 - CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER))) ELSE 0 END) AS inbound_ips,
            
            COUNT(CASE WHEN from_rir = 'APNIC' AND to_rir != 'APNIC' THEN 1 END) AS outbound_transfers,
            SUM(CASE WHEN from_rir = 'APNIC' AND to_rir != 'APNIC' THEN (1 << (32 - CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER))) ELSE 0 END) AS outbound_ips

        FROM {table_name}
        WHERE {where_sql}
        GROUP BY month
        ORDER BY month ASC
    """

    cursor = conn.cursor()
    cursor.execute(query, params)
    rows = cursor.fetchall()

    results: List[MonthlyIPv4Stat] = []
    cumul_transfers = 0
    cumul_ips = 0

    for row in rows:
        month = row[0]
        transfers = row[1] or 0
        total_ips = row[2] or 0
        unused_tx = row[3] or 0
        unused_ips = row[4] or 0
        ma_tx = row[5] or 0
        ma_ips = row[6] or 0
        hrt_tx = row[7] or 0
        hrt_ips = row[8] or 0
        intra_tx = row[9] or 0
        intra_ips = row[10] or 0
        inbound_tx = row[11] or 0
        inbound_ips = row[12] or 0
        outbound_tx = row[13] or 0
        outbound_ips = row[14] or 0

        cumul_transfers += transfers
        cumul_ips += total_ips

        slash24_equiv = total_ips / 256.0
        slash16_equiv = total_ips / 65536.0
        cumul_slash24 = cumul_ips / 256.0

        stat = MonthlyIPv4Stat(
            month=month,
            transfers=transfers,
            total_ips=total_ips,
            slash24_equiv=slash24_equiv,
            slash16_equiv=slash16_equiv,
            cumul_transfers=cumul_transfers,
            cumul_ips=cumul_ips,
            cumul_slash24_equiv=cumul_slash24,
            unused_transfers=unused_tx,
            unused_ips=unused_ips,
            ma_transfers=ma_tx,
            ma_ips=ma_ips,
            hrt_transfers=hrt_tx,
            hrt_ips=hrt_ips,
            intra_apnic_transfers=intra_tx,
            intra_apnic_ips=intra_ips,
            inbound_transfers=inbound_tx,
            inbound_ips=inbound_ips,
            outbound_transfers=outbound_tx,
            outbound_ips=outbound_ips,
        )
        results.append(stat)

    return results


def fetch_yearly_stats(monthly_stats: List[MonthlyIPv4Stat]) -> List[Dict[str, Any]]:
    """Aggregate monthly statistics into annual summaries."""
    yearly_dict: Dict[str, Dict[str, Any]] = {}

    for m in monthly_stats:
        yr = m.month.split("-")[0]
        if yr not in yearly_dict:
            yearly_dict[yr] = {
                "year": yr,
                "months_active": 0,
                "transfers": 0,
                "total_ips": 0,
                "slash24_equiv": 0.0,
                "slash16_equiv": 0.0,
                "unused_transfers": 0,
                "unused_ips": 0,
                "ma_transfers": 0,
                "ma_ips": 0,
                "hrt_transfers": 0,
                "hrt_ips": 0,
                "intra_transfers": 0,
                "intra_ips": 0,
                "inbound_transfers": 0,
                "inbound_ips": 0,
                "outbound_transfers": 0,
                "outbound_ips": 0,
            }
        y = yearly_dict[yr]
        y["months_active"] += 1
        y["transfers"] += m.transfers
        y["total_ips"] += m.total_ips
        y["slash24_equiv"] += m.slash24_equiv
        y["slash16_equiv"] += m.slash16_equiv
        y["unused_transfers"] += m.unused_transfers
        y["unused_ips"] += m.unused_ips
        y["ma_transfers"] += m.ma_transfers
        y["ma_ips"] += m.ma_ips
        y["hrt_transfers"] += m.hrt_transfers
        y["hrt_ips"] += m.hrt_ips
        y["intra_transfers"] += m.intra_apnic_transfers
        y["intra_ips"] += m.intra_apnic_ips
        y["inbound_transfers"] += m.inbound_transfers
        y["inbound_ips"] += m.inbound_ips
        y["outbound_transfers"] += m.outbound_transfers
        y["outbound_ips"] += m.outbound_ips

    # Calculate cumulative values for years
    cumul_tx = 0
    cumul_ips = 0
    results = []
    for yr in sorted(yearly_dict.keys()):
        item = yearly_dict[yr]
        cumul_tx += item["transfers"]
        cumul_ips += item["total_ips"]
        item["cumul_transfers"] = cumul_tx
        item["cumul_ips"] = cumul_ips
        item["cumul_slash24_equiv"] = cumul_ips / 256.0
        results.append(item)

    return results


def fetch_top_economies(
    conn: sqlite3.Connection,
    table_name: str = DEFAULT_TABLE_NAME,
    where_sql: str = "resource_type = 'ipv4'",
    params: Optional[List[Any]] = None,
    limit: int = 10,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Fetch top source and destination economies by transfers and IP volume."""
    params = params or []
    cursor = conn.cursor()

    from_query = f"""
        SELECT 
            COALESCE(NULLIF(from_economy, ''), 'Unknown') AS economy,
            COUNT(*) AS transfers,
            SUM(1 << (32 - CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER))) AS total_ips
        FROM {table_name}
        WHERE {where_sql}
        GROUP BY economy
        ORDER BY total_ips DESC, transfers DESC
        LIMIT ?
    """
    cursor.execute(from_query, params + [limit])
    top_sources = [
        {"economy": r[0], "transfers": r[1], "total_ips": r[2], "slash24s": r[2] / 256.0}
        for r in cursor.fetchall()
    ]

    to_query = f"""
        SELECT 
            COALESCE(NULLIF(to_economy, ''), 'Unknown') AS economy,
            COUNT(*) AS transfers,
            SUM(1 << (32 - CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER))) AS total_ips
        FROM {table_name}
        WHERE {where_sql}
        GROUP BY economy
        ORDER BY total_ips DESC, transfers DESC
        LIMIT ?
    """
    cursor.execute(to_query, params + [limit])
    top_destinations = [
        {"economy": r[0], "transfers": r[1], "total_ips": r[2], "slash24s": r[2] / 256.0}
        for r in cursor.fetchall()
    ]

    return top_sources, top_destinations


def fetch_prefix_distribution(
    conn: sqlite3.Connection,
    table_name: str = DEFAULT_TABLE_NAME,
    where_sql: str = "resource_type = 'ipv4'",
    params: Optional[List[Any]] = None,
) -> List[Dict[str, Any]]:
    """Fetch distribution of IPv4 prefix sizes (/24, /23, ..., /8)."""
    params = params or []
    query = f"""
        SELECT 
            CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER) AS prefix_len,
            COUNT(*) AS transfers,
            SUM(1 << (32 - CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER))) AS total_ips
        FROM {table_name}
        WHERE {where_sql}
        GROUP BY prefix_len
        ORDER BY prefix_len ASC
    """
    cursor = conn.cursor()
    cursor.execute(query, params)
    rows = cursor.fetchall()
    return [
        {
            "prefix": f"/{r[0]}",
            "prefix_len": r[0],
            "transfers": r[1],
            "total_ips": r[2],
            "slash24s": r[2] / 256.0,
        }
        for r in rows
    ]


def calculate_overall_summary(monthly_stats: List[MonthlyIPv4Stat]) -> Dict[str, Any]:
    """Compute overall summary KPI metrics from monthly data."""
    if not monthly_stats:
        return {
            "total_months": 0,
            "start_month": "N/A",
            "end_month": "N/A",
            "total_transfers": 0,
            "total_ips": 0,
            "slash24_equiv": 0.0,
            "slash16_equiv": 0.0,
            "slash8_equiv": 0.0,
            "avg_transfers_per_month": 0.0,
            "avg_ips_per_month": 0.0,
            "peak_month_transfers": None,
            "peak_month_ips": None,
        }

    total_months = len(monthly_stats)
    total_transfers = sum(m.transfers for m in monthly_stats)
    total_ips = sum(m.total_ips for m in monthly_stats)
    total_unused_tx = sum(m.unused_transfers for m in monthly_stats)
    total_unused_ips = sum(m.unused_ips for m in monthly_stats)
    total_ma_tx = sum(m.ma_transfers for m in monthly_stats)
    total_ma_ips = sum(m.ma_ips for m in monthly_stats)
    total_hrt_tx = sum(m.hrt_transfers for m in monthly_stats)
    total_hrt_ips = sum(m.hrt_ips for m in monthly_stats)

    total_intra_tx = sum(m.intra_apnic_transfers for m in monthly_stats)
    total_intra_ips = sum(m.intra_apnic_ips for m in monthly_stats)
    total_inbound_tx = sum(m.inbound_transfers for m in monthly_stats)
    total_inbound_ips = sum(m.inbound_ips for m in monthly_stats)
    total_outbound_tx = sum(m.outbound_transfers for m in monthly_stats)
    total_outbound_ips = sum(m.outbound_ips for m in monthly_stats)

    peak_tx = max(monthly_stats, key=lambda m: m.transfers)
    peak_ips = max(monthly_stats, key=lambda m: m.total_ips)

    return {
        "total_months": total_months,
        "start_month": monthly_stats[0].month,
        "end_month": monthly_stats[-1].month,
        "total_transfers": total_transfers,
        "total_ips": total_ips,
        "slash24_equiv": total_ips / 256.0,
        "slash16_equiv": total_ips / 65536.0,
        "slash8_equiv": total_ips / (256.0 * 65536.0),
        "avg_transfers_per_month": total_transfers / total_months if total_months else 0.0,
        "avg_ips_per_month": total_ips / total_months if total_months else 0.0,
        "avg_slash24_per_month": (total_ips / 256.0) / total_months if total_months else 0.0,
        "peak_month_transfers": {"month": peak_tx.month, "transfers": peak_tx.transfers, "ips": peak_tx.total_ips},
        "peak_month_ips": {"month": peak_ips.month, "transfers": peak_ips.transfers, "ips": peak_ips.total_ips, "slash24s": peak_ips.slash24_equiv},
        "breakdown_type": {
            "unused": {"transfers": total_unused_tx, "ips": total_unused_ips, "pct_transfers": (total_unused_tx / total_transfers * 100) if total_transfers else 0, "pct_ips": (total_unused_ips / total_ips * 100) if total_ips else 0},
            "ma": {"transfers": total_ma_tx, "ips": total_ma_ips, "pct_transfers": (total_ma_tx / total_transfers * 100) if total_transfers else 0, "pct_ips": (total_ma_ips / total_ips * 100) if total_ips else 0},
            "hrt": {"transfers": total_hrt_tx, "ips": total_hrt_ips, "pct_transfers": (total_hrt_tx / total_transfers * 100) if total_transfers else 0, "pct_ips": (total_hrt_ips / total_ips * 100) if total_ips else 0},
        },
        "breakdown_flow": {
            "intra_apnic": {"transfers": total_intra_tx, "ips": total_intra_ips, "pct_transfers": (total_intra_tx / total_transfers * 100) if total_transfers else 0, "pct_ips": (total_intra_ips / total_ips * 100) if total_ips else 0},
            "inbound": {"transfers": total_inbound_tx, "ips": total_inbound_ips, "pct_transfers": (total_inbound_tx / total_transfers * 100) if total_transfers else 0, "pct_ips": (total_inbound_ips / total_ips * 100) if total_ips else 0},
            "outbound": {"transfers": total_outbound_tx, "ips": total_outbound_ips, "pct_transfers": (total_outbound_tx / total_transfers * 100) if total_transfers else 0, "pct_ips": (total_outbound_ips / total_ips * 100) if total_ips else 0},
        },
    }


def render_summary_text(summary: Dict[str, Any]) -> str:
    """Render a text summary dashboard."""
    lines = []
    lines.append("=" * 78)
    lines.append("              APNIC IPv4 TRANSFERS SUMMARY DASHBOARD")
    lines.append("=" * 78)
    lines.append(f"  Period:                   {summary['start_month']} to {summary['end_month']} ({summary['total_months']} active months)")
    lines.append(f"  Total IPv4 Transfers:     {summary['total_transfers']:,}")
    lines.append(f"  Total IPv4 Addresses:     {summary['total_ips']:,} IPs")
    lines.append(f"  Prefix Equivalents:       {summary['slash24_equiv']:,.0f} x /24  |  {summary['slash16_equiv']:,.2f} x /16  |  {summary['slash8_equiv']:,.4f} x /8")
    lines.append(f"  Monthly Averages:         {summary['avg_transfers_per_month']:,.1f} transfers/mo  |  {summary['avg_ips_per_month']:,.0f} IPs/mo ({summary['avg_slash24_per_month']:,.1f} /24s)")
    
    peak_tx = summary.get("peak_month_transfers")
    if peak_tx:
        lines.append(f"  Peak Month (Transfers):   {peak_tx['month']} ({peak_tx['transfers']:,} transfers, {peak_tx['ips']:,} IPs)")
    
    peak_ips = summary.get("peak_month_ips")
    if peak_ips:
        lines.append(f"  Peak Month (IP Volume):   {peak_ips['month']} ({peak_ips['ips']:,} IPs, {peak_ips['slash24s']:,.0f} /24s in {peak_ips['transfers']:,} transfers)")

    lines.append("-" * 78)
    lines.append("  Transfer Type Breakdown:")
    bt = summary.get("breakdown_type", {})
    lines.append(f"    - Market / Unused:      {bt.get('unused', {}).get('transfers', 0):>6,} ({bt.get('unused', {}).get('pct_transfers', 0):>5.1f}%) | {bt.get('unused', {}).get('ips', 0):>12,} IPs ({bt.get('unused', {}).get('pct_ips', 0):>5.1f}%)")
    lines.append(f"    - Mergers & Acq (M&A):  {bt.get('ma', {}).get('transfers', 0):>6,} ({bt.get('ma', {}).get('pct_transfers', 0):>5.1f}%) | {bt.get('ma', {}).get('ips', 0):>12,} IPs ({bt.get('ma', {}).get('pct_ips', 0):>5.1f}%)")
    lines.append(f"    - Historical (HRT):     {bt.get('hrt', {}).get('transfers', 0):>6,} ({bt.get('hrt', {}).get('pct_transfers', 0):>5.1f}%) | {bt.get('hrt', {}).get('ips', 0):>12,} IPs ({bt.get('hrt', {}).get('pct_ips', 0):>5.1f}%)")

    lines.append("-" * 78)
    lines.append("  RIR Flow Breakdown:")
    bf = summary.get("breakdown_flow", {})
    lines.append(f"    - Intra-APNIC:          {bf.get('intra_apnic', {}).get('transfers', 0):>6,} ({bf.get('intra_apnic', {}).get('pct_transfers', 0):>5.1f}%) | {bf.get('intra_apnic', {}).get('ips', 0):>12,} IPs ({bf.get('intra_apnic', {}).get('pct_ips', 0):>5.1f}%)")
    lines.append(f"    - Inbound Inter-RIR:    {bf.get('inbound', {}).get('transfers', 0):>6,} ({bf.get('inbound', {}).get('pct_transfers', 0):>5.1f}%) | {bf.get('inbound', {}).get('ips', 0):>12,} IPs ({bf.get('inbound', {}).get('pct_ips', 0):>5.1f}%)")
    lines.append(f"    - Outbound Inter-RIR:   {bf.get('outbound', {}).get('transfers', 0):>6,} ({bf.get('outbound', {}).get('pct_transfers', 0):>5.1f}%) | {bf.get('outbound', {}).get('ips', 0):>12,} IPs ({bf.get('outbound', {}).get('pct_ips', 0):>5.1f}%)")
    lines.append("=" * 78)
    return "\n".join(lines)


def render_ascii_table(
    headers: List[str],
    rows: List[List[str]],
    alignments: Optional[List[str]] = None,
) -> str:
    """Render a clean formatted ASCII table with dynamic column widths."""
    if not headers and not rows:
        return ""

    num_cols = len(headers)
    aligns = alignments or (["left"] + ["right"] * (num_cols - 1))

    widths = [len(h) for h in headers]
    for row in rows:
        for idx, val in enumerate(row):
            if idx < num_cols:
                widths[idx] = max(widths[idx], len(val))

    def format_row(row_vals: List[str]) -> str:
        cells = []
        for idx, val in enumerate(row_vals):
            w = widths[idx]
            a = aligns[idx]
            if a == "left":
                cells.append(val.ljust(w))
            elif a == "center":
                cells.append(val.center(w))
            else:
                cells.append(val.rjust(w))
        return " | ".join(cells)

    separator = "-+-".join("-" * w for w in widths)

    lines = []
    lines.append(format_row(headers))
    lines.append(separator)
    for r in rows:
        lines.append(format_row(r))
    return "\n".join(lines)


def render_markdown_table(
    headers: List[str],
    rows: List[List[str]],
    alignments: Optional[List[str]] = None,
) -> str:
    """Render a GitHub-flavored markdown table."""
    if not headers and not rows:
        return ""

    num_cols = len(headers)
    aligns = alignments or (["left"] + ["right"] * (num_cols - 1))

    sep_cells = []
    for a in aligns:
        if a == "left":
            sep_cells.append(":---")
        elif a == "center":
            sep_cells.append(":---:")
        else:
            sep_cells.append("---:")

    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(sep_cells) + " |",
    ]
    for r in rows:
        lines.append("| " + " | ".join(r) + " |")
    return "\n".join(lines)


def format_monthly_table(
    monthly_stats: List[MonthlyIPv4Stat],
    mode: str = "standard",
    output_format: str = "table",
) -> str:
    """Format monthly stats table in standard or detailed view."""
    if not monthly_stats:
        return "No IPv4 transfer records matched the query."

    if mode == "compact":
        headers = ["Month", "Transfers", "Total IPs", "/24 Equiv", "Cumul IPs", "Cumul /24s"]
        aligns = ["left", "right", "right", "right", "right", "right"]
        rows = []
        for m in monthly_stats:
            rows.append([
                m.month,
                f"{m.transfers:,}",
                f"{m.total_ips:,}",
                f"{m.slash24_equiv:,.0f}",
                f"{m.cumul_ips:,}",
                f"{m.cumul_slash24_equiv:,.0f}",
            ])
    elif mode == "detailed":
        headers = [
            "Month",
            "Transfers",
            "Total IPs",
            "/24 Equiv",
            "Unused (Tx)",
            "M&A (Tx)",
            "HRT (Tx)",
            "Intra (Tx)",
            "Inbound (Tx)",
            "Outbound (Tx)",
            "Cumul IPs",
            "Cumul /24s",
        ]
        aligns = ["left"] + ["right"] * 11
        rows = []
        for m in monthly_stats:
            rows.append([
                m.month,
                f"{m.transfers:,}",
                f"{m.total_ips:,}",
                f"{m.slash24_equiv:,.0f}",
                f"{m.unused_transfers:,}",
                f"{m.ma_transfers:,}",
                f"{m.hrt_transfers:,}",
                f"{m.intra_apnic_transfers:,}",
                f"{m.inbound_transfers:,}",
                f"{m.outbound_transfers:,}",
                f"{m.cumul_ips:,}",
                f"{m.cumul_slash24_equiv:,.0f}",
            ])
    else:  # standard
        headers = [
            "Month",
            "Transfers",
            "Total IPs",
            "/24 Equiv",
            "Market (IPs)",
            "M&A (IPs)",
            "HRT (IPs)",
            "Intra (IPs)",
            "Inter-RIR (IPs)",
            "Cumul IPs",
        ]
        aligns = ["left"] + ["right"] * 9
        rows = []
        for m in monthly_stats:
            inter_rir_ips = m.inbound_ips + m.outbound_ips
            rows.append([
                m.month,
                f"{m.transfers:,}",
                f"{m.total_ips:,}",
                f"{m.slash24_equiv:,.0f}",
                f"{m.unused_ips:,}",
                f"{m.ma_ips:,}",
                f"{m.hrt_ips:,}",
                f"{m.intra_apnic_ips:,}",
                f"{inter_rir_ips:,}",
                f"{m.cumul_ips:,}",
            ])

    if output_format == "markdown":
        return render_markdown_table(headers, rows, aligns)
    return render_ascii_table(headers, rows, aligns)


def format_yearly_table(
    yearly_stats: List[Dict[str, Any]],
    output_format: str = "table",
) -> str:
    """Format yearly aggregation table."""
    headers = [
        "Year",
        "Months",
        "Transfers",
        "Total IPs",
        "/24 Equiv",
        "/16 Equiv",
        "Market IPs",
        "M&A IPs",
        "HRT IPs",
        "Cumul IPs",
    ]
    aligns = ["left"] + ["right"] * 9
    rows = []
    for y in yearly_stats:
        rows.append([
            y["year"],
            str(y["months_active"]),
            f"{y['transfers']:,}",
            f"{y['total_ips']:,}",
            f"{y['slash24_equiv']:,.0f}",
            f"{y['slash16_equiv']:,.2f}",
            f"{y['unused_ips']:,}",
            f"{y['ma_ips']:,}",
            f"{y['hrt_ips']:,}",
            f"{y['cumul_ips']:,}",
        ])

    if output_format == "markdown":
        return render_markdown_table(headers, rows, aligns)
    return render_ascii_table(headers, rows, aligns)


def format_economies_table(
    top_sources: List[Dict[str, Any]],
    top_destinations: List[Dict[str, Any]],
    output_format: str = "table",
) -> str:
    """Format top economies source and destination tables."""
    lines = []

    # Top Sources
    s_headers = ["Rank", "Source Economy", "Transfers", "Total IPs", "/24 Equiv"]
    s_aligns = ["right", "left", "right", "right", "right"]
    s_rows = []
    for idx, s in enumerate(top_sources, start=1):
        s_rows.append([
            str(idx),
            s["economy"],
            f"{s['transfers']:,}",
            f"{s['total_ips']:,}",
            f"{s['slash24s']:,.0f}",
        ])

    lines.append("\n--- Top Source Economies (Outbound / Transferred From) ---")
    if output_format == "markdown":
        lines.append(render_markdown_table(s_headers, s_rows, s_aligns))
    else:
        lines.append(render_ascii_table(s_headers, s_rows, s_aligns))

    # Top Destinations
    d_headers = ["Rank", "Dest Economy", "Transfers", "Total IPs", "/24 Equiv"]
    d_aligns = ["right", "left", "right", "right", "right"]
    d_rows = []
    for idx, d in enumerate(top_destinations, start=1):
        d_rows.append([
            str(idx),
            d["economy"],
            f"{d['transfers']:,}",
            f"{d['total_ips']:,}",
            f"{d['slash24s']:,.0f}",
        ])

    lines.append("\n--- Top Destination Economies (Inbound / Transferred To) ---")
    if output_format == "markdown":
        lines.append(render_markdown_table(d_headers, d_rows, d_aligns))
    else:
        lines.append(render_ascii_table(d_headers, d_rows, d_aligns))

    return "\n".join(lines)


def format_prefix_table(
    prefix_dist: List[Dict[str, Any]],
    output_format: str = "table",
) -> str:
    """Format prefix length distribution table."""
    headers = ["Prefix", "Length", "Transfers", "Total IPs", "/24 Equiv", "Share (%)"]
    aligns = ["left", "right", "right", "right", "right", "right"]
    total_ips_sum = sum(p["total_ips"] for p in prefix_dist) or 1
    rows = []
    for p in prefix_dist:
        share = (p["total_ips"] / total_ips_sum) * 100.0
        rows.append([
            p["prefix"],
            str(p["prefix_len"]),
            f"{p['transfers']:,}",
            f"{p['total_ips']:,}",
            f"{p['slash24s']:,.0f}",
            f"{share:>5.2f}%",
        ])

    title = "\n--- IPv4 Prefix Size Distribution ---"
    if output_format == "markdown":
        return title + "\n" + render_markdown_table(headers, rows, aligns)
    return title + "\n" + render_ascii_table(headers, rows, aligns)


def export_csv_data(
    monthly_stats: List[MonthlyIPv4Stat],
    yearly_stats: Optional[List[Dict[str, Any]]] = None,
) -> str:
    """Generate CSV string of monthly transfer data."""
    output = io.StringIO()
    writer = csv.writer(output)

    writer.writerow([
        "month",
        "transfers",
        "total_ips",
        "slash24_equiv",
        "slash16_equiv",
        "cumul_transfers",
        "cumul_ips",
        "cumul_slash24_equiv",
        "unused_transfers",
        "unused_ips",
        "ma_transfers",
        "ma_ips",
        "hrt_transfers",
        "hrt_ips",
        "intra_apnic_transfers",
        "intra_apnic_ips",
        "inbound_transfers",
        "inbound_ips",
        "outbound_transfers",
        "outbound_ips",
    ])

    for m in monthly_stats:
        writer.writerow([
            m.month,
            m.transfers,
            m.total_ips,
            f"{m.slash24_equiv:.2f}",
            f"{m.slash16_equiv:.4f}",
            m.cumul_transfers,
            m.cumul_ips,
            f"{m.cumul_slash24_equiv:.2f}",
            m.unused_transfers,
            m.unused_ips,
            m.ma_transfers,
            m.ma_ips,
            m.hrt_transfers,
            m.hrt_ips,
            m.intra_apnic_transfers,
            m.intra_apnic_ips,
            m.inbound_transfers,
            m.inbound_ips,
            m.outbound_transfers,
            m.outbound_ips,
        ])

    return output.getvalue()


def export_json_data(
    summary: Dict[str, Any],
    monthly_stats: List[MonthlyIPv4Stat],
    yearly_stats: Optional[List[Dict[str, Any]]] = None,
    top_sources: Optional[List[Dict[str, Any]]] = None,
    top_destinations: Optional[List[Dict[str, Any]]] = None,
    prefix_dist: Optional[List[Dict[str, Any]]] = None,
) -> str:
    """Generate structured JSON report."""
    data = {
        "summary": summary,
        "monthly_statistics": [asdict(m) for m in monthly_stats],
    }
    if yearly_stats:
        data["yearly_statistics"] = yearly_stats
    if top_sources and top_destinations:
        data["top_economies"] = {
            "sources": top_sources,
            "destinations": top_destinations,
        }
    if prefix_dist:
        data["prefix_distribution"] = prefix_dist

    return json.dumps(data, indent=2)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Query SQLite transfers database and report monthly IPv4 transfer statistics."
    )
    parser.add_argument(
        "-d",
        "--db",
        type=Path,
        default=DEFAULT_DB_FILE,
        help=f"Path to SQLite database file (default: {DEFAULT_DB_FILE.name})",
    )
    parser.add_argument(
        "-t",
        "--table",
        type=str,
        default=DEFAULT_TABLE_NAME,
        help=f"Database table name (default: {DEFAULT_TABLE_NAME})",
    )
    parser.add_argument(
        "-y",
        "--year",
        type=int,
        help="Filter statistics for a specific year (e.g. 2024)",
    )
    parser.add_argument(
        "--start-month",
        type=str,
        help="Start month filter in YYYY-MM format (e.g. 2020-01)",
    )
    parser.add_argument(
        "--end-month",
        type=str,
        help="End month filter in YYYY-MM format (e.g. 2024-12)",
    )
    parser.add_argument(
        "--last-months",
        type=int,
        metavar="N",
        help="Show only the most recent N months",
    )
    parser.add_argument(
        "--type",
        type=str,
        dest="transfer_type",
        choices=["Unused", "M&A", "HRT", "unused", "m&a", "hrt"],
        help="Filter by transfer type (Unused, M&A, HRT)",
    )
    parser.add_argument(
        "--flow",
        type=str,
        choices=["intra", "inbound", "outbound"],
        help="Filter by RIR transfer flow (intra, inbound, outbound)",
    )
    parser.add_argument(
        "-e",
        "--economy",
        type=str,
        help="Filter transfers involving specific economy code (e.g. AU, JP, SG, IN)",
    )
    parser.add_argument(
        "-f",
        "--format",
        type=str,
        choices=["table", "markdown", "csv", "json"],
        default="table",
        help="Output format (default: table)",
    )
    parser.add_argument(
        "--view",
        type=str,
        choices=["standard", "detailed", "compact"],
        default="standard",
        help="Monthly table column detail level (default: standard)",
    )
    parser.add_argument(
        "--yearly",
        action="store_true",
        help="Include yearly summary aggregation table",
    )
    parser.add_argument(
        "--top-economies",
        action="store_true",
        help="Include top source and destination economies breakdown",
    )
    parser.add_argument(
        "--prefixes",
        action="store_true",
        help="Include IPv4 prefix size (/24 to /8) distribution breakdown",
    )
    parser.add_argument(
        "--summary-only",
        action="store_true",
        help="Show only the summary KPI dashboard (omit individual monthly rows)",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="Write output report to the specified file instead of stdout",
    )

    args = parser.parse_args()

    if not args.db.exists():
        print(
            f"Error: Database file '{args.db}' does not exist.\n"
            f"Please run 'load_transfers.py' first to create and populate the database.",
            file=sys.stderr,
        )
        sys.exit(1)

    try:
        conn = sqlite3.connect(args.db)
    except sqlite3.Error as err:
        print(f"Error connecting to database '{args.db}': {err}", file=sys.stderr)
        sys.exit(1)

    try:
        monthly_stats = fetch_monthly_stats(
            conn=conn,
            table_name=args.table,
            start_month=args.start_month,
            end_month=args.end_month,
            year=args.year,
            transfer_type=args.transfer_type,
            flow=args.flow,
            economy=args.economy,
        )

        if not monthly_stats:
            print("No matching IPv4 transfer records found for the given criteria.")
            sys.exit(0)

        # Slice to last N months if requested
        display_monthly = monthly_stats
        if args.last_months and args.last_months > 0:
            display_monthly = monthly_stats[-args.last_months:]

        summary = calculate_overall_summary(monthly_stats)
        yearly_stats = fetch_yearly_stats(monthly_stats) if args.yearly else None

        where_sql, filter_params = build_filter_clause(
            start_month=args.start_month,
            end_month=args.end_month,
            year=args.year,
            transfer_type=args.transfer_type,
            flow=args.flow,
            economy=args.economy,
        )

        top_sources = None
        top_destinations = None
        if args.top_economies:
            top_sources, top_destinations = fetch_top_economies(
                conn=conn,
                table_name=args.table,
                where_sql=where_sql,
                params=filter_params,
            )

        prefix_dist = None
        if args.prefixes:
            prefix_dist = fetch_prefix_distribution(
                conn=conn,
                table_name=args.table,
                where_sql=where_sql,
                params=filter_params,
            )

        # Generate output based on format
        output_text = ""
        if args.format == "csv":
            output_text = export_csv_data(display_monthly, yearly_stats)
        elif args.format == "json":
            output_text = export_json_data(
                summary=summary,
                monthly_stats=display_monthly,
                yearly_stats=yearly_stats,
                top_sources=top_sources,
                top_destinations=top_destinations,
                prefix_dist=prefix_dist,
            )
        else:
            # table or markdown
            output_blocks = []
            if not args.summary_only:
                if args.format == "markdown":
                    output_blocks.append("## APNIC IPv4 Monthly Transfer Statistics\n")
                output_blocks.append(format_monthly_table(display_monthly, mode=args.view, output_format=args.format))

            if args.yearly and yearly_stats:
                if args.format == "markdown":
                    output_blocks.append("\n## Annual IPv4 Transfer Summaries\n")
                else:
                    output_blocks.append("\n--- Annual IPv4 Transfer Summaries ---")
                output_blocks.append(format_yearly_table(yearly_stats, output_format=args.format))

            if args.prefixes and prefix_dist:
                output_blocks.append(format_prefix_table(prefix_dist, output_format=args.format))

            if args.top_economies and top_sources and top_destinations:
                output_blocks.append(format_economies_table(top_sources, top_destinations, output_format=args.format))

            summary_block = render_summary_text(summary)
            output_blocks.append("\n" + summary_block)
            output_text = "\n".join(output_blocks)

        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(output_text, encoding="utf-8")
            print(f"Report successfully written to '{args.output}'.")
        else:
            print(output_text)

    finally:
        conn.close()


if __name__ == "__main__":
    import os
    try:
        main()
    except BrokenPipeError:
        try:
            sys.stdout.close()
        except Exception:
            pass
        os._exit(0)

