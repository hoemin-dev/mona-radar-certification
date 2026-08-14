# Snapshot Comparison v1 — Run 8 vs Native Run 11

Baseline: Run 8 (`production_v1` backfilled into occurrence schema). Current: Run 11 (`production_v2` native occurrence collection). This is an observation comparison, not an entity or legal-status change detector.

## Level A: snapshot profile

Both runs have 51,045 rows, 17,444 raw companies, 35,082 certification numbers, 30,112 subjects, 8,109 unlimited rows, 13 unknown rows, and identical type/code distributions and NULL counts.

The only profile change is `current +2` / `historical -2`, explained by the two changed source observations below.

## Level B: exact visible signature multiset

Signature fields:

```text
certification_type
certification_no
company_name_raw
certification_subject_name
certification_start_date_raw
certification_end_date_raw
```

The comparison is a multiset comparison, so repeated occurrences remain counted.

| Metric | Result |
|---|---:|
| signature groups, Run 8 | 42,759 |
| signature groups, Run 11 | 42,759 |
| exact unchanged occurrences | 51,043 |
| added observations | 2 |
| removed observations | 2 |
| signature groups whose count changed | 0 |

Removed observations:

- 성능인증 `23-AAD0277 / 표면세척기`, 주식회사 가온텍, `2023-08-11 ~ 2026-08-10`
- 성능인증 `24-BAD0103 / 제진기`, (주)나성이엔지, `2023-06-20 ~ 2026-06-19`

Added observations:

- 성능인증 `26-CAD0219 / 표면세척기`, 주식회사 가온텍, `2026-08-11 ~ 2030-08-10`
- 성능인증 `26-CAD0220 / 제진기`, (주)나성이엔지, `2026-06-20 ~ 2030-06-19`

These are recorded as `ADDED_CANDIDATE` and `REMOVED_CANDIDATE`; they are not automatically labelled renewal, new certification, deletion, or entity replacement.

## Level C: C1 candidate comparison

| Classification | Count |
|---|---:|
| unchanged candidate | 39,242 |
| added candidate | 2 |
| removed candidate | 2 |
| changed-like candidate | 0 |
| candidate with ambiguous multiplicity | 5,390 |
| candidate with occurrence-count change | 0 |
| candidate with period-distribution change | 0 |
| type/no/company subject-change candidate | 0 |
| no C1 fingerprint, Run 8 / Run 11 | 1,367 / 1,367 |

The 5,390 ambiguity count is an existing multiplicity property of C1 clusters, not a claim that 5,390 changes occurred.

## Parser equivalence

Run 8 legacy `product_name` was backfilled directly to `certification_subject_name`; Run 11 v2 parses that same source display region as its canonical subject field. Type counts, source-code counts, raw date representation, company names, subject NULL count, and exact multiset comparison show no parser-version-only diff.

## Decision

The method is valid for conservative snapshot observation:

- prior occurrence observed again;
- newly observed occurrence candidate;
- previously observed occurrence absent from current snapshot;
- visible source observation changed;
- ambiguity due to multiplicity.

It is not sufficient to infer business events or identities. Full machine-readable output: `tools/snapshot-comparison/run-8-vs-11.json`.
