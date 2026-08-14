# Hidden Identity Investigation (5A)

조사일: 2026-08-14. 공개·비로그인 SMPP만 사용했다. Production Collector/DB/schema는 변경하지 않았으며 `seqNo` 추측, brute force, 외부 사업자번호 검색을 하지 않았다.

Evidence 등급: `CONFIRMED`(실제 DOM/원응답/요청으로 재현), `LIKELY`(직접 호출은 못했으나 코드 구조가 명확), `UNCONFIRMED`, `NOT FOUND`.

## `fn_selectTdprdVw` 구현

원응답 inline JavaScript에 함수가 존재한다 (`CONFIRMED`). 외부 JS에서 정의된 함수가 아니다.

```javascript
function fn_selectTdprdVw(seqNo, crtfcSeCode) {
  var obj = document.moveForm;
  // 화면의 시도/시군구 표시명을 moveForm hidden 값에 동기화
  obj.seqNo.value = seqNo;
  obj.crtfcSeCode.value = crtfcSeCode;
  obj.action = "SelectTdPrdVw.do";
  obj.submit();
}
```

- form: `moveForm`, method `POST`.
- endpoint: `/prd/prdinfo/tdprd/SelectTdPrdVw.do`.
- 핵심 parameter: `seqNo`, `crtfcSeCode`.
- 함께 제출 가능한 hidden 검색상태: `menuId=5010704`, pageIndex/pageUnit, 인증유형/인증명/번호, 업체명, 사업자번호, 주소 표시명, 만료 포함, 세부품명번호/이름 등.
- CSRF/token hidden은 확인되지 않았다. 그러나 유효 key가 없으므로 상세 접근 자체는 재현하지 않았다.

같은 inline script에는 `fn_delCrtfc(seqNo,crtfcSeCode)`도 남아 있지만 공개 비로그인 목록의 기능으로 사용하지 않았고 권한 동작도 조사하지 않았다.

## `seqNo` 추적

원응답에서 `seqNo`는 함수 signature/대입, 삭제 함수, 빈 hidden input 등 7회 등장한다. `moveForm input[name=seqNo]`의 초기값과 검색 후 값은 모두 빈 문자열이다.

다음 위치에서는 모두 발견되지 않았다 (`NOT FOUND`).

- 결과 행 link/href/onclick
- `data-*` attribute
- 이미지 link
- inline JSON/row script
- 검색 POST body
- 페이지 이동에 필요한 공개 상태
- 모바일 viewport 결과 행

대표 8유형(NET, NEP, 성능인증, 우수조달물품, GS, 녹색기술제품, 우수조달공동상표, 산업융합품목)의 Production raw 행은 모두 link 0, onclick 0, seq/code 0이었다. 모바일 390px viewport의 첫 15행도 동일했다. 따라서 함수는 상세 기능의 설계 또는 과거/권한·조건부 템플릿 코드로 존재하지만 **현재 공개 목록에는 호출부가 렌더링되지 않는다**. 어느 경우인지 서버 템플릿 없이 확정할 수 없다.

결론: 내부 존재는 `CONFIRMED`, 공개 목록에서 값 확보는 `NOT FOUND`.

## `crtfcSeCode`

- 상세 함수/빈 hidden 존재: `CONFIRMED`.
- 결과 행 직접 노출: `NOT FOUND`.
- 검색 UI checkbox의 label/value 매핑으로 유형 코드 확보 가능: `CONFIRMED`.

예: 성능인증 `05`, 우수조달물품 `04`, NEP `01`, GS `03`, NET `02`, 우수조달공동상표 `09`, 녹색기술제품 `08`, 산업융합품목 `11`. 따라서 표시 유형에서 source code를 매핑할 수 있지만 상세 함수의 row-specific `seqNo`가 없으므로 상세 POST 재현에는 충분하지 않다.

## 검색/Network

| action | method | endpoint / 주요 body | evidence |
|---|---|---|---|
| 최초 진입 | GET | `SelectTdPrdListVw.do` | CONFIRMED |
| 검색 | POST | 같은 endpoint; `pageIndex`, 검색 text, `searchOverDateYn=Y`, `pageUnit` 등 | CONFIRMED |
| 세부품명 popup | GET | `/com/popupsvc/SelectSmlpzBtwnCmptprdSearchVwP.do?callback=PopCallback` | CONFIRMED |
| 상세 | POST 설계 | `SelectTdPrdVw.do`, `seqNo`, `crtfcSeCode` | LIKELY (함수), 미재현 |

빈 검색 POST에는 `seqNo`/`crtfcSeCode`가 전달되지 않는다. 사업자번호·세부품명번호는 검색조건으로만 전달된다. 목록 검색은 전체 document navigation이며 별도 목록 JSON API는 발견하지 못했다.

## Relevant form / hidden state

| form | name/id | initial value | role |
|---|---|---|---|
| moveForm | `seqNo` | empty | 상세 대상 key; 호출 시 대입하도록 구현 |
| moveForm | `crtfcSeCode` | empty | 상세 인증유형 code; 호출 시 대입 |
| moveForm | `searchCrtfcSeCode` | `0` | 목록 검색상태 복귀 |
| moveForm | `searchBsnmNo` | empty | 검색상태 복귀 |
| moveForm | `searchDetailPrdnmNo/Name` | empty | 검색상태 복귀 |
| searchForm | `searchCrtfcSeCode` | 21개 checkbox code | 인증유형 filter |
| searchForm | `searchBsnmNo` | empty, maxlength 10 | 검색 입력 |
| searchForm | `searchDetailPrdnmNo/Name` | readonly empty | popup callback 결과 |
| searchForm | `searchCrtfcSeCodeSet` | `0` | 응답에서 선택 복원용 comma state |

값이 존재하는 검색필드와 결과가 그 값을 공개하는 것은 별개다.

## 세부품명 popup

Popup은 공개 GET iframe이다 (`CONFIRMED`).

- URL: `/com/popupsvc/SelectSmlpzBtwnCmptprdSearchVwP.do?callback=PopCallback`.
- 제목: 중소기업자간 경쟁제품 검색.
- popup search form: POST same URL.
- filters: 연도, 산업군, 제품명, 세부품명번호, 세부품명.
- 2026년 기본 결과: 616개.
- 계층/필드: 산업군, 제품군, 세분류, 세부분류, 산업분류번호, 특이사항, 물품분류번호/품명, 세부품명번호/세부품명.

선택 link는 예를 들어 다음 source 값을 전달한다.

```text
fn_rtnData('0474','무기질비료및식물영양제',
           '1017161101','석회질비료','2026','',
           '10','산동식물및동식물성생산품',
           '101716','무기질비료및식물영양제')
```

부모 callback은 세 번째/네 번째 인자를 각각 `searchDetailPrdnmNo`, `searchDetailPrdnm`에 넣는다.

실제 `석회질비료` 선택 결과:

- selected code/name: `1017161101` / `석회질비료`.
- 검색 POST: `searchDetailPrdnmNo=1017161101`, `searchDetailPrdnm=석회질비료`.
- 만료 포함 결과: 1건.
- 결과 행: `석회질비료` 이름은 출력, `1017161101` 코드는 출력되지 않음.

즉 popup code/name은 공개 수집 가능하고 특정 code와 결과 집합의 관계도 쿼리로 확인 가능하다. 그러나 기본 전체 목록 각 행에 단일 code를 바로 귀속시킬 수 없고, 한 행이 여러 code에 속할 가능성도 배제할 수 없다. 코드를 역산·강제 할당하지 않는다.

## 사업자등록번호

- 검색 input `searchBsnmNo`, maxlength 10과 POST parameter 존재: `CONFIRMED`.
- 목록/row hidden/검색 응답에서 반환: `NOT FOUND`.
- page script에 업체 업무 popup 함수 `fn_selectTssListVwP(bsnmNo)`와 `/cop/registcorp/selectRegistCorpTssListVwP.do` 설계가 있으나 공개 결과 행 호출부/값은 `NOT FOUND`.
- 실제 번호를 추측하거나 외부에서 취득하지 않았으므로 reverse 검색은 수행하지 않았다.

따라서 SMPP 공개 목록만으로 business number를 수집할 수 없다.

## 상세 endpoint와 다른 공개 화면

`SelectTdPrdVw.do` POST 설계는 `CONFIRMED`이나 실제 key가 없어 상세 응답을 재현하지 않았다. CSRF가 없다는 사실만으로 공개 접근 가능성을 확정하지 않는다.

SMPP 도메인 제한 검색에서 해당 endpoint/함수/업체 popup을 색인한 다른 공개 결과는 발견되지 않았다. 현재 조사한 화면·popup 외에 동일 인증의 `seqNo`, 사업자번호 또는 상세 link를 제공하는 공개 화면은 `NOT FOUND`이다. 이는 사이트 전체에 절대 없다는 증명이 아니라 이번 재현 범위의 결과다.

## Field / Evidence

| Field | Exists internally | Exposed in list | Exposed elsewhere | Collectable | Evidence |
|---|---:|---:|---:|---:|---|
| `seqNo` | yes | no | no | no | internal CONFIRMED; value NOT FOUND |
| `crtfcSeCode` | yes | no (code) | filter mapping | yes, by type mapping | CONFIRMED |
| business_registration_no | search/backend likely | no | search input only | no from current result | input CONFIRMED; value NOT FOUND |
| detailed_item_code | yes | no | popup + filtered POST | partially | CONFIRMED |
| detailed_item_name | yes | only when filtered | popup + filtered result | partially | CONFIRMED |
| detail endpoint | yes | no link | inline function | no without key | endpoint CONFIRMED; response UNCONFIRMED |

## Identity 판단

**B. Partial Identity 강화 가능.**

- 강화 가능: source certification type code, 세부품명 code/name 및 code별 결과 관계.
- 확보 불가: permanent row ID(`seqNo`), 사업자번호, 검증된 상세 response.

따라서 기존 `snapshot occurrence + provisional entity matching` 구조는 유지한다. 세부품명 관계는 향후 별도 many-to-many evidence로 고려할 수 있지만, 5A만으로 snapshot을 병합하거나 entity key를 확정하지 않는다.

## 5B 미해결 표본/질문

1. 완전히 동일한 우수조달공동상표 행들이 서로 다른 세부품명 filter에 속하는지.
2. 산업융합품목 `제2020-693호`의 60업체가 code별 관계로 분리되는지.
3. NET `20-1411` 공동/다중 업체와 세부품명 관계.
4. 인증번호에 품명 줄바꿈이 포함된 유형에서 `crtfcSeCode`/세부품명 관계.
5. 상세 링크가 로그인·관리 권한 또는 특정 상태에서만 렌더링되는지(우회 없이 별도 확인 필요).

## Collector v2 후보

- `source_certification_code`: 가치 높음, 유형 label→공식 checkbox code 매핑.
- `detailed_item_code/name`: 가치 있음. 단 snapshot scalar가 아니라 별도 조사로 확인한 many-to-many relation/evidence로 설계.
- `seqNo`, business number, detail URL: 현재 반영 금지.

