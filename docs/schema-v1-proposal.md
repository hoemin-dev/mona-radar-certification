# Production Schema v1 Proposal

이 문서는 migration이 아닌 제안이다. 핵심은 snapshot occurrence를 보존하면서 불확실한 entity matching을 별도 계층으로 격리하는 것이다.

## 1. collection_runs / collection_run_pages / diagnostics

현재 구조를 유지한다. run identity에는 source URL, mode, page unit, 검색조건, 기준 전체 건수를 포함한다. 페이지 transaction/checkpoint는 이미 production에서 검증됐다. `collection_run_pages(run_id,status,page_no)`와 diagnostics의 `(run_id,event)` index를 추가 후보로 둔다.

## 2. certification_snapshots

현재 `certification_records`를 의미상 snapshot occurrence로 명명한다.

- PK: surrogate `id`.
- FK: `run_id -> collection_runs`.
- run-local unique: `(run_id, source_row_no)` 또는 현재 `(run_id,source_page_no,source_row_no)`.
- raw: `raw_json`, raw certification/company/date strings.
- normalized: 기계적 공백 정리 값, 원문과 별도 column.
- derived: `is_unlimited`, `lifecycle_status(valid/historical/unknown)`, 계산 기준일과 rule version.
- index: `(run_id,certification_type,certification_no)`, `(run_id,company_name)`, `(run_id,lifecycle_status)`.

완전히 동일해 보이는 행도 삭제하지 않는다. 목록에 없는 차원을 표현할 가능성이 있다.

## 3. certification_entities

반복 snapshot 간 동일성을 승인한 뒤에만 사용한다.

- PK: 내부 UUID/BIGINT `id`.
- stable natural unique: 현재는 **없음**.
- fields: canonical type/no/company/product를 강제 저장하기보다 entity 상태와 생성 근거, 최초/최종 관측 run을 저장.
- unique constraint로 A~D를 사용하지 않는다.

## 4. certification_entity_matches

snapshot과 entity의 불확실한 연결을 표현한다.

- PK: `(snapshot_id,entity_id)` 또는 surrogate.
- FK: snapshot/entity.
- `match_method`, `rule_version`, `confidence`, `evidence_json`, `review_status`.
- C 기반 fingerprint는 후보 생성용 index이며 identity 보장이 아니다.

이 테이블을 두면 natural key 규칙을 개선해도 raw snapshot을 재작성할 필요가 없다.

## 5. company_references

Certification 내부 company name과 MonaRadar Company entity의 연결 후보만 저장한다.

- raw/normalized company name.
- external company ID nullable.
- match evidence/confidence/status.
- 이름만 일치하는 경우 자동 확정 금지.

Certification을 Company master로 사용하거나 회사명을 직접 FK로 사용하지 않는다.

## Snapshot/Entity 분리 판단

**필요하다.** 같은 번호/업체에서 기간·제품이 여러 개인 그룹과 완전 동일 목록행 중복이 동시에 존재한다. 반복 수집에서는 snapshot 간 신규/소멸/기간 변경을 먼저 관측하고, entity matching은 별도 버전 규칙으로 수행해야 한다.

권장 변화 탐지 이벤트:

- appeared/disappeared
- certification period changed
- product/company raw or normalized name changed
- lifecycle status changed
- identity match created/revoked

## Search 개발 전 해결할 문제

1. `certification_no`에 품명과 줄바꿈이 포함된 사례의 raw 구조 분리 여부.
2. C fingerprint 충돌 6,361그룹을 표현할 UI/검색 결과 occurrence 모델.
3. 시작/종료일 NULL 13건의 unknown 상태 표시.
4. sentinel을 일반 날짜 정렬에서 분리하는 정책.
5. 회사명 normalized 검색과 entity 확정 매칭의 명확한 구분.
6. 상세페이지나 다른 공개 source에서 stable source ID/세부품명/사업자번호를 얻을 수 있는지 별도 조사.
7. 다음 production snapshot을 수집해 appeared/disappeared/change 규칙을 실증할 것.

