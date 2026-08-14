# Schema v1 Implemented — Snapshot Occurrence Model

Implemented 2026-08-14. The migration is additive: legacy `certification_records`, collection runs, page checkpoints, and diagnostics remain intact. Production Run 8 keeps `collector_schema_version = v1`; newly collected occurrence runs use `v2`.

## Core table

`certification_snapshot_occurrences` stores one SMPP result-list occurrence observed at a `run_id + source_page_no + source_row_no` position. Its run-local position unique constraint is a completeness guard, not a permanent source identity.

It preserves:

- raw: company, representative, address, start/end date strings, `raw_json`;
- normalized: company and certification subject search values;
- derived: `is_unlimited`, `status_class`, `status_unknown`, source certification code;
- candidate-only clustering: SHA-256 `candidate_fingerprint`, rule `C1`.

`certification_subject_name` is the canonical replacement for the ambiguous legacy `product_name`. The legacy column remains untouched for backward compatibility.

## Status model

Method A is implemented.

- `status_class`: `current`, `historical`, or `unknown`.
- `is_unlimited`: independent boolean, true only when raw end date is `9999-12-31`.
- unlimited occurrences are `current` plus `is_unlimited=1`; the sentinel is never treated as an ordinary far-future date.
- rows without enough date information use `status_class='unknown'` and `status_unknown=1`.

## Supporting tables

| Table | Purpose | Automatic identity action |
|---|---|---|
| `source_certification_code_mappings` | public SMPP type-label/code mapping, versioned | none |
| `certification_identity_policies` | type-specific identity metadata | `auto_merge_allowed=0` |
| `certification_entities` | future internal entity concept | no backfilled entities |
| `certification_entity_matches` | candidate/manual links from occurrences | no accepted auto matches |
| `certification_company_relations` | company relation evidence with nullable role | no inferred role |
| `certification_subjects` | optional future subject entity | no automatic merge |
| `certification_periods` | optional period evidence | no renewal merge |
| `certification_detailed_item_evidence` | filter/popup/manual classification evidence | no automatic row assignment |

No UNIQUE constraint exists for type/no, type/no/company/subject, candidate fingerprint, company normalization, or detailed-item relation.

## Mapping and policy

The source mapping contains all 21 SMPP public source codes. Two display-label aliases are retained for `우수산업디자인(GD)` and `재난안전제품인증`, so all Run 8 rows receive a source code. Mappings have version `SMPP_UI_2026-08-14`; identity policies have version `v1` and prohibit auto merge.

## Indexes

Search-oriented indexes cover run/type/code/no, normalized company, subject, temporal status, and candidate fingerprint. They do not change identity semantics.

## Collector v2 behavior

Within the existing page transaction, Collector v2 writes both the backward-compatible legacy record and the occurrence record. If page commit fails, both inserts roll back with the page checkpoint update. New runs are distinguished by source mode (`production_v2` or `smpp_tdprd_occurrence_v2`) and `collector_schema_version='v2'`.
