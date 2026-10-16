# APNIC IPv4 transfers: 2026-09

Month is closed (latest IPv4 record 2026-10-15), but this run added 22 late IPv4 records to August, so September totals may still grow.

## Headline

- 85 transfers, 1,692,672 IPs (6,612 /24s): 3.1× the trailing-12-month median of 551,552 IPs; biggest month since 2026-06 (2,238,464).
- M&A: 33 transfers, 1,318,144 IPs (77.9% of volume), 14.7× its 12-month median of 89,856. Largest M&A month since 2023-08 (2,472,448). Two same-day Thai intra-group deals account for 1,255,936 IPs (95.3% of M&A).
- Market: 52 transfers, 374,528 IPs, in line with the 12-month median (360,960). Only 45,568 IPs were intra-APNIC; 328,960 (87.8%) came across an RIR boundary.
- Inbound inter-RIR 327,680 IPs on 24 transfers vs outbound 1,280 on 2. One ARIN handle (GCSA-20) supplied 163,840 of the inbound.
- HRT: 0 for the month.

## Month vs baseline

Trailing 12 months = 2025-09 to 2026-08 from `report.txt`.

| Metric | 2026-09 | 12-mo mean | 12-mo median | Ratio to median |
|---|---|---|---|---|
| Transfers (all) | 85 | 205.6 (inflated by 2026-06's 1,471) | 90.5 | 0.94× |
| IPs (all) | 1,692,672 | 782,464 | 551,552 | 3.07× |
| Market IPs | 374,528 | 592,320 | 360,960 | 1.04× |
| M&A IPs | 1,318,144 | 190,059 | 89,856 | 14.67× |
| HRT IPs | 0 | 85 | 0 | — |

Market transfer count: 52 vs median 70 over the 11 months `market.txt` covers (2025-10 to 2026-08). M&A drives the whole excess; market is at its usual level by IPs and below it by count.

## Largest transfers

| Deal | Blocks | IPs | From → To | Type |
|---|---|---|---|---|
| Triple T Broadband → Advanced Wireless Network (TH→TH, APNIC), 09-16 | 2×/14, 2×/15, 3×/16, 2×/17, 2×/22, /23 (+3 ASN, 2 IPv6 /32) | 1,051,136 | 4,106 /24s; 62.1% of month | M&A |
| True Move Company → True Move H Universal Communication (TH→TH), 09-28 | 3×/16, /19 (+3 ASN, 1 IPv6) | 204,800 | 800 /24s | M&A |
| ARIN/GCSA-20 → Jazzworld Pakistan (AP→PK), 09-15 | 10×/19, 4×/20 in 187/8, 189/8 | 98,304 | 384 /24s | Unused |
| LACNIC → POWER LINE (HK) 166.75.0.0/16; LACNIC → FASTMOS (HK) 191.124.0.0/16, 09-03 | 2×/16 | 131,072 | two separate holders | Unused |
| ARIN/GCSA-20 → Simba Telecom (SG) 179.239.0.0/16, 09-14 | /16 | 65,536 | | Unused |
| ZTNET (KH) → ZT INFORMATION NETWORK (HK), 09-01 | 9 blocks covering most of 79.109.0.0/16 | 57,088 | | M&A |

Inference: the two Thai deals and the ZTNET→ZT move are corporate consolidations (same-day bulk moves of IPv4, ASN and IPv6 between related names), not market supply. DTAC TriNet → True Move H follows in October (3 blocks, 2 ASN). Jazzworld is the renamed Mobilink GSM (`changed-records.csv`), so the ARIN /19s went to an incumbent mobile operator. GCSA-20 held its blocks only since 2025-02/03 and has sourced 23 transfers (196,608 IPs) to APNIC across August–September (Bharti Airtel 8×/20, Jazzworld 14, Simba 1); inference: a broker or holding entity redistributing recently acquired LACNIC-range space.

## Flows

- Inbound: ARIN 18 transfers / 167,424 IPs; LACNIC 2 / 131,072; RIPE 4 / 29,184. Total 327,680.
- Outbound: 2 transfers / 1,280 IPs, both to ARIN (Vocus /22, a BD /24).
- Net gainers: HK +193,024 (ZT 57,088, LACNIC 131,072, rest small), PK +96,000, SG +66,048, ID +17,408, JP +6,144.
- Net losers: other RIRs −325,376, KH −56,064, AU −3,072.
- TH: 1,261,056 in, 1,259,008 out, net +2,048. All the TH volume is domestic reshuffling.

## Market structure

September market transfers by count: /22 15 (28.8%), /19 11 (21.2%), /23 8, /20 7, /16 3, /21 3, /18 2, /24 3. By IPs: three /16s = 52.5%, eleven /19s = 24.1%.

Note: the `market.txt` prefix distribution is all-history (11,102 transfers, 2010-11 onward), not the 13-month window. Against it: /22 share 28.8% vs 44.9%; /23–/24 21.2% vs 29.5%; /19–/20 34.6% vs 11.5% (the Jazzworld batch alone is 14 of 18). ≤/18 9.6% vs 8.8%. Small-block retail trade was thin; 10 of the 52 market transfers (30,208 IPs) are NIR sub-account moves (NIXI 5, IDNIC 2, JPNIC 2, KISA 1).

## Data quality

- Late registrations: 24 records dated 2026-08-20 to 08-28 (22 IPv4 = 45,824 IPs, 2 ASN). August's IPv4 total therefore rose by 22 transfers / 45,824 IPs since the previous run, including all three of its HRT records (768 IPs) and 8×/20 GCSA-20 → Bharti Airtel.
- Changed records: 65, all organisation renames; no economy, RIR or type changed. SYNTEL → TasmaNet (34 rows), NEXON → ACN 625 635 789 (7), Race Online Limited → Ltd. (6), Mobilink GSM → Jazzworld (6), Colt Co., Ltd. → GK (6), Vine Networks → Diverse Networks Group (4), NetComBB → PUERTO (1), Daun Penh punctuation (1).
- Removed: 0.
- Bulk entries: Triple T (17 resources), Jazzworld (14), ZT (9) are single-day batches but look like genuine deals, not administrative noise.
- `run-meta.txt`: `source_sha256` is 16 hex characters, not a full digest. Check the hashing step.

## Watch next month

1. Whether September gains late records the way August did (+22 IPv4); re-check the 1,692,672 figure.
2. Further GCSA-20 / 177–189/8 transfers into APNIC, and whether Simba or Jazzworld take more.
3. October True group consolidation (DTAC TriNet → True Move H already logged) and any further KH→HK re-domiciling.

