# Collision Semantics Investigation (5B)

조사일: 2026-08-14. Production Run 8의 51,045개 `certification_records`를 SQLite read-only 모드로 분석했다. Production DB, Collector, schema는 변경하지 않았다. 여기서 collision은 삭제 대상이 아니라 같은 인증번호 아래 관측된 복수 의미의 구조다.

## 1. Collision TYPE_1~TYPE_4 전체 통계

네 유형은 서로 배타적이지 않다. 각 단계에서 복수성이 나타나는 축을 독립적으로 센다.

| type | 정의 | group 수 | 관련 row 수 | 최대 group |
|---|---|---:|---:|---:|
| TYPE_1 | 같은 type/no, 다른 company | 1,569 | 5,172 | 82 |
| TYPE_2 | 같은 type/no/company, 다른 product | 1,375 | 3,740 | 10 |
| TYPE_3 | 같은 type/no/company/product, 다른 period | 2,249 | 7,518 | 39 |
| TYPE_4 | visible 6개 필드가 동일한 복수 occurrence | 5,980 | 14,266 | 27 |

TYPE_4의 `14,266`은 중복 제거 가능 건수가 아니라 동일하게 보이는 occurrence 수다. source-native ID가 없으므로 source duplicate와 semantic multiplicity를 분리할 수 없다.

## 2. 인증유형별 collision 차이

비율의 분모는 TYPE_1=`type/no group`, TYPE_2=`type/no/company group`, TYPE_3=`type/no/company/product group`, TYPE_4=`visible group`이다.

| 인증유형 | rows | TYPE_1 | TYPE_2 | TYPE_3 | TYPE_4 |
|---|---:|---:|---:|---:|---:|
| 녹색기술제품 | 9,032 | 115/3,985 (2.9%) | 35/4,100 (0.9%) | 435/4,135 (10.5%) | 2,965/4,570 (64.9%) |
| GS | 8,395 | 738/7,327 (10.1%) | 50/8,295 (0.6%) | 2/8,345 (<0.1%) | 43/8,347 (0.5%) |
| 우수조달물품 | 7,648 | 149/3,755 (4.0%) | 105/3,909 (2.7%) | 1,250/4,014 (31.1%) | 1,787/5,626 (31.8%) |
| 성능인증 | 5,945 | 20/5,312 (0.4%) | 157/5,332 (2.9%) | 46/5,520 (0.8%) | 268/5,566 (4.8%) |
| NET | 5,316 | 490/2,539 (19.3%) | 815/3,364 (24.2%) | 207/4,233 (4.9%) | 612/4,449 (13.8%) |
| 우수조달공동상표 | 1,493 | 6/988 (0.6%) | 30/998 (3.0%) | 175/1,056 (16.6%) | 44/1,287 (3.4%) |
| 산업융합품목 | 955 | 7/484 (1.4%) | 71/860 (8.3%) | 0/955 | 0/955 |
| NEP | 733 | 12/520 (2.3%) | 67/533 (12.6%) | 32/611 (5.2%) | 88/643 (13.7%) |

결론은 유형별 rule이 필요하다는 것이다. NET은 번호가 업체·기술을 묶는 상위 단위처럼 나타나는 비율이 높고, 우수조달물품은 기간 occurrence가 많다. 녹색기술제품 TYPE_4 비율은 source-native ID 없이 자동 dedupe하면 특히 위험하다.

## 3. 산업융합품목 `제2020-693호`

- 82 rows, 60개 업체, 82개 제품, 기간은 전부 `2021-01-01 ~ 9999-12-31`.
- 완전 동일 visible group은 0개다.
- 한 업체가 여러 제품을 가진 사례가 있다: `(주)레존텍` 5개, `(주)레이데코` 4개, `(주)에이티이엔지`·`(주)티디엘` 각 3개.
- 번호 하나가 60개 독립 업체·82개 상이한 제품에 걸쳐 있으므로 단일 업체 제품 인증 identity라는 해석은 기각된다(CONFIRMED).
- 공식 group/batch identity인지 source의 공통 번호 재사용인지 공개 설명 근거가 없어 UNRESOLVED다.

## 4. NET `20-1411`

- 68 rows, 17개 업체, 18개 product 값(NULL 포함), 두 종료일(`2015-11-24`, `2016-11-24`). 시작일은 모두 `2014-11-25`.
- 각 업체는 정확히 4개 occurrence: 기술명 1개와 product NULL 3개. NULL 3개는 visible-identical이다.
- 업체마다 서로 다른 기술명이 연결된다. `20-1411`은 단일 제품/업체 identity가 아니라 다수 적용 업체·기술을 묶는 번호처럼 동작한다(STRONGLY_SUPPORTED).
- NULL 행 3개가 진짜 source duplicate인지 숨은 분류/관계 occurrence인지는 UNRESOLVED다.

## 5. NET `53-067` / `(주)지디티`

- 10 rows, 4개 product 값(NULL 포함), 3개 기간.
- NULL product: `2018-12-20~2020-12-19` 3회, `2020-12-20~2021-12-19` 3회.
- 기술명 표기 변형 3종: `마이크로 나노버블...제조 기술`, 띄어쓰기 없는 `...제조기술`, `마이크로나노...제조장치 개발`.
- `2018-12-20~2020-12-19` 다음 `2020-12-20~2021-12-19`은 하루 연속이므로 `renewal_candidate`다. 자동 renewal 확정은 하지 않는다.
- 한 기술명은 `2018-12-20~2021-12-19`로 두 기간을 가로지른다. 단순 기간별 entity 병합도 안전하지 않다.

## 6. 우수조달공동상표 `2022009`

- Run 8의 해당 type/no는 39 rows, 업체 `펌프로` 1개, 제품 `수중펌프` 1개, 시작일 7개다.
- occurrence: `2022-12-22` 11회, `2023-04-04` 15회, `2023-07-25` 8회, `2023-11-28` 1회, `2024-07-30` 1회, `2024-11-25` 2회, `2025-08-04` 1회.
- 앞 세 기간의 종료일은 모두 `2028-12-21`; 뒤 네 기간은 `2025-12-21`이다. 시작일이 다수 중첩되므로 단순 renewal 연쇄가 아니다(CONFIRMED).
- 동일 visible row의 최대 15회 출현은 숨은 관계와 source duplicate 가능성을 모두 남긴다. 공개 목록만으로는 UNRESOLVED다.
- 공개 화면에서 인증번호 `2022009`만 검색하면 인증유형을 가로질러 전체 78개가 반환됐다. 인증번호는 전역 unique가 아님이 CONFIRMED됐다.

## 7. Visible-identical occurrence 위험

TYPE_4 최대 사례는 우수조달공동상표 `2023001 / 코머신 / 무대장치 / 2023-08-31~2026-08-30` 27회다. 다음은 `2022009 / 펌프로 / 수중펌프 / 2023-04-04~2028-12-21` 15회다.

유형별 TYPE_4 occurrence rows는 녹색기술제품 7,427, 우수조달물품 3,809, NET 1,479, 성능인증 647, 우수조달공동상표 250 등이다. 같은 HTML 값은 source occurrence가 동일하다는 증거가 아니므로 삭제·병합하지 않는다.

## 8. 기간 관계

동일 `type/no/company/product` 안에서 중복을 제거한 기간들의 모든 쌍을 비교했다.

| relation | pair 수 | 해석 |
|---|---:|---|
| overlap | 3,074 | 병행 occurrence 또는 범위 중첩 |
| contiguous | 93 | `end + 1일 = next start`; renewal 후보 |
| gap | 12 | 비연속 이력 후보 |
| unknown | 6 | NULL 또는 `9999-12-31` 포함 |
| same_period | 0 | 고유 기간을 먼저 만들었으므로 0 |

`contiguous`는 `renewal_candidate`일 뿐 renewal 확정이 아니다. `9999-12-31`은 무기한 sentinel로 별도 처리했다.

## 9. 세부품명 filter로 확인한 관계

공개 popup에서 `수중펌프`는 세부품명번호 `4015151301`로 확인됐다(CONFIRMED). 그러나 이 분류와 인증번호 `2022009`, 만료 포함 조건을 함께 검색한 결과는 0개였다. 같은 시점에 인증번호만 검색하면 유형 혼합 78개가 조회됐다.

이는 popup의 기준연도(2026) 분류 filter가 과거 snapshot의 product text와 항상 연결되지 않음을 보여준다. `수중펌프` 문자열 일치만으로 `펌프로/2022009`의 각 occurrence에 code를 배정하면 안 된다. 현재 증거는 `CERTIFICATION_FILTER_RELATION`조차 불성립한 사례이며 `ROW_RELATION`은 확인되지 않았다.

## 10. 인증과 세부품명의 다대다 가능성

5A의 `석회질비료` 사례에서는 한 filter가 인증을 포함하는 `CERTIFICATION_FILTER_RELATION`을 확인했다. 5B의 수중펌프 사례는 text 일치에도 filter 관계가 성립하지 않았다. 세부품명은 snapshot scalar가 아니라 기준연도·검색조건·관측시점을 포함한 별도 evidence 관계가 적절하다(STRONGLY_SUPPORTED). 인증 하나 대 세부품명 여러 개, 세부품명 하나 대 인증 occurrence 여러 개 모두 허용해야 한다.

## 11. 인증과 업체의 다대다 가능성

- 산업융합품목 `제2020-693호`: 60개 업체(CONFIRMED).
- NET `20-1411`: 17개 업체(CONFIRMED).
- 우수조달공동상표 `2022009`: 해당 유형에서는 1개 업체지만 동일 번호가 다른 인증유형 결과에도 존재(CONFIRMED).

다만 “공동상표 참여업체” 같은 공식 역할은 SMPP 공개 설명/숨은 ID로 확인하지 못했다. 업체 역할명은 추정하지 않는다.

## 12. `product_name`의 실제 의미 차이

- NET: 대부분 기술명 또는 적용기술 설명.
- GS: 소프트웨어명·버전.
- NEP·성능인증·우수조달물품·산업융합품목: 제품/장치/시스템명이 중심.
- 녹색기술제품: 제품명과 기술 설명이 혼재.
- 우수조달공동상표: 공동상표 대상 품목에 가까움.

현재 컬럼명을 즉시 바꾸지는 않되 v2 conceptual model에서는 중립적인 `certification_subject_name`을 권장한다.

## 13. Source Duplicate / Semantic Multiplicity / Unresolved

- **Semantic Multiplicity (CONFIRMED)**: 같은 type/no 아래 복수 업체·제품·기간이 실제로 존재.
- **Source Duplicate (미확정)**: 동일 visible occurrence가 여러 번 있지만 source ID/숨은 관계가 없어 진짜 중복 노출임을 증명하지 못함.
- **UNRESOLVED_MULTIPLICITY**: 모든 TYPE_4와 숨은 참여 역할·분류 관계를 설명할 수 없는 행.

자동 dedupe는 금지한다.

## 14. Snapshot occurrence 추천 정의

`SMPP 검색 결과에서 특정 collection run과 source row position에 관측된 하나의 목록 occurrence`로 정의한다. 이는 인증 하나, 제품 하나, 업체 하나 또는 source entity 하나와 동치가 아니다.

## 15. 추천 Certification conceptual model

1. `Certification`: 유형·번호 중심의 상위 후보 cluster.
2. `CertificationSubject`: source가 product 영역에 표시한 기술/제품/소프트웨어/품목.
3. `CertificationCompanyRelation`: 인증·subject와 업체 사이의 역할 미확정 관계.
4. `CertificationPeriod`: occurrence별 유효기간과 lifecycle 후보.
5. `CertificationDetailedItemEvidence`: 기준연도·filter·관측시점·evidence level을 가진 분류 관계.
6. `CertificationSnapshotOccurrence`: 원본 행과 source position을 보존하는 불변 관측값.

이는 구현안이 아니라 5C 설계 입력이다.

## 16. 기존 C fingerprint 적합성

기존 C(`type + no + company + product`)는 후보 clustering에는 유용하지만 identity/UNIQUE key로 부적합하다. TYPE_3 2,249그룹은 C가 여러 기간을 합치고, TYPE_4 5,980그룹은 C에 기간을 더해도 occurrence가 구분되지 않음을 보여준다. **PROVISIONAL candidate fingerprint로만 유지**한다.

## 17. 5C IMPLEMENT

- `source_certification_code` 매핑과 원문 보존.
- `is_unlimited`, `status_unknown`의 명시적 lifecycle 표현.
- snapshot occurrence를 entity와 분리하는 모델·명칭.
- identity candidate에 `rule_version`, `confidence`, 승인 상태 추가.
- 세부품명은 scalar가 아닌 evidence relation 후보로 설계.
- 인증유형별 identity policy를 허용하는 구조.

## 18. 5C HOLD

- automatic renewal merge.
- automatic company identity 또는 역할 부여.
- automatic detailed-item row mapping.
- visible-identical occurrence 삭제.
- C fingerprint UNIQUE 적용.
- Production DB migration/재수집.

## 19. MonaRadar Cross-Learning

- duplicate-looking row와 source duplicate를 구분한다.
- source 번호 하나가 business entity 하나라는 가정을 금지한다.
- many-to-many 가능성을 scalar 저장 전에 검증한다.
- source row는 사실이 아니라 관측 occurrence일 수 있다.
- dedupe 전에 source semantics와 유형별 lifecycle을 조사한다.
- filter relation과 row relation을 분리한다.

## Evidence 등급과 재현

- `CONFIRMED`: Run 8 원문/집계 또는 공개 UI에서 직접 재현.
- `STRONGLY_SUPPORTED`: 여러 직접 관측이 같은 해석을 지지하지만 공식 역할명은 없음.
- `LIKELY`: 구조상 가능성이 높으나 대안 설명이 남음.
- `UNRESOLVED`: 공개 source로 구분 불가.

집계 도구: `tools/collision-investigation/analyze.ts`. 전체 재현 결과: `tools/collision-investigation/results-run-8.json`. JSON에는 대표 네 사례의 원본 DB row와 `raw_json`이 포함된다.
