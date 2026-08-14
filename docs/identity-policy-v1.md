# SMPP Certification Identity Policy v1

Policy version: `v1`. Default: preserve occurrences; do not auto-merge entities.

| Type | Source code | Identity semantics | Policy |
|---|---:|---|---|
| NET | 02 | a number may span multiple companies and technical subjects | number-only identity prohibited |
| 산업융합품목 | 11 | same number may span multiple companies and subjects | possible group/batch meaning is unresolved |
| 우수조달공동상표 | 09 | periods overlap and visible-identical occurrences exist | renewal auto-merge prohibited |
| all remaining mapped types | public UI mapping | semantics may differ by type | occurrence-only; no auto merge |

`candidate_fingerprint` uses C1: type + certification number + raw company name + certification subject name, hashed for indexing. It is a candidate clustering signal, not an entity identity, and has no UNIQUE constraint.

Entity links are only future `candidate`, `manual`, `accepted`, or `rejected` evidence in `certification_entity_matches`. This implementation creates no entities and no matches.
