# Source-Observation Change Model v1 Proposal

The following labels describe SMPP snapshot observations only. They must not be rendered as legal certification lifecycle events without additional evidence.

| Change status | Meaning |
|---|---|
| `observed_unchanged` | exact visible signature multiset count is unchanged |
| `observed_new` | candidate/visible occurrence appears only in the current snapshot |
| `observed_removed` | candidate/visible occurrence appears only in the baseline snapshot |
| `observed_changed` | a shared candidate cluster has a different visible signature/period distribution |
| `ambiguous` | collision or visible-identical multiplicity prevents a simple interpretation |

Recommended user-facing phrasing is “observed in this snapshot”, “not observed in the current snapshot”, and “source display changed”. Do not translate these automatically to “new certification”, “expired”, “renewed”, or “deleted”.

Comparison requirements:

1. never match snapshots by `source_row_no` across runs;
2. compare exact visible values as a multiset, not a set;
3. use C1 only as a provisional candidate cluster;
4. retain C1-NULL occurrences in a separate raw-signature bucket;
5. retain occurrence-count changes as evidence, not entity decisions;
6. distinguish collector/parser differences from source observation differences.
