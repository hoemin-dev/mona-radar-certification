# Production v1 Data Profile

기준: SQLite `collector/data/mona-radar-certification.sqlite`, production run 8, 2026-08-14, 51,045행. 이 문서는 읽기 전용 분석 결과이며 데이터나 schema를 변경하지 않았다.

## 실제 DB 구조

- `collection_runs`: run 조건, 상태, 전체 건수, 마지막 완료 페이지, 누적 건수, retry. PK `id`.
- `collection_run_pages`: 페이지별 상태/건수/No 범위/시간. PK `id`, UNIQUE `(run_id,page_no)`.
- `certification_records`: run snapshot의 목록 행. PK `id`, UNIQUE `(run_id,source_page_no,source_row_no)`.
- `collection_diagnostics`: run과 source row의 실패 원문. PK `id`.
- 세 하위 테이블의 `run_id`는 `collection_runs.id`를 참조하며 cascade는 없다.
- 명시적인 업무 index는 없고 UNIQUE 제약이 만든 SQLite auto-index만 존재한다.

## 필드 프로파일

| field | count | NULL | empty | distinct | length min/max |
|---|---:|---:|---:|---:|---:|
| certification_type | 51,045 | 0 | 0 | 21 | 2/12 |
| certification_no | 51,045 | 0 | 0 | 35,082 | 1/39 |
| product_name | 51,045 | 1,367 | 0 | 30,112 | 1/282 |
| company_name | 51,045 | 0 | 0 | 17,444 | 1/50 |
| representative_name | 51,045 | 23,023 | 0 | 9,735 | 2/30 |
| address_raw | 51,045 | 21,536 | 0 | 15,536 | 1/129 |
| certification_start_date | 51,045 | 777 | 0 | 3,979 | 10/10 |
| certification_end_date | 51,045 | 10 | 0 | 4,025 | 10/10 |
| source_row_no | 51,045 | 0 | 0 | 51,045 | 1/5 |

Parser가 공백값을 NULL로 정리했기 때문에 저장된 empty string은 0이다. `source_row_no`의 유일성은 run 8의 완전성 검증 결과일 뿐 영구 identity가 아니다.

## 인증유형별 주요 품질 패턴

- 제품명 NULL 1,367건 중 NET 1,346건, GS 18건, 우수조달물품 3건이다.
- 녹색기술제품 9,032건은 대표자와 주소가 모두 NULL이다.
- GS는 대표자 7,536건, 주소 7,559건이 NULL이며 종료일 sentinel 8,109건이 집중되어 있다.
- 우수연구개발혁신제품은 대표자 1,453/1,454건이 NULL이다.
- 혁신시제품은 대표자 893/894건, 기타혁신제품은 579/579건이 NULL이다.
- NET는 대표자 1,556건, 주소 3,176건, 시작일 6건, 종료일 9건이 NULL이다.
- 시작일 NULL은 우수산업디자인(GD) 575건, 중소기업융복합기술개발 189건에 집중된다.
- 인증번호와 업체명은 모든 유형에서 NULL/empty 0건이다.

전체 상태는 historical 35,813건, currently valid 15,219건이다.

## `9999-12-31`

- 8,109건 전부 GS이다.
- 그중 시작일 NULL 6건, 제품명 NULL 18건이다.
- 같은 `(certification_type, certification_no)`에 일반 종료일과 sentinel이 함께 나타나는 번호 그룹은 51개다.
- 사이트 안내가 유효기간 미정 인증을 `9999-12-31`로 표시한다고 명시하고, 한 유형에 집중된 점도 실제 달력 종료일이 아님을 뒷받침한다.

따라서 raw 종료일은 그대로 보존하되 `is_unlimited=true`를 별도 derived 값으로 유지하는 것이 타당하다. sentinel과 일반 종료일이 같은 번호에서 함께 보인다는 사실 때문에 번호 단위로 무기한 상태를 전파하면 안 된다.

## Historical/current 어느 쪽도 아닌 13건

| 원인 | 건수 |
|---|---:|
| start/end 모두 NULL | 4 |
| end만 NULL | 6 |
| start만 NULL | 3 |

12건은 NET이며, 1건은 우수조달물품이다. 날짜 parsing 형식 오류가 아니라 원천 날짜 부재다. 예로 NET `제276호` 3개 업체는 시작일 `2022-09-30`, 종료일 NULL이고, NET `건설-947/948`은 시작일 NULL, 종료일 `2030-11-10`이다. 상태는 `unknown`으로 유지해야 한다.

## 데이터 품질 결론

NULL 패턴은 유형 의존적이다. 전역 NOT NULL 규칙이나 대표자/주소를 이용한 identity는 부적절하다. raw/normalized/derived 값을 분리하고 상태 계산에는 `valid`, `historical`, `unlimited`, `unknown`을 구분해야 한다.

