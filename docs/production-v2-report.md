# Production v2 Native Collection Report

Collection date: 2026-08-14. Native SMPP Collector v2 run: **Run 11**.

## Run identity and conditions

| Field | Value |
|---|---|
| source mode | `production_v2` |
| collector schema version | `v2` |
| expired inclusion | `Y` |
| page unit | 100 |
| search total at collection start | 51,045 |
| total pages | 511 |
| completed pages | 511 |
| failed pages | 0 |
| native occurrences | 51,045 |

The final page contained 45 rows (`source_row_no` 51001–51045).

## Integrity

| Check | Result |
|---|---:|
| occurrence count | 51,045 |
| distinct source row numbers | 51,045 |
| minimum / maximum row number | 1 / 51,045 |
| parser diagnostics | 0 |
| unmapped source certification code | 0 |
| missing raw JSON | 0 |
| foreign-key violations | 0 |

## Derived profile

- `is_unlimited=1`: 8,109
- `status_unknown=1`: 13
- current: 15,221
- historical: 35,811
- subject NULL: 1,367
- representative NULL: 23,023
- address NULL: 21,536
- start date NULL: 777
- end date NULL: 10
- candidate fingerprint NULL: 1,367

## Resume observation

The environment's foreground command limit interrupted the first execution after page 30, leaving page 31 `running`; its transaction had not committed. Run 11 resumed from page 31 correctly after the visible pagination-block traversal was fixed. The final run has two retry attempts from that pre-fix page-31 attempt, zero failed pages, and no partial page data.

No automatic entity, company, renewal, dedupe, or detailed-item operation was performed.
