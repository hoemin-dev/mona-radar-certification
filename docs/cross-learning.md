# MonaRadar Cross-Learning — Production Collection v1

## Native snapshot comparison에서 추가 확인된 원칙

- **snapshot total 동일성은 내용 동일성이 아니다**: profile과 exact visible multiset을 모두 비교한다.
- **run 간 source row position 매칭 금지**: row 번호는 같은 run의 completeness 검증용이다.
- **set이 아니라 multiset 비교**: visible-identical occurrence의 count도 source 관측 정보다.
- **change detection과 entity identity를 분리**: added/removed observation은 business event나 merge 근거가 아니다.
- **collector diff와 source diff를 분리**: canonical field·raw 값·type/code profile을 먼저 검증한다.

## Schema v1 occurrence model에서 추가 확인된 원칙

- **source occurrence와 entity를 분리**: source row position은 completeness 검증용이며 permanent identity가 아니다.
- **raw / normalized / derived를 별도 보존**: normalization과 lifecycle은 검색·분석용 값이지 원문을 대체하지 않는다.
- **candidate matching과 accepted identity를 분리**: fingerprint는 후보를 찾는 용도이며 merge 권한이 아니다.
- **역할을 모르면 NULL로 보존**: company relation role을 참여업체·보유업체 등으로 추정하지 않는다.
- **many-to-many를 scalar로 축소하지 않음**: 세부품명은 evidence relation으로 남긴다.
- **collector/rule version 보존**: run의 parser/schema version 및 type policy version을 추적한다.

## Collision semantics 조사에서 추가 확인된 원칙

- **duplicate-looking은 duplicate가 아니다**: visible field가 같아도 숨은 관계나 반복 occurrence일 수 있으므로 source ID 없이 삭제하지 않는다.
- **source 번호와 entity를 동일시하지 않는다**: 인증번호 하나가 여러 업체·제품·기간을 묶을 수 있다.
- **관계 가능성을 먼저 검증한다**: 상세분류와 업체는 scalar identity가 아니라 many-to-many evidence일 수 있다.
- **snapshot row는 관측 occurrence다**: source entity, 제품, 업체 중 어느 하나와 자동으로 동일시하지 않는다.
- **유형별 identity rule을 허용한다**: NET, 우수조달, 공동상표 등은 collision 분포와 subject 의미가 다르다.
- **filter relation과 row relation을 분리한다**: 검색 결과 포함은 개별 visible row와 분류 code의 1:1 관계를 증명하지 않는다.

SMPP 기술개발제품 production run 8에서 실제 검증된 패턴이다. Company, Facility, Market에 적용할 때 코드를 즉시 공통화하지 말고 각 원천에서 동일한 실패 조건을 재현한 뒤 설계 원칙만 채택한다.

## 공유 가치가 확인된 원칙

- **Source NULL과 parser failure 분리**: 제품명, 대표자, 주소, 날짜가 비어 있어도 원천이 실제 빈 값을 제공하면 유효한 레코드로 저장한다. 필수 구조나 업체명·인증유형 자체를 읽지 못한 경우만 parser failure로 처리한다.
- **Raw 보존**: 정규화 결과와 함께 원문 셀 및 행 HTML을 JSON으로 저장하면 대량 표본에서 새 NULL 패턴을 발견해도 추측 없이 parser를 수정할 수 있다.
- **Run/page checkpoint 분리**: run의 마지막 완료 페이지 외에 각 페이지의 범위, 건수, 처리시간과 상태를 기록해야 중단 페이지를 완료로 오인하지 않는다.
- **페이지 단위 transaction**: row 저장, page completed, last completed page 갱신을 하나의 transaction으로 묶는다. 100건 처리 중 예외에서도 해당 페이지 신규 row가 0건임을 검증했다.
- **Resume identity**: URL만 비교하지 않고 mode, pageUnit, 만료 포함 여부 및 전체 결과 수를 함께 비교한다. 페이지 크기가 다르면 같은 페이지 번호도 의미가 달라진다.
- **검색조건 assertion**: 매 navigation 뒤 checkbox, pageUnit, 전체 건수와 현재 페이지를 다시 확인한다. 브라우저 세션 상태를 신뢰하지 않는다.
- **변경 감지 후 중단**: resume 시 전체 결과 수가 달라지면 자동 reconciliation하지 않고 명시적으로 중단한다.
- **완료 전 전역 무결성 검사**: page 완료 수, failed page, diagnostic, COUNT/DISTINCT/MIN/MAX, FK 위반을 모두 확인한 뒤에만 run을 completed로 바꾼다.
- **제한 재시도**: 일시적 navigation 오류만 제한 횟수로 재검증하며, 끝내 실패하면 다음 페이지로 건너뛰지 않는다.

## Production v1 관측

- 51,045건, 511페이지, retry 0회, parse diagnostic 0건
- 제품명 빈 값 1,367건, 대표자 빈 값 23,023건, 주소 빈 값 21,536건
- 시작일 NULL 777건, 종료일 NULL 10건, 무기한 sentinel 8,109건

이 빈 값들은 자동 보정하거나 다른 필드로 대체하지 않는다.

## Identity profiling에서 추가 확인된 원칙

- **Source identity와 internal identity 분리**: 전체 데이터에서 검증하지 않은 natural key를 PK/UNIQUE로 사용하지 않는다.
- **Snapshot과 entity 분리**: 동일 번호에 여러 업체·제품·기간과 완전 동일 행이 공존하면 occurrence를 보존하고 entity 연결을 별도 버전 규칙으로 관리한다.
- **후보키와 제약조건 분리**: matching에 유용한 PROVISIONAL fingerprint도 DB uniqueness를 보장하지 않는다.
- **유형별 identity semantics**: 한 source 내부에서도 레코드 유형별로 번호의 uniqueness가 다를 수 있다. 전역 규칙 전에 유형별 분포를 확인한다.
- **Normalized 값은 evidence**: 법인표기 제거로 회사 distinct가 크게 줄어도 동일 법인 증거는 아니다. raw name matching만으로 서비스 간 FK를 확정하지 않는다.
- **외부 row number 비영속성**: row number는 run 완전성 검증에만 사용하고 entity ID로 승격하지 않는다.

## Hidden identity 조사에서 추가 확인된 원칙

- **함수 signature는 값 노출의 증거가 아니다**: source-native ID를 받는 상세 함수가 있어도 현재 row DOM/요청에 호출부와 값이 없으면 collectable하지 않다.
- **검색 가능성과 반환 가능성 분리**: 사업자번호나 분류코드로 검색할 수 있어도 결과가 그 값을 반환한다고 가정하지 않는다.
- **원응답·DOM·network를 함께 확인**: 빈 hidden, 잔존 함수, 실제 POST body와 row attribute를 구분해야 false identity를 피할 수 있다.
- **분류 filter 관계는 scalar identity가 아니다**: popup code로 결과를 좁힐 수 있어도 한 occurrence에 단일 code를 역산하지 않는다. many-to-many evidence로 보존한다.
- **Source-native ID를 natural key보다 먼저 조사**: 확보되지 않으면 그 사실을 명시하고 provisional matching을 유지한다.
