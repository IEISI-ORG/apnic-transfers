# APNIC Transfers Analysis

A Python toolkit for downloading, ingesting, and analyzing APNIC Internet number resource transfers (IPv4, IPv6, and AS numbers) with a focus on monthly IPv4 transfer statistics and trends.

---

## Table of Contents

- [Overview](#overview)
- [Interactive Web Dashboard (sql.js + Chart.js)](#interactive-web-dashboard-sqljs--chartjs)
- [Data Source](#data-source)
- [Database Schema](#database-schema)
- [Getting Started](#getting-started)
- [Scripts & Usage](#scripts--usage)
  - [1. Data Ingestion: `load_transfers.py`](#1-data-ingestion-load_transferspy)
  - [2. Monthly Reporting & Analytics: `report_monthly_ipv4.py`](#2-monthly-reporting--analytics-report_monthly_ipv4py)
  - [3. Interactive Web Dashboard: `serve.py`](#3-interactive-web-dashboard-servepy)
- [CLI Reference](#cli-reference)
  - [Options for `load_transfers.py`](#options-for-load_transferspy)
  - [Options for `report_monthly_ipv4.py`](#options-for-report_monthly_ipv4py)
- [Metrics & Definitions](#metrics--definitions)
- [Sample Outputs](#sample-outputs)
- [Programmatic Python API](#programmatic-python-api)

---

## Overview

The APNIC transfer log contains historical records of resource transfers within the Asia-Pacific region and between Regional Internet Registries (RIRs). This toolkit provides:

1. **Fast SQLite Ingestion**: Loads delimited transfer log dumps into an indexed SQLite database in seconds.
2. **Monthly IPv4 Aggregation**: Computes monthly transfer volumes, total IP counts, and `/24` prefix equivalents.
3. **Interactive Web Dashboard**: Fully client-side analytics powered by **[sql.js](https://sql.js.org/)** (WebAssembly SQLite) and **[Chart.js](https://www.chartjs.org/)**.
4. **Multi-Dimensional Breakdowns**:
   - **Transfer Types**: Market / Unused transfers, Mergers & Acquisitions (M&A), and Historical Resource Transfers (HRT).
   - **RIR Flows**: Intra-APNIC transfers vs. Inbound / Outbound Inter-RIR transfers (ARIN, RIPE NCC, LACNIC).
   - **Geographic Distributions**: Top source and destination economies.
   - **Prefix Sizes**: Distribution from `/8` down to `/24`.
5. **Multiple Export Formats**: Clean ASCII console tables, GitHub Flavored Markdown, CSV, and structured JSON.

---

## Interactive Web Dashboard (sql.js + Chart.js)

An interactive, client-side web application is included to visualize trends, filter data dynamically, and run arbitrary SQL queries directly in your browser without needing a backend server:

- **WebAssembly SQL Engine ([sql.js](https://sql.js.org/))**: Loads `transfers.db` into browser memory and executes high-speed parameterized SQL queries locally.
- **Interactive Visualizations ([Chart.js](https://www.chartjs.org/))**:
  - Monthly IPv4 Transfer counts and total IP volume (/24 equivalents dual-axis combo chart).
  - Cumulative address and transaction growth curves.
  - Policy breakdown stacked bars (Market / Unused, M&A, HRT).
  - RIR Flow dynamics (Intra-APNIC vs Inbound vs Outbound Inter-RIR).
  - Top Source and Destination Economies horizontal bar charts.
  - Subnet prefix length histogram (/8 through /24).
  - IPv6 and ASN dedicated analytics tabs.
- **SQL Query Sandbox**: Run custom SQL queries directly against SQLite in the browser, with query execution timing, presets, pagination, and CSV/JSON export.
- **Dark & Light Mode**: Built-in modern theme switcher with responsive UI.

To launch the web dashboard:

```bash
python3 serve.py
```

Then open your browser at `http://127.0.0.1:8000/`.

---

## Data Source

APNIC publishes full transfer logs daily:
- **URL**: `https://ftp.apnic.net/transfers-all/apnic/transfer-all-apnic-latest`
- **Format**: Pipe-delimited (`|`) text file containing 11 fields per record.

To fetch or refresh the latest dataset:

```bash
curl -O https://ftp.apnic.net/transfers-all/apnic/transfer-all-apnic-latest
```

---

## Database Schema

`load_transfers.py` creates a table named `transfers` (in `transfers.db` by default) with the following structure:

| Column | Type | Description | Example |
|:---|:---|:---|:---|
| `id` | `INTEGER` | Auto-increment primary key | `1` |
| `resource_type` | `TEXT` | Resource category (`ipv4`, `ipv6`, `asn`) | `ipv4` |
| `resource` | `TEXT` | CIDR block or ASN | `203.14.126.0/24` |
| `from_organisation` | `TEXT` | Transferor source organization | `Alphawest Services Pty Ltd` |
| `from_economy` | `TEXT` | ISO 2-letter economy code of source | `AU` |
| `from_rir` | `TEXT` | Source RIR | `APNIC` |
| `previous_delegation_date` | `TEXT` | Date of original delegation (`YYYYMMDD`) | `19950428` |
| `to_organisation` | `TEXT` | Transferee recipient organization | `Alphawest Services` |
| `to_economy` | `TEXT` | ISO 2-letter economy code of recipient | `AU` |
| `to_rir` | `TEXT` | Recipient RIR | `APNIC` |
| `transfer_date` | `TEXT` | Date transfer took effect (`YYYYMMDD`) | `20101119` |
| `transfer_type` | `TEXT` | Policy category (`Unused`, `M&A`, `HRT`) | `Unused` |

Indexes are automatically built on `resource_type`, `resource`, `transfer_date`, `from_organisation`, and `to_organisation`.

---

## Getting Started

### Prerequisites
- Python 3.8+ (uses only Python standard library modules: `sqlite3`, `argparse`, `csv`, `json`, `pathlib`, `dataclasses`).

### Quickstart

```bash
# 1. Ingest transfer log into SQLite
python3 load_transfers.py

# 2. Generate the monthly IPv4 report
python3 report_monthly_ipv4.py

# 3. View the summary dashboard only
python3 report_monthly_ipv4.py --summary-only
```

---

## Scripts & Usage

### 1. Data Ingestion: `load_transfers.py`

Parses `transfer-all-apnic-latest` and populates the SQLite database.

```bash
# Ingest default file into transfers.db
python3 load_transfers.py

# Specify custom input file and database destination
python3 load_transfers.py --input /path/to/transfer-log --db /path/to/custom.db

# Append to existing table without dropping
python3 load_transfers.py --append
```

### 2. Monthly Reporting & Analytics: `report_monthly_ipv4.py`

Analyzes IPv4 transfer activity grouped by month.

#### Basic Usage & Views

```bash
# Standard table view (default)
python3 report_monthly_ipv4.py

# Detailed view with separate columns for transfer types and flows
python3 report_monthly_ipv4.py --view detailed

# Compact view for narrower terminals
python3 report_monthly_ipv4.py --view compact

# Show only the last 12 months
python3 report_monthly_ipv4.py --last-months 12
```

#### Filtering

```bash
# Filter by year
python3 report_monthly_ipv4.py --year 2024

# Filter by date range (YYYY-MM)
python3 report_monthly_ipv4.py --start-month 2023-01 --end-month 2024-12

# Filter by transfer policy type (Unused / Market, M&A, HRT)
python3 report_monthly_ipv4.py --type Unused
python3 report_monthly_ipv4.py --type M&A

# Filter by RIR flow (intra, inbound, outbound)
python3 report_monthly_ipv4.py --flow intra
python3 report_monthly_ipv4.py --flow inbound

# Filter by economy code (involving AU, JP, SG, etc.)
python3 report_monthly_ipv4.py --economy AU
```

#### Extended Analytics & Rollups

```bash
# Include annual summary rollups, top economies, and prefix distribution
python3 report_monthly_ipv4.py --year 2024 --yearly --top-economies --prefixes

# High-level KPI summary only
python3 report_monthly_ipv4.py --summary-only
```

#### Exporting

```bash
# Export to CSV file
python3 report_monthly_ipv4.py --format csv -o ipv4_transfers_monthly.csv

# Export to structured JSON file
python3 report_monthly_ipv4.py --format json -o ipv4_transfers_monthly.json

# Output as GitHub Flavored Markdown
python3 report_monthly_ipv4.py --year 2025 --format markdown
```

### 3. Interactive Web Dashboard: `serve.py`

Launches a local development server for the browser-based dashboard.

```bash
# Start server and automatically open default browser
python3 serve.py

# Specify custom port or disable auto-opening browser
python3 serve.py --port 8080 --no-browser
```

---

## CLI Reference

### Options for `load_transfers.py`

| Flag | Type | Default | Description |
|:---|:---|:---|:---|
| `-i, --input` | `Path` | `transfer-all-apnic-latest` | Path to raw transfer log file |
| `-d, --db` | `Path` | `transfers.db` | Path to SQLite database |
| `-t, --table` | `str` | `transfers` | Table name |
| `--append` | `flag` | `False` | Append to table instead of dropping and recreating |

### Options for `report_monthly_ipv4.py`

| Flag | Type | Default | Description |
|:---|:---|:---|:---|
| `-d, --db` | `Path` | `transfers.db` | Path to SQLite database |
| `-t, --table` | `str` | `transfers` | Table name |
| `-y, --year` | `int` | `None` | Filter by year (e.g. `2024`) |
| `--start-month` | `str` | `None` | Start month filter (`YYYY-MM`) |
| `--end-month` | `str` | `None` | End month filter (`YYYY-MM`) |
| `--last-months` | `int` | `None` | Show only the most recent N months |
| `--type` | `choice` | `None` | Transfer type filter (`Unused`, `M&A`, `HRT`) |
| `--flow` | `choice` | `None` | RIR flow filter (`intra`, `inbound`, `outbound`) |
| `-e, --economy` | `str` | `None` | Filter by 2-letter economy code (e.g. `AU`) |
| `-f, --format` | `choice` | `table` | Output format (`table`, `markdown`, `csv`, `json`) |
| `--view` | `choice` | `standard` | Column layout (`standard`, `detailed`, `compact`) |
| `--yearly` | `flag` | `False` | Include annual summary rollups |
| `--top-economies` | `flag` | `False` | Include top source and destination economies |
| `--prefixes` | `flag` | `False` | Include prefix length distribution (/24 to /8) |
| `--summary-only` | `flag` | `False` | Display only the KPI summary dashboard |
| `-o, --output` | `Path` | `stdout` | Write output to a file |

---

## Metrics & Definitions

- **Total IPs**: Total individual IPv4 addresses transferred ($2^{32 - \text{prefix\_length}}$).
- **/24 Equivalents**: Address count expressed in standard `/24` subnets ($\frac{\text{Total IPs}}{256}$).
- **/16 Equivalents**: Address count expressed in `/16` blocks ($\frac{\text{Total IPs}}{65,536}$).
- **Cumulative (Cumul)**: Running totals since the beginning of records or selected period.
- **Transfer Types**:
  - `Unused / Market`: Market-based transfers under APNIC transfer policy (prop-050 / prop-103).
  - `M&A`: Transfers resulting from company mergers, acquisitions, or restructuring.
  - `HRT`: Historical Resource Transfers.
- **RIR Flow**:
  - `Intra-APNIC`: Transfer between entities within the APNIC service region (`APNIC -> APNIC`).
  - `Inbound Inter-RIR`: Transfer from another RIR to APNIC (e.g., `ARIN -> APNIC`, `RIPE -> APNIC`).
  - `Outbound Inter-RIR`: Transfer from APNIC to another RIR (e.g., `APNIC -> ARIN`, `APNIC -> RIPE`).

---

## Sample Outputs

### 1. Summary Dashboard (`--summary-only`)

```text
==============================================================================
              APNIC IPv4 TRANSFERS SUMMARY DASHBOARD
==============================================================================
  Period:                   2010-11 to 2026-08 (188 active months)
  Total IPv4 Transfers:     16,637
  Total IPv4 Addresses:     145,969,664 IPs
  Prefix Equivalents:       570,194 x /24  |  2,227.32 x /16  |  8.7005 x /8
  Monthly Averages:         88.5 transfers/mo  |  776,434 IPs/mo (3,032.9 /24s)
  Peak Month (Transfers):   2026-06 (1,471 transfers, 2,238,464 IPs)
  Peak Month (IP Volume):   2020-03 (15,094,272 IPs, 58,962 /24s in 61 transfers)
------------------------------------------------------------------------------
  Transfer Type Breakdown:
    - Market / Unused:      11,016 ( 66.2%) |   94,916,352 IPs ( 65.0%)
    - Mergers & Acq (M&A):   5,050 ( 30.4%) |   34,473,472 IPs ( 23.6%)
    - Historical (HRT):        571 (  3.4%) |   16,579,840 IPs ( 11.4%)
------------------------------------------------------------------------------
  RIR Flow Breakdown:
    - Intra-APNIC:          14,036 ( 84.4%) |  112,197,376 IPs ( 76.9%)
    - Inbound Inter-RIR:     1,144 (  6.9%) |   27,116,800 IPs ( 18.6%)
    - Outbound Inter-RIR:    1,457 (  8.8%) |    6,655,488 IPs (  4.6%)
==============================================================================
```

### 2. Monthly Table (`--year 2024`)

```text
Month   | Transfers | Total IPs | /24 Equiv | Market (IPs) | M&A (IPs) | HRT (IPs) | Intra (IPs) | Inter-RIR (IPs) | Cumul IPs
--------+-----------+-----------+-----------+--------------+-----------+-----------+-------------+-----------------+----------
2024-01 |       123 |   281,600 |     1,100 |      244,480 |    35,072 |     2,048 |     199,936 |          81,664 |   281,600
2024-02 |       136 |   166,656 |       651 |      127,488 |    25,856 |    13,312 |     132,352 |          34,304 |   448,256
2024-03 |       106 |   631,552 |     2,467 |      616,192 |     9,984 |     5,376 |     409,088 |         222,464 | 1,079,808
2024-04 |       116 |   234,240 |       915 |      215,552 |    10,752 |     7,936 |     208,640 |          25,600 | 1,314,048
2024-05 |       175 | 1,503,232 |     5,872 |    1,025,536 |   475,392 |     2,304 |     886,272 |         616,960 | 2,817,280
2024-06 |       112 |   457,472 |     1,787 |      317,696 |   119,552 |    20,224 |     222,464 |         235,008 | 3,274,752
2024-07 |       270 |   481,536 |     1,881 |      229,888 |   251,136 |       512 |     370,944 |         110,592 | 3,756,288
2024-08 |        88 |   724,736 |     2,831 |      612,352 |   111,872 |       512 |     621,312 |         103,424 | 4,481,024
2024-09 |       109 |   444,416 |     1,736 |       97,536 |   343,296 |     3,584 |     397,056 |          47,360 | 4,925,440
2024-10 |       101 | 1,043,200 |     4,075 |      729,856 |   313,088 |       256 |     994,304 |          48,896 | 5,968,640
2024-11 |       125 |   763,904 |     2,984 |      288,256 |   475,392 |       256 |     723,200 |          40,704 | 6,732,544
2024-12 |       154 |   689,408 |     2,693 |      684,800 |     4,608 |         0 |     222,464 |         466,944 | 7,421,952
```

---

## Programmatic Python API

Both scripts are modular and can be imported directly into Python applications:

```python
import sqlite3
from pathlib import Path
from report_monthly_ipv4 import (
    fetch_monthly_stats,
    calculate_overall_summary,
    fetch_yearly_stats,
    fetch_top_economies,
)

conn = sqlite3.connect("transfers.db")

# Query monthly stats for 2024
stats_2024 = fetch_monthly_stats(conn, year=2024)
for m in stats_2024:
    print(f"{m.month}: {m.transfers} transfers, {m.total_ips:,} IPs ({m.slash24_equiv:,.0f} /24s)")

# Overall KPI summary
summary = calculate_overall_summary(stats_2024)
print(f"Total IPs transferred: {summary['total_ips']:,}")

conn.close()
```
