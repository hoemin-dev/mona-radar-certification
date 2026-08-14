# SMPP 필드 카탈로그

조사일 2026-08-14의 공개 목록 표본 기준이다. `확인 불가`는 사이트에 없다고 단정하는 것이 아니라 이번 공개 화면/표본에서 증명하지 못했다는 뜻이다.

| canonical field name | Korean label | source location | list/detail | raw example | nullable | normalization |
| --- | --- | --- | --- | --- | --- | --- |
| `company_name` | 업체명 | 회사정보 셀 | list | `주식회사 닥터오레고닌` | no(관측) | 법인 표기/공백은 raw 보존 후 별도 정규화 |
| `business_registration_no` | 사업자등록번호 | 검색 입력만 확인 | 확인 불가 | 확인 불가 | yes | 하이픈 제거/암호화 여부는 확보 후 결정 |
| `company_identifier` | 기업 식별값 | 공개 결과 DOM | 확인 불가 | 확인 불가 | yes | 확보 전 생성 금지 |
| `representative_name` | 대표자 | 회사정보 셀 | list | `최선은` | yes | 복수 대표자 구분 보존 |
| `manufacturer_name` | 제조사/업체명 | 별도 제조사 필드 없음; 업체명 사용 가능 | list | `주식회사 닥터오레고닌` | yes | 제조사와 인증보유업체 동일성은 단정 금지 |
| `address_raw` | 주소 | 회사정보 셀 | list | 빈 문자열인 표본 다수 | yes | 시도/시군구/상세주소 분해는 값 존재 시 수행 |
| `product_name` | 인증제품명/기술명 | 인증정보 셀 | list | `국내 자생 오리나무 ... 소재 개발기술` | no(관측) | 공백 정리, 원문 보존 |
| `item_name` | 품명 | 별도 출력 없음 | 확인 불가 | 확인 불가 | yes | 임의로 product_name과 동일시 금지 |
| `detailed_item_name` | 세부품명 | 검색 선택 필드 존재, 결과 출력 미확인 | 확인 불가 | 확인 불가 | yes | 품목 분류명 원문 보존 |
| `detailed_item_code` | 세부품명번호 | 검색 선택 필드 존재, 결과 출력 미확인 | 확인 불가 | 확인 불가 | yes | 문자열 저장(선행 0 보존) |
| `certification_type` | 인증구분 | 인증구분 셀 | list | `NET` | no(관측) | 표시명과 코드(`02`) 모두 저장 |
| `certification_no` | 인증번호 | 인증정보 셀 | list | `32-216` | yes | 원문/공백 보존, 유형별 형식 검증 |
| `certification_start_date` | 인증일자 | 인증일자 셀 | list | `2026-07-27` | yes | ISO date |
| `certification_end_date` | 만료일자 | 만료일자 셀 | list | `2029-07-26` | yes | ISO date; `9999-12-31`은 무기한 sentinel |
| `is_currently_valid` | 현재 유효 여부 | 직접 필드 없음 | derived | 조사일이 기간 내인지 계산 | yes | 날짜+상태 원문으로 계산, 단정적 원문 필드와 구분 |
| `certification_status` | 인증 상태 | 별도 출력 없음 | 확인 불가 | 확인 불가 | yes | 유효/만료 derived 값과 원문 상태를 구분 |
| `historical_certification` | 과거 인증 이력 | `searchOverDateYn=Y` 결과 집합 | list/derived | 만료일이 수집일 이전 | yes | 수집일 기준으로 계산 |
| `detail_url` | 상세페이지 URL | 상세 함수만 존재, 행 링크 없음 | 확인 불가 | `SelectTdPrdVw.do` (POST target only) | yes | GET URL로 조작 금지 |
| `source_seq_no` | 내부 식별값 | 상세 함수 인자 설계만 확인 | 확인 불가 | 확인 불가 | yes | 문자열 저장 |
| `source_certification_code` | 인증구분 내부 코드 | 검색 checkbox / 상세 함수 인자 | list/search | `02` (NET) | no | 코드와 화면 label 매핑 버전 관리 |
| `image_url` | 제품사진 | 이미지 src | list | `/images/camera.gif` (placeholder) | yes | placeholder 여부 별도 flag |
| `collected_at` | 수집시각 | Collector 생성 | derived | ISO timestamp | no | UTC 저장 권장 |
| `source_page_no` | 수집 페이지 | Collector 생성 | derived | `2` | no | POST 요청 pageIndex 기준 |

## 목록/상세 요약

| field | list page | detail page | notes |
| --- | --- | --- | --- |
| `company_name` | yes | 확인 불가 | 업체명 label 포함 |
| `product_name` | yes | 확인 불가 | 유형에 따라 제품명보다 기술명에 가까울 수 있음 |
| `certification_type` | yes | 확인 불가 | 화면 label + 검색 코드 매핑 가능 |
| `certification_no` | yes | 확인 불가 | 복합 셀에서 분리 |
| `certification_start_date` | yes | 확인 불가 | 전용 열 |
| `certification_end_date` | yes | 확인 불가 | 전용 열 |
| `detailed_item_name` | no | 확인 불가 | 검색조건에는 존재 |
| `detailed_item_code` | no | 확인 불가 | 검색조건에는 존재 |
| `business_registration_no` | no | 확인 불가 | 검색조건에는 존재 |
| `address_raw` | yes, nullable | 확인 불가 | 빈 값 관측 |
| `certification_status` | no | 확인 불가 | 날짜 기반 파생 가능 |
| `source_seq_no` | no | 확인 불가 | 상세 함수 정의에만 존재 |

성능인증, NEP, NET, 우수조달물품, GS와 기타 기술개발제품 유형은 모두 인증구분 checkbox 및 코드로 확인했다. 과거 인증은 별도 이력 테이블이 화면에 출력되는 방식이 아니라 `인증기간 만료업체 포함` 검색 결과에 섞이는 방식이므로, 동일 자연키의 시간별 스냅샷을 보존해야 한다.

