# Collector (next phase)

이 디렉터리는 SMPP 공개 검색 결과의 checkpoint/resume을 검증하는 Playwright MVP다. 기본 `pageUnit`은 사이트가 제공하는 100이며, 안전 제한상 순차 수집 페이지 번호 옵션은 1~6만 허용한다.

## 실행

Node.js 24 이상에서 프로젝트 루트를 기준으로 실행한다.

```powershell
npm.cmd install
npm.cmd run collect:mvp
npm.cmd run diagnose:last-page
```

Checkpoint 검증용 옵션:

```powershell
# 새 run에서 1~3 처리 후 resumable 상태로 정지
npm.cmd run collect:mvp -- --new-run --stop-after-page=3

# 같은 run을 4~6부터 재개하고 완료
npm.cmd run collect:mvp -- --stop-after-page=6 --complete-run

# page 4 DB transaction 중 예외 주입
npm.cmd run collect:mvp -- --new-run --stop-after-page=6 --fail-after-page=4
```

SQLite 결과는 `collector/data/mona-radar-certification.sqlite`에 생성된다. 페이지 row, page completed checkpoint, run의 `last_completed_page` 갱신은 하나의 transaction이다. 미완료 run은 새 브라우저에서 검색조건을 재구성한 뒤 `last_completed_page + 1`부터 재개한다.

## 권장 최소 구성

```text
collector/
  README.md
  src/
    config.ts            # URL, timeout, page size, 인증 코드 매핑
    browser.ts           # Playwright context와 재시도
    search-state.ts      # 만료 포함/인증구분/검색조건 설정과 assertion
    list-parser.ts       # td[data-label] 기반 행 파싱
    paginator.ts         # POST/JS pagination과 checkpoint
    detail-parser.ts     # 상세 진입이 검증된 뒤에만 추가
    sink.ts              # transaction/upsert
    types.ts
  tests/
    fixtures/            # 개인정보 최소화한 HTML fixture
    list-parser.test.ts
    search-state.test.ts
```

## 필수 동작 순서

1. 기준 URL과 `#searchForm`을 검증한다.
2. `#searchOverDateYn`을 실제 클릭하고 checked 상태를 assertion한다.
3. 필요 인증구분을 `name=searchCrtfcSeCode` + value로 선택한다.
4. 검색 navigation 후 결과 수, checkbox 유지, 표 header를 검증한다.
5. 목록 행을 raw/normalized 두 형태로 파싱한다.
6. 페이지별 checkpoint를 저장하고 요청 속도를 제한한다.
7. 현재 페이지, 첫/마지막 No, 조건 유지 여부를 매 페이지 확인한다.
8. 실패한 페이지는 run을 폐기하지 말고 재시도 가능한 상태로 남긴다.

## 금지/보류

- `인증기간 만료업체 포함`을 선택하지 않은 전체 수집
- 확인되지 않은 GET query 조립
- 사업자번호/세부품명번호를 다른 필드에서 추정
- 상세 `seqNo`를 생성하거나 추측
- 사이트 안내보다 빠른 병렬 대량 요청
- 목록의 업체명을 제조사로 확정

상세 수집은 실제 행에서 `fn_selectTdprdVw(seqNo, crtfcSeCode)` 진입이 재현된 뒤 별도 모듈로 추가한다.
