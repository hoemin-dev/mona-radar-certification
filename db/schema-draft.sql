-- MONA RADAR Certification / SMPP schema draft
-- 조사 기준: 2026-08-14 공개 목록. 확인되지 않은 필드는 nullable로 둔다.
-- PostgreSQL 문법 초안이며 실제 migration은 아니다.

CREATE TABLE collection_runs (
    id                  BIGSERIAL PRIMARY KEY,
    source_name         TEXT NOT NULL DEFAULT 'SMPP_TDPRD',
    source_url          TEXT NOT NULL,
    started_at          TIMESTAMPTZ NOT NULL,
    finished_at         TIMESTAMPTZ,
    status              TEXT NOT NULL CHECK (status IN ('running', 'completed', 'partial', 'failed')),
    include_expired     BOOLEAN NOT NULL DEFAULT TRUE,
    search_params       JSONB NOT NULL DEFAULT '{}'::jsonb,
    expected_total      BIGINT,
    collected_count     BIGINT NOT NULL DEFAULT 0,
    last_page           INTEGER,
    error_summary       TEXT
);

CREATE TABLE companies (
    id                      BIGSERIAL PRIMARY KEY,
    source_business_no      TEXT, -- 검색 필드는 있으나 목록 출력은 확인 불가
    source_company_id       TEXT, -- 내부 기업 식별값 확인 전에는 채우지 않음
    company_name_raw        TEXT NOT NULL,
    company_name_normalized TEXT,
    representative_name    TEXT,
    address_raw             TEXT,
    first_seen_run_id       BIGINT REFERENCES collection_runs(id),
    last_seen_run_id        BIGINT REFERENCES collection_runs(id),
    UNIQUE (source_business_no)
);

CREATE TABLE certification_products (
    id                      BIGSERIAL PRIMARY KEY,
    company_id              BIGINT REFERENCES companies(id),
    product_name_raw        TEXT NOT NULL,
    product_name_normalized TEXT,
    item_name               TEXT, -- 품명: 확인 불가
    detailed_item_name      TEXT, -- 검색조건에는 존재, 결과 출력 확인 불가
    detailed_item_code      TEXT, -- 문자열로 저장하여 선행 0 보존
    image_url               TEXT,
    first_seen_run_id       BIGINT REFERENCES collection_runs(id),
    last_seen_run_id        BIGINT REFERENCES collection_runs(id)
);

CREATE TABLE certifications (
    id                          BIGSERIAL PRIMARY KEY,
    certification_product_id    BIGINT NOT NULL REFERENCES certification_products(id),
    certification_type_raw      TEXT NOT NULL,
    source_certification_code   TEXT,
    certification_no_raw        TEXT,
    certification_start_date    DATE,
    certification_end_date      DATE,
    certification_status_raw    TEXT, -- 목록에서는 확인 불가
    source_seq_no               TEXT, -- 상세 함수 인자이나 행에서 확인 불가
    detail_url                  TEXT, -- GET URL 추정 금지; 상세는 POST일 수 있음
    first_seen_run_id           BIGINT REFERENCES collection_runs(id),
    last_seen_run_id            BIGINT REFERENCES collection_runs(id),
    raw_payload                 JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX certifications_lookup_idx
    ON certifications (source_certification_code, certification_no_raw);

CREATE INDEX certifications_dates_idx
    ON certifications (certification_start_date, certification_end_date);

-- 관계 주석:
-- 목록의 한 행은 하나의 인증 레코드처럼 보이나, 같은 제품이 여러 인증을 갖는지,
-- 하나의 인증번호가 여러 세부품명/제품에 연결되는지는 이번 표본에서 확정하지 못했다.
-- 따라서 product 1 : N certification을 허용하되 UNIQUE 제약은 두지 않는다.
-- 상세/중복 표본 조사 후 자연키와 필요 시 N:M 연결 테이블을 결정한다.

-- 현재 유효 여부는 원천 필드가 아니라 수집 기준일과 날짜로 계산한다.
-- certification_end_date = DATE '9999-12-31'은 사이트 안내상 무기한 sentinel이며
-- NULL로 버리지 말고 raw 의미를 유지한다.
