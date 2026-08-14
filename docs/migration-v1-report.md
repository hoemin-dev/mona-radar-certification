# Migration v1 Report — Production Run 8

Migration date: 2026-08-14. Source: `collector/data/mona-radar-certification.sqlite`, Run 8 (`production_v1`). The migration opened the database normally, added tables only, and backfilled within one SQLite transaction.

## Result

| Check | Legacy records | Snapshot occurrences |
|---|---:|---:|
| count | 51,045 | 51,045 |
| distinct `source_row_no` | 51,045 | 51,045 |
| minimum `source_row_no` | 1 | 1 |
| maximum `source_row_no` | 51,045 | 51,045 |

The bidirectional `EXCEPT` comparison for page/row, type, number, company, subject/product, start date, and end date returned zero differences.

## Derived values

- `is_unlimited=1`: 8,109
- `status_unknown=1`: 13
- source certification code unmapped rows: 0
- source certification code distinct values: 21

## Multiplicity preservation

| Verification target | Expected | Actual |
|---|---:|---:|
| 공동상표 `2023001 / 코머신 / 무대장치` visible-identical occurrences | 27 | 27 |
| 산업융합품목 `제2020-693호` | 82 | 82 |
| NET `20-1411` | 68 | 68 |
| NET `53-067 / (주)지디티` | 10 | 10 |
| 우수조달공동상표 `2022009 / 펌프로` | 39 | 39 |

No legacy records were deleted, merged, or rewritten. A second migration run is idempotent: it detects the complete backfill, refreshes only derived source-code mapping, and performs the same integrity checks.
