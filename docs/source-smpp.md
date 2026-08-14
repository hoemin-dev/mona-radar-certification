# SMPP 기술개발제품 소스 조사

## 대상과 접근

- 기준 URL: `https://www.smpp.go.kr/prd/prdinfo/tdprd/SelectTdPrdListVw.do`
- 조사일: 2026-08-14 (KST)
- 접근: 공개 웹 화면, 비로그인 상태
- 로그인: 목록 조회와 검색에는 불필요
- 조사 범위: DOM, 페이지 내 JavaScript, 실제 검색/페이지 이동 결과. 로그인·보안 우회 및 대량 수집은 수행하지 않음.

페이지 안내문은 12종 기술개발제품 인증정보를 제공한다고 설명한다. 화면에는 자동연계되지 않은 인증이 분기/반기 단위로 갱신되어 일부 업체/인증이 빠질 수 있다는 주의문도 있다.

## 검색 UI 구조

검색은 `searchForm`을 같은 경로로 제출하는 **POST** 방식이다. 결과 URL에는 검색조건이 노출되지 않는다.

| UI | DOM / parameter | 비고 |
| --- | --- | --- |
| 인증구분 | `input[type=checkbox][name=searchCrtfcSeCode]` | 복수 값 POST |
| 인증제품명 | `searchCrtfcTechNm` | 텍스트 |
| 인증번호 | `searchCrtfcNo` | 텍스트 |
| 사업자등록번호 | `searchBsnmNo` | 텍스트 |
| 업체명 | `searchEntrpsNm` | 텍스트 |
| 대표자명 | `searchrprsntvNm` | 텍스트 |
| 세부품명번호 | `searchDetailPrdnmNo` | readonly, 별도 검색 버튼/팝업으로 선택 |
| 세부품명 | `searchDetailPrdnm` | readonly, 세부품명번호 선택의 콜백 값 |
| 만료업체 포함 | `searchOverDateYn=Y` | checkbox, MONA 기본값으로 활성화 필요 |
| e-카탈로그 | `searchCatalogYn=Y` | checkbox |
| 주소 | `ctprvnCode`, `signguCode` 및 표시명 hidden 값 | 시도/시군구 select |
| 인증정보 통합검색 | 오탈자가 포함된 `searhcPrdnm` | 세부품명/인증제품명 검색 UI |
| 페이지 | `pageIndex` | POST, `fn_getList(pageNo)`가 설정 |
| 페이지 크기 | `pageUnit` | 15/30/50/100 |

인증구분의 실제 코드 매핑은 다음과 같다.

| label | value |
| --- | --- |
| 성능인증 | `05` |
| 우수조달물품 | `04` |
| NEP | `01` |
| GS | `03` |
| NET | `02` |
| 우수조달공동상표 | `09` |
| 물산업우수제품 등 지정 | `29` |
| 우수연구개발혁신제품 | `28` |
| 혁신시제품 | `30` |
| 기타혁신제품 | `31` |
| 녹색기술제품 | `08` |
| 산업융합신제품적합성인증 | `15` |
| 산업융합품목 | `11` |
| 구매조건부신기술개발 | `07` |
| 민관공동투자기술개발 | `10` |
| 성과공유기술개발 | `12` |
| 재난안전제품인증 | `32` |
| 우수산업디자인(GD) | `16` |
| ICT융합품질인증 | `13` |
| 중소기업융복합기술개발 | `14` |
| 공공기관 개발선정품 | `27` |

페이지 상단 설명표의 현행 12종은 NET, NEP, 혁신제품, 수요처 지정형 기술개발제품, 녹색기술제품, 물산업우수제품, GS(1등급), 산업융합품목, 성능인증, 우수조달물품, 우수조달공동상표, 재난안전제품이다. 검색 UI에는 일몰/과거 유형도 별도 checkbox로 남아 있으므로 코드와 표시명을 원문 그대로 저장해야 한다.

## `기술개발제품` 선택과 만료업체 포함

이 URL 자체가 좌측 메뉴 `04. 기술개발제품`의 전용 검색 화면이다. 조사한 공개 DOM에는 결과 포함 여부를 바꾸는 별도의 단일 `기술개발제품` checkbox/button은 없었다. 결과 범위를 바꾸는 실제 선택 상태는 (1) 인증구분 checkbox들과 (2) `인증기간 만료업체 포함` checkbox이다. 따라서 “기술개발제품을 직접 클릭해야 포함”이라는 표현이 메뉴 진입을 뜻하는지 다른 화면의 상태를 뜻하는지는 이 기준 URL에서는 추가 확인 불가하다.

`인증기간 만료업체 포함`은 실제 `<input type="checkbox" id="searchOverDateYn" name="searchOverDateYn" value="Y">`이다. hidden/JS-only 상태가 아니다. 체크되면 POST body에 `searchOverDateYn=Y`가 추가된다.

실측 결과:

| 상태 | 결과 수 |
| --- | ---: |
| 기본, 만료 미포함 | 15,229 |
| 만료 포함 (`searchOverDateYn=Y`) | 51,045 |

차이는 35,816건이며, 만료 포함 시 약 3.35배이다. 결과 수는 조사 시점의 스냅샷이므로 운영 데이터 갱신에 따라 변할 수 있다.

- 검색 제출 후 checkbox는 checked 상태로 다시 렌더링됨.
- 같은 조건으로 새 검색 시 유지됨.
- 페이지 2 이동 후에도 checked 상태와 51,045건 조건이 유지됨.
- `초기화` 버튼 클릭 시 false로 해제되고 인증구분/텍스트 조건도 초기화됨.
- Playwright 재현: 라벨 텍스트 또는 `#searchOverDateYn` 기반 클릭 후 `checked`를 검증하고 `#search`를 클릭한다. 이 조사 환경에서는 locator의 합성 체크 동작보다 실제 포인터 클릭이 신뢰성 있게 작동했으므로 `click()` 후 assertion을 권장한다.

## 검색 요청

- method: `POST`
- endpoint: `/prd/prdinfo/tdprd/SelectTdPrdListVw.do`
- 검색 버튼과 페이지 이동 모두 전체 HTML 문서 navigation을 발생시킴
- 별도 JSON 검색 API/XHR은 조사 범위에서 확인되지 않음
- URL query string은 바뀌지 않음
- 페이지 JavaScript `fn_getList(pageNo)`는 `searchForm.pageIndex`를 설정하고, 주소 표시명 hidden 값을 동기화한 뒤 동일 endpoint로 submit한다.

주요 파라미터는 위 UI 표와 같다. 인증구분은 동일 이름 `searchCrtfcSeCode`가 여러 번 전달되는 구조다. 서버가 응답 HTML에서 `pageIndex` 값을 빈 문자열로 다시 렌더링하는 경우가 있어, Collector는 응답 hidden 값보다 현재 페이지의 `.on` 링크와 첫 행 No를 검증 신호로 사용해야 한다.

## 페이지네이션

- 기본 페이지당 15건; 사용자가 30/50/100으로 변경 가능
- 페이지 링크는 `href="#"`이고 `onclick="fn_getList(N); return false;"`인 JS 이벤트 방식
- 실제 이동은 같은 endpoint로 POST
- 첫 화면은 1~10 블록
- `다음 페이지`는 11로 이동하며 다음 10페이지 블록을 연다.
- 마지막 링크는 조사 시점 기본 조건에서 `fn_getList(1016)` (15,229건 / 15건 기준)
- 만료 포함 조건에서 페이지 2 이동 시 전체 51,045건, checked 상태 유지, 첫 No=16을 확인함
- `처음`, `이전`, `다음`, `마지막`도 동일 JS submit 방식

## 목록과 상세

목록 열은 `No / 제품사진 / 인증구분 / 인증정보 / 회사정보 / 인증일자 / 만료일자`이다. 인증정보 셀에는 제품·기술명과 인증번호가, 회사정보 셀에는 업체명·대표자·주소가 함께 들어간다.

페이지 JavaScript에는 `fn_selectTdprdVw(seqNo, crtfcSeCode)`가 정의되어 있으며 `moveForm`에 `seqNo`, `crtfcSeCode`를 넣어 `SelectTdPrdVw.do`로 POST하는 상세 진입 설계가 존재한다. 그러나 조사한 공개 결과 행에는 링크, onclick, seqNo 또는 crtfcSeCode가 렌더링되지 않았다. 따라서 기준 표본에서는 목록→상세 진입을 실제 재현할 수 없었고 상세 전용 필드는 `확인 불가`로 처리한다. 인증 유형이나 권한에 따라 링크가 조건부 렌더링될 가능성은 다음 단계에서 표본 확장이 필요하다.

## 수집 난이도와 selector 전략

난이도는 **중간**이다. 로그인이나 무한 스크롤은 없지만 POST 상태, 복합 셀 파싱, 유형별 데이터 편차, 느린 응답을 다뤄야 한다.

권장 전략:

1. 기준 URL 진입 후 `#searchForm` 확인
2. `#searchOverDateYn` 클릭 후 `checked === true` assertion
3. 인증구분은 라벨 텍스트로 찾되 실제 제출 값도 기록
4. `#search` 클릭을 navigation과 함께 대기
5. `p`의 `전체 N개`, 결과 table의 header, 행 개수를 검증
6. `td[data-label]` 기준으로 셀을 읽고, 셀 내부 label 문자열로 세부 값 분리
7. 페이지 링크의 onclick 숫자를 사용하지 말고 보이는 링크/현재 `.on` 상태를 교차 검증
8. 요청 사이 충분한 지연, 재시도/백오프, run checkpoint 적용

예상 장애요소:

- 운영 사이트 응답 지연
- POST 상태라 URL만 저장해서 검색 세션을 복원할 수 없음
- 만료 포함을 빠뜨리면 과거 이력의 다수가 누락됨
- 주소와 대표자가 빈 목록 행 존재
- 만료일 `9999-12-31`은 무기한 의미라는 사이트 안내가 있어 별도 정규화 필요
- 일부 인증은 자동연계가 아니며 원천 자체가 지연/누락될 수 있음
- 동일 제품/인증번호 중복 및 인증 유형별 의미 차이 가능
- 상세 링크가 결과별 조건부일 가능성
- 사이트의 명칭/코드가 일몰 후에도 UI에 잔존

