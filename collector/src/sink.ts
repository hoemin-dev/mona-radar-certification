import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.ts";
import type { CertificationRecord, CollectionRun, RowParseFailure } from "./types.ts";
import { toSnapshotOccurrence } from "./occurrence-model.ts";
import { SOURCE_CERTIFICATION_CODE_VERSION, sourceCertificationCodeFor, sourceCertificationCodes } from "./source-certification-codes.ts";

const now = (): string => new Date().toISOString();

function migrateLegacyRuns(db: DatabaseSync): void {
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='collection_runs'").get() as { sql?: string } | undefined;
  if (!table?.sql || table.sql.includes("last_completed_page")) return;
  db.exec("PRAGMA foreign_keys=OFF; BEGIN");
  try {
    db.exec(`
      CREATE TABLE collection_runs_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_url TEXT NOT NULL,
        source_mode TEXT NOT NULL,
        page_unit INTEGER NOT NULL,
        search_over_date_yn TEXT NOT NULL,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        status TEXT NOT NULL CHECK(status IN ('running','interrupted','completed','failed')),
        search_total INTEGER,
        last_completed_page INTEGER NOT NULL DEFAULT 0,
        rows_found INTEGER NOT NULL DEFAULT 0,
        rows_parsed INTEGER NOT NULL DEFAULT 0,
        rows_inserted INTEGER NOT NULL DEFAULT 0,
        error_summary TEXT
      );
      INSERT INTO collection_runs_v2 (
        id, source_url, source_mode, page_unit, search_over_date_yn, started_at,
        updated_at, completed_at, status, search_total, last_completed_page,
        rows_found, rows_parsed, rows_inserted, error_summary
      ) SELECT id, source_url, '${config.sourceMode}', ${config.pageUnit}, 'Y', started_at,
        COALESCE(finished_at, started_at), finished_at, status, search_total,
        CASE WHEN status='completed' THEN 1 ELSE 0 END,
        rows_found, rows_parsed, rows_inserted, error_summary
        FROM collection_runs;
      DROP TABLE collection_runs;
      ALTER TABLE collection_runs_v2 RENAME TO collection_runs;
      COMMIT;
      PRAGMA foreign_keys=ON;
    `);
  } catch (error) {
    db.exec("ROLLBACK; PRAGMA foreign_keys=ON;");
    throw error;
  }
}

function migrateNullableProductName(db: DatabaseSync): void {
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='certification_records'").get() as { sql?: string } | undefined;
  if (!table?.sql || !/product_name\s+TEXT\s+NOT NULL/i.test(table.sql)) return;
  db.exec("PRAGMA foreign_keys=OFF; BEGIN");
  try {
    db.exec(`
      CREATE TABLE certification_records_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL REFERENCES collection_runs(id),
        source_row_no INTEGER, certification_type TEXT NOT NULL, certification_no TEXT,
        product_name TEXT, company_name TEXT NOT NULL, representative_name TEXT, address_raw TEXT,
        certification_start_date TEXT, certification_end_date TEXT, is_currently_valid INTEGER,
        historical_certification INTEGER, is_unlimited_end_date INTEGER NOT NULL, image_url TEXT,
        source_page_no INTEGER NOT NULL, business_registration_no TEXT, company_identifier TEXT,
        detailed_item_name TEXT, detailed_item_code TEXT, source_seq_no TEXT, detail_url TEXT,
        raw_json TEXT NOT NULL, collected_at TEXT NOT NULL,
        UNIQUE(run_id,source_page_no,source_row_no)
      );
      INSERT INTO certification_records_v2 SELECT * FROM certification_records;
      DROP TABLE certification_records;
      ALTER TABLE certification_records_v2 RENAME TO certification_records;
      COMMIT;
      PRAGMA foreign_keys=ON;
    `);
  } catch (error) {
    db.exec("ROLLBACK; PRAGMA foreign_keys=ON;");
    throw error;
  }
}

export function openDatabase(): DatabaseSync {
  mkdirSync(dirname(config.dbPath), { recursive: true });
  const db = new DatabaseSync(config.dbPath);
  migrateLegacyRuns(db);
  migrateNullableProductName(db);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS collection_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_url TEXT NOT NULL,
      source_mode TEXT NOT NULL,
      page_unit INTEGER NOT NULL,
      search_over_date_yn TEXT NOT NULL,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL CHECK(status IN ('running','interrupted','completed','failed')),
      search_total INTEGER,
      last_completed_page INTEGER NOT NULL DEFAULT 0,
      rows_found INTEGER NOT NULL DEFAULT 0,
      rows_parsed INTEGER NOT NULL DEFAULT 0,
      rows_inserted INTEGER NOT NULL DEFAULT 0,
      error_summary TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS certification_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES collection_runs(id),
      source_row_no INTEGER,
      certification_type TEXT NOT NULL,
      certification_no TEXT,
      product_name TEXT,
      company_name TEXT NOT NULL,
      representative_name TEXT,
      address_raw TEXT,
      certification_start_date TEXT,
      certification_end_date TEXT,
      is_currently_valid INTEGER,
      historical_certification INTEGER,
      is_unlimited_end_date INTEGER NOT NULL,
      image_url TEXT,
      source_page_no INTEGER NOT NULL,
      business_registration_no TEXT,
      company_identifier TEXT,
      detailed_item_name TEXT,
      detailed_item_code TEXT,
      source_seq_no TEXT,
      detail_url TEXT,
      raw_json TEXT NOT NULL,
      collected_at TEXT NOT NULL,
      UNIQUE(run_id, source_page_no, source_row_no)
    );
    CREATE TABLE IF NOT EXISTS collection_diagnostics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES collection_runs(id),
      source_row_no INTEGER,
      event TEXT NOT NULL,
      reason TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      collected_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS collection_run_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES collection_runs(id),
      page_no INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','running','completed','failed')),
      rows_found INTEGER NOT NULL DEFAULT 0,
      rows_parsed INTEGER NOT NULL DEFAULT 0,
      rows_inserted INTEGER NOT NULL DEFAULT 0,
      first_no INTEGER,
      last_no INTEGER,
      search_total INTEGER,
      started_at TEXT,
      completed_at TEXT,
      error_message TEXT,
      page_elapsed_ms INTEGER,
      UNIQUE(run_id, page_no)
    );
    CREATE TABLE IF NOT EXISTS source_certification_code_mappings (
      certification_type TEXT NOT NULL,
      source_certification_code TEXT NOT NULL,
      mapping_version TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      notes TEXT,
      PRIMARY KEY (certification_type, mapping_version)
    );
    CREATE TABLE IF NOT EXISTS certification_snapshot_occurrences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES collection_runs(id),
      source_page_no INTEGER NOT NULL,
      source_row_no INTEGER,
      certification_type TEXT NOT NULL,
      source_certification_code TEXT,
      certification_no TEXT,
      certification_subject_name TEXT,
      company_name_raw TEXT NOT NULL,
      company_name_normalized TEXT,
      representative_name_raw TEXT,
      address_raw TEXT,
      certification_start_date_raw TEXT NOT NULL,
      certification_end_date_raw TEXT NOT NULL,
      certification_start_date TEXT,
      certification_end_date TEXT,
      is_unlimited INTEGER NOT NULL CHECK(is_unlimited IN (0,1)),
      status_class TEXT NOT NULL CHECK(status_class IN ('current','historical','unknown')),
      is_currently_valid INTEGER,
      is_historical INTEGER,
      status_unknown INTEGER NOT NULL CHECK(status_unknown IN (0,1)),
      image_url TEXT,
      raw_json TEXT NOT NULL,
      candidate_fingerprint TEXT,
      candidate_rule_version TEXT NOT NULL,
      collected_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(run_id, source_page_no, source_row_no)
    );
    CREATE TABLE IF NOT EXISTS certification_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_status TEXT NOT NULL DEFAULT 'candidate' CHECK(entity_status IN ('candidate','active','retired')),
      entity_type TEXT NOT NULL DEFAULT 'certification',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS certification_entity_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      occurrence_id INTEGER NOT NULL REFERENCES certification_snapshot_occurrences(id),
      entity_id INTEGER NOT NULL REFERENCES certification_entities(id),
      match_method TEXT NOT NULL,
      match_rule_version TEXT,
      confidence REAL,
      match_status TEXT NOT NULL CHECK(match_status IN ('candidate','accepted','rejected','manual')),
      evidence_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      reviewed_at TEXT,
      UNIQUE(occurrence_id, entity_id)
    );
    CREATE TABLE IF NOT EXISTS certification_identity_policies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      certification_type TEXT NOT NULL,
      source_certification_code TEXT,
      policy_version TEXT NOT NULL,
      identity_semantics TEXT NOT NULL,
      candidate_rule TEXT NOT NULL,
      auto_merge_allowed INTEGER NOT NULL DEFAULT 0 CHECK(auto_merge_allowed IN (0,1)),
      notes TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(certification_type, policy_version)
    );
    CREATE TABLE IF NOT EXISTS certification_company_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id INTEGER REFERENCES certification_entities(id),
      occurrence_id INTEGER REFERENCES certification_snapshot_occurrences(id),
      company_reference_id INTEGER,
      company_name_raw TEXT NOT NULL,
      relation_role TEXT,
      relation_status TEXT NOT NULL DEFAULT 'observed' CHECK(relation_status IN ('observed','candidate','accepted','rejected')),
      evidence_source TEXT NOT NULL,
      confidence REAL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS certification_subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_name_raw TEXT NOT NULL,
      subject_name_normalized TEXT,
      subject_kind TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS certification_periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id INTEGER REFERENCES certification_entities(id),
      occurrence_id INTEGER REFERENCES certification_snapshot_occurrences(id),
      start_date_raw TEXT NOT NULL,
      end_date_raw TEXT NOT NULL,
      start_date TEXT,
      end_date TEXT,
      is_unlimited INTEGER NOT NULL CHECK(is_unlimited IN (0,1)),
      period_relation_status TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS certification_detailed_item_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      occurrence_id INTEGER REFERENCES certification_snapshot_occurrences(id),
      entity_id INTEGER REFERENCES certification_entities(id),
      detailed_item_code TEXT NOT NULL,
      detailed_item_name TEXT NOT NULL,
      evidence_type TEXT NOT NULL CHECK(evidence_type IN ('FILTER_RESULT','POPUP_SELECTION','MANUAL_VERIFICATION')),
      evidence_scope TEXT NOT NULL CHECK(evidence_scope IN ('CERTIFICATION','OCCURRENCE','UNKNOWN')),
      evidence_query_json TEXT NOT NULL DEFAULT '{}',
      source_url TEXT,
      observed_at TEXT NOT NULL,
      confidence REAL,
      notes TEXT
    );
    CREATE INDEX IF NOT EXISTS certification_snapshot_occurrences_run_lookup_idx
      ON certification_snapshot_occurrences(run_id, certification_type, source_certification_code, certification_no);
    CREATE INDEX IF NOT EXISTS certification_snapshot_occurrences_company_idx
      ON certification_snapshot_occurrences(run_id, company_name_normalized);
    CREATE INDEX IF NOT EXISTS certification_snapshot_occurrences_subject_idx
      ON certification_snapshot_occurrences(run_id, certification_subject_name);
    CREATE INDEX IF NOT EXISTS certification_snapshot_occurrences_status_idx
      ON certification_snapshot_occurrences(run_id, status_class, is_unlimited);
    CREATE INDEX IF NOT EXISTS certification_snapshot_occurrences_candidate_idx
      ON certification_snapshot_occurrences(candidate_fingerprint, candidate_rule_version);
  `);
  const pageColumns = db.prepare("PRAGMA table_info(collection_run_pages)").all() as Array<{ name: string }>;
  if (!pageColumns.some((column) => column.name === "page_elapsed_ms")) {
    db.exec("ALTER TABLE collection_run_pages ADD COLUMN page_elapsed_ms INTEGER");
  }
  const runColumns = db.prepare("PRAGMA table_info(collection_runs)").all() as Array<{ name: string }>;
  if (!runColumns.some((column) => column.name === "retry_count")) {
    db.exec("ALTER TABLE collection_runs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0");
  }
  if (!runColumns.some((column) => column.name === "collector_schema_version")) {
    db.exec("ALTER TABLE collection_runs ADD COLUMN collector_schema_version TEXT NOT NULL DEFAULT 'v1'");
  }
  const mappingInsert = db.prepare(`INSERT OR REPLACE INTO source_certification_code_mappings
    (certification_type,source_certification_code,mapping_version,observed_at,notes) VALUES (?,?,?,?,?)`);
  for (const [type, code] of Object.entries(sourceCertificationCodes)) {
    mappingInsert.run(type, code, SOURCE_CERTIFICATION_CODE_VERSION, now(), "Public SMPP search checkbox mapping");
  }
  const policyInsert = db.prepare(`INSERT OR IGNORE INTO certification_identity_policies
    (certification_type,source_certification_code,policy_version,identity_semantics,candidate_rule,auto_merge_allowed,notes,created_at)
    VALUES (?,?, 'v1', 'occurrence_only', 'C1', 0, ?, ?)`);
  for (const [type, code] of Object.entries(sourceCertificationCodes)) {
    const notes = type === "NET"
      ? "Same number can span multiple companies and technical subjects; number-only identity prohibited."
      : type === "산업융합품목"
        ? "Same number can span multiple companies and subjects; group/batch semantics unresolved."
        : type === "우수조달공동상표"
          ? "Overlapping periods and visible-identical occurrences observed; renewal auto-merge prohibited."
          : "No automatic entity merge; preserve source snapshot occurrences.";
    policyInsert.run(type, code, notes, now());
  }
  return db;
}

function mapRun(row: Record<string, unknown>): CollectionRun {
  return {
    id: Number(row.id),
    status: row.status as CollectionRun["status"],
    searchTotal: row.search_total === null ? null : Number(row.search_total),
    lastCompletedPage: Number(row.last_completed_page),
  };
}

export function acquireRun(db: DatabaseSync, forceNew: boolean): { run: CollectionRun; resumed: boolean } {
  if (!forceNew) {
    const existing = db.prepare(`SELECT * FROM collection_runs
      WHERE status IN ('running','interrupted') AND source_url=? AND source_mode=?
        AND page_unit=? AND search_over_date_yn='Y'
        AND error_summary != 'stopped_by_user'
      ORDER BY id DESC LIMIT 1`).get(config.sourceUrl, config.sourceMode, config.pageUnit) as Record<string, unknown> | undefined;
    if (existing) {
      db.prepare("UPDATE collection_runs SET status='running', updated_at=?, error_summary=NULL WHERE id=?")
        .run(now(), existing.id);
      return { run: { ...mapRun(existing), status: "running" }, resumed: true };
    }
  }
  const timestamp = now();
  const result = db.prepare(`INSERT INTO collection_runs
    (source_url, source_mode, page_unit, search_over_date_yn, started_at, updated_at, status, collector_schema_version)
    VALUES (?, ?, ?, 'Y', ?, ?, 'running', ?)`).run(config.sourceUrl, config.sourceMode, config.pageUnit, timestamp, timestamp, config.collectorSchemaVersion);
  return { run: { id: Number(result.lastInsertRowid), status: "running", searchTotal: null, lastCompletedPage: 0 }, resumed: false };
}

export function setInitialSearchTotal(db: DatabaseSync, runId: number, total: number): void {
  db.prepare("UPDATE collection_runs SET search_total=?, updated_at=? WHERE id=? AND search_total IS NULL").run(total, now(), runId);
}

export function startPage(db: DatabaseSync, runId: number, pageNo: number): void {
  db.prepare(`INSERT INTO collection_run_pages (run_id,page_no,status,started_at)
    VALUES (?,?,'running',?) ON CONFLICT(run_id,page_no) DO UPDATE SET
    status='running', started_at=excluded.started_at, completed_at=NULL, error_message=NULL`)
    .run(runId, pageNo, now());
}

const bool = (value: boolean | null): number | null => value === null ? null : Number(value);

function occurrenceValues(runId: number, record: CertificationRecord, createdAt: string): unknown[] {
  const occurrence = toSnapshotOccurrence(record);
  return [
    runId, record.sourcePageNo, record.sourceRowNo, record.certificationType, occurrence.sourceCertificationCode,
    record.certificationNo, occurrence.certificationSubjectName, record.companyName, occurrence.companyNameNormalized,
    record.representativeName, record.addressRaw, occurrence.certificationStartDateRaw, occurrence.certificationEndDateRaw,
    record.certificationStartDate, record.certificationEndDate, Number(occurrence.isUnlimited), occurrence.statusClass,
    bool(record.isCurrentlyValid), bool(record.historicalCertification), Number(occurrence.statusUnknown), record.imageUrl,
    record.rawJson, occurrence.candidateFingerprint, occurrence.candidateRuleVersion, record.collectedAt, createdAt,
  ];
}

function occurrenceInsert(db: DatabaseSync) {
  return db.prepare(`INSERT OR IGNORE INTO certification_snapshot_occurrences (
    run_id,source_page_no,source_row_no,certification_type,source_certification_code,certification_no,
    certification_subject_name,company_name_raw,company_name_normalized,representative_name_raw,address_raw,
    certification_start_date_raw,certification_end_date_raw,certification_start_date,certification_end_date,
    is_unlimited,status_class,is_currently_valid,is_historical,status_unknown,image_url,raw_json,
    candidate_fingerprint,candidate_rule_version,collected_at,created_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
}

export function commitPage(db: DatabaseSync, runId: number, page: {
  pageNo: number; searchTotal: number; rowsFound: number; rowsParsed: number;
  firstNo: number | null; lastNo: number | null; records: CertificationRecord[];
  failures: RowParseFailure[];
}, injectFailure = false, pageStartedAt = Date.now()): { inserted: number; elapsedMs: number } {
  if (page.failures.length !== 0) throw new Error("Cannot complete a page with parsing diagnostics");
  const unmappedTypes = [...new Set(page.records
    .filter((record) => toSnapshotOccurrence(record).sourceCertificationCode === null)
    .map((record) => record.certificationType))];
  if (unmappedTypes.length > 0) {
    throw new Error(`Unmapped SMPP certification type(s): ${unmappedTypes.join(", ")}`);
  }
  const insert = db.prepare(`INSERT OR IGNORE INTO certification_records (
    run_id,source_row_no,certification_type,certification_no,product_name,company_name,
    representative_name,address_raw,certification_start_date,certification_end_date,
    is_currently_valid,historical_certification,is_unlimited_end_date,image_url,source_page_no,
    business_registration_no,company_identifier,detailed_item_name,detailed_item_code,
    source_seq_no,detail_url,raw_json,collected_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertOccurrence = occurrenceInsert(db);
  db.exec("BEGIN");
  try {
    if (page.firstNo !== null && page.lastNo !== null) {
      db.prepare(`DELETE FROM collection_diagnostics
        WHERE run_id=? AND event='row_parse_failed' AND source_row_no BETWEEN ? AND ?`)
        .run(runId,page.firstNo,page.lastNo);
    }
    let inserted = 0;
    for (const r of page.records) {
      inserted += Number(insert.run(
        runId,r.sourceRowNo,r.certificationType,r.certificationNo,r.productName,r.companyName,
        r.representativeName,r.addressRaw,r.certificationStartDate,r.certificationEndDate,
        bool(r.isCurrentlyValid),bool(r.historicalCertification),bool(r.isUnlimitedEndDate),r.imageUrl,r.sourcePageNo,
        r.businessRegistrationNo,r.companyIdentifier,r.detailedItemName,r.detailedItemCode,
        r.sourceSeqNo,r.detailUrl,r.rawJson,r.collectedAt,
      ).changes);
      insertOccurrence.run(...occurrenceValues(runId, r, now()));
    }
    if (injectFailure) throw new Error(`Injected failure while committing page ${page.pageNo}`);
    const completedAt = now();
    const elapsedMs = Date.now() - pageStartedAt;
    db.prepare(`UPDATE collection_run_pages SET status='completed',rows_found=?,rows_parsed=?,
      rows_inserted=?,first_no=?,last_no=?,search_total=?,completed_at=?,error_message=NULL,page_elapsed_ms=?
      WHERE run_id=? AND page_no=?`).run(
      page.rowsFound,page.rowsParsed,inserted,page.firstNo,page.lastNo,page.searchTotal,completedAt,elapsedMs,runId,page.pageNo,
    );
    db.prepare(`UPDATE collection_runs SET last_completed_page=?,updated_at=?,
      rows_found=rows_found+?,rows_parsed=rows_parsed+?,rows_inserted=rows_inserted+?
      WHERE id=?`).run(page.pageNo,completedAt,page.rowsFound,page.rowsParsed,inserted,runId);
    db.exec("COMMIT");
    return { inserted, elapsedMs };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function markPageFailed(db: DatabaseSync, runId: number, pageNo: number, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  db.prepare(`UPDATE collection_run_pages SET status='failed',error_message=?,completed_at=NULL
    WHERE run_id=? AND page_no=?`).run(message, runId, pageNo);
  interruptRun(db, runId, message);
}

export function saveFailures(db: DatabaseSync, runId: number, failures: RowParseFailure[]): void {
  const insert = db.prepare(`INSERT INTO collection_diagnostics
    (run_id,source_row_no,event,reason,raw_json,collected_at)
    VALUES (?,?,'row_parse_failed',?,?,?)`);
  for (const failure of failures) {
    insert.run(runId,failure.sourceRowNo,failure.reason,failure.rawJson,failure.collectedAt);
  }
}

export function interruptRun(db: DatabaseSync, runId: number, reason: string | null = null): void {
  db.prepare("UPDATE collection_runs SET status='interrupted',updated_at=?,error_summary=? WHERE id=?")
    .run(now(), reason, runId);
}

export function completeRun(db: DatabaseSync, runId: number): void {
  const timestamp = now();
  db.prepare("UPDATE collection_runs SET status='completed',updated_at=?,completed_at=?,error_summary=NULL WHERE id=?")
    .run(timestamp, timestamp, runId);
}

export function failRun(db: DatabaseSync, runId: number, error: unknown): void {
  db.prepare("UPDATE collection_runs SET status='failed',updated_at=?,error_summary=? WHERE id=?")
    .run(now(), error instanceof Error ? error.message : String(error), runId);
}

export function countRunRecords(db: DatabaseSync, runId: number): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM certification_records WHERE run_id=?").get(runId) as { count: number };
  return Number(row.count);
}

export function incrementRetry(db: DatabaseSync, runId: number): void {
  db.prepare("UPDATE collection_runs SET retry_count=retry_count+1,updated_at=? WHERE id=?").run(now(),runId);
}

export function productionIntegrity(db: DatabaseSync, runId: number, totalPages: number, searchTotal: number) {
  const rows = db.prepare(`SELECT COUNT(*) count,COUNT(DISTINCT source_row_no) distinct_count,
    MIN(source_row_no) min_no,MAX(source_row_no) max_no FROM certification_records WHERE run_id=?`).get(runId) as Record<string, number>;
  const pages = db.prepare(`SELECT SUM(status='completed') completed_pages,SUM(status='failed') failed_pages
    FROM collection_run_pages WHERE run_id=?`).get(runId) as Record<string, number>;
  const diagnostics = db.prepare("SELECT COUNT(*) count FROM collection_diagnostics WHERE run_id=?").get(runId) as { count: number };
  const result = {
    count:Number(rows.count), distinctCount:Number(rows.distinct_count), minNo:Number(rows.min_no), maxNo:Number(rows.max_no),
    completedPages:Number(pages.completed_pages), failedPages:Number(pages.failed_pages), diagnostics:Number(diagnostics.count),
    foreignKeyViolations:db.prepare("PRAGMA foreign_key_check").all().length,
  };
  if (result.count !== searchTotal || result.distinctCount !== searchTotal || result.minNo !== 1 || result.maxNo !== searchTotal ||
      result.completedPages !== totalPages || result.failedPages !== 0 || result.diagnostics !== 0 || result.foreignKeyViolations !== 0) {
    throw new Error(`Production integrity failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function legacyRecord(row: Record<string, unknown>): CertificationRecord {
  let raw: Record<string, unknown> = {};
  try { raw = JSON.parse(String(row.raw_json)) as Record<string, unknown>; } catch { /* raw_json is still preserved below */ }
  return {
    sourceRowNo: row.source_row_no === null ? null : Number(row.source_row_no),
    certificationType: String(row.certification_type),
    certificationNo: row.certification_no === null ? null : String(row.certification_no),
    productName: row.product_name === null ? null : String(row.product_name),
    companyName: String(row.company_name),
    representativeName: row.representative_name === null ? null : String(row.representative_name),
    addressRaw: row.address_raw === null ? null : String(row.address_raw),
    certificationStartDateRaw: String(raw.rawStartDate ?? row.certification_start_date ?? ""),
    certificationEndDateRaw: String(raw.rawEndDate ?? row.certification_end_date ?? ""),
    certificationStartDate: row.certification_start_date === null ? null : String(row.certification_start_date),
    certificationEndDate: row.certification_end_date === null ? null : String(row.certification_end_date),
    isCurrentlyValid: row.is_currently_valid === null ? null : Number(row.is_currently_valid) === 1,
    historicalCertification: row.historical_certification === null ? null : Number(row.historical_certification) === 1,
    isUnlimitedEndDate: Number(row.is_unlimited_end_date) === 1,
    imageUrl: row.image_url === null ? null : String(row.image_url),
    sourcePageNo: Number(row.source_page_no),
    businessRegistrationNo: null, companyIdentifier: null, detailedItemName: null, detailedItemCode: null,
    sourceSeqNo: null, detailUrl: null, rawJson: String(row.raw_json), collectedAt: String(row.collected_at),
  };
}

export function backfillOccurrenceRun(db: DatabaseSync, runId: number): number {
  const sourceCount = Number((db.prepare("SELECT COUNT(*) count FROM certification_records WHERE run_id=?").get(runId) as { count: number }).count);
  if (sourceCount === 0) throw new Error(`No legacy certification_records found for run ${runId}`);
  const existingCount = Number((db.prepare("SELECT COUNT(*) count FROM certification_snapshot_occurrences WHERE run_id=?").get(runId) as { count: number }).count);
  if (existingCount !== 0 && existingCount !== sourceCount) {
    throw new Error(`Refusing partial backfill for run ${runId}: source=${sourceCount} occurrences=${existingCount}`);
  }
  if (existingCount === sourceCount) {
    refreshOccurrenceDerivedFields(db, runId);
    return 0;
  }
  const rows = db.prepare("SELECT * FROM certification_records WHERE run_id=? ORDER BY source_page_no,source_row_no").all(runId) as Record<string, unknown>[];
  const insert = occurrenceInsert(db);
  const createdAt = now();
  db.exec("BEGIN");
  try {
    let inserted = 0;
    for (const row of rows) {
      const record = legacyRecord(row);
      inserted += Number(insert.run(...occurrenceValues(runId, record, createdAt)).changes);
    }
    if (inserted !== sourceCount) throw new Error(`Backfill count mismatch: expected=${sourceCount} inserted=${inserted}`);
    db.exec("COMMIT");
    return inserted;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function refreshOccurrenceDerivedFields(db: DatabaseSync, runId: number): number {
  const types = db.prepare("SELECT DISTINCT certification_type FROM certification_snapshot_occurrences WHERE run_id=?").all(runId) as Array<{ certification_type: string }>;
  const update = db.prepare("UPDATE certification_snapshot_occurrences SET source_certification_code=? WHERE run_id=? AND certification_type=?");
  db.exec("BEGIN");
  try {
    let changed = 0;
    for (const row of types) changed += Number(update.run(sourceCertificationCodeFor(row.certification_type), runId, row.certification_type).changes);
    db.exec("COMMIT");
    return changed;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function verifyOccurrenceBackfill(db: DatabaseSync, runId: number) {
  const source = db.prepare(`SELECT COUNT(*) count,COUNT(DISTINCT source_row_no) distinct_count,
    MIN(source_row_no) min_no,MAX(source_row_no) max_no FROM certification_records WHERE run_id=?`).get(runId) as Record<string, number>;
  const occurrence = db.prepare(`SELECT COUNT(*) count,COUNT(DISTINCT source_row_no) distinct_count,
    MIN(source_row_no) min_no,MAX(source_row_no) max_no,SUM(is_unlimited=1) unlimited_count,
    SUM(status_unknown=1) unknown_count FROM certification_snapshot_occurrences WHERE run_id=?`).get(runId) as Record<string, number>;
  const fieldDifferences = Number((db.prepare(`SELECT COUNT(*) count FROM (
    SELECT source_page_no,source_row_no,certification_type,certification_no,company_name,product_name,certification_start_date,certification_end_date
      FROM certification_records WHERE run_id=?
    EXCEPT
    SELECT source_page_no,source_row_no,certification_type,certification_no,company_name_raw,certification_subject_name,certification_start_date,certification_end_date
      FROM certification_snapshot_occurrences WHERE run_id=?
  )`).get(runId, runId) as { count: number }).count);
  const reverseFieldDifferences = Number((db.prepare(`SELECT COUNT(*) count FROM (
    SELECT source_page_no,source_row_no,certification_type,certification_no,company_name_raw,certification_subject_name,certification_start_date,certification_end_date
      FROM certification_snapshot_occurrences WHERE run_id=?
    EXCEPT
    SELECT source_page_no,source_row_no,certification_type,certification_no,company_name,product_name,certification_start_date,certification_end_date
      FROM certification_records WHERE run_id=?
  )`).get(runId, runId) as { count: number }).count);
  const visibleIdentical = Number((db.prepare(`SELECT COUNT(*) count FROM certification_snapshot_occurrences WHERE run_id=?
    AND certification_type='우수조달공동상표' AND certification_no='2023001' AND company_name_raw='코머신'
    AND certification_subject_name='무대장치' AND certification_start_date='2023-08-31' AND certification_end_date='2026-08-30'`).get(runId) as { count: number }).count);
  const cases = {
    industry: Number((db.prepare("SELECT COUNT(*) count FROM certification_snapshot_occurrences WHERE run_id=? AND certification_type='산업융합품목' AND certification_no='제2020-693호'").get(runId) as {count:number}).count),
    net201411: Number((db.prepare("SELECT COUNT(*) count FROM certification_snapshot_occurrences WHERE run_id=? AND certification_type='NET' AND certification_no='20-1411'").get(runId) as {count:number}).count),
    net53067: Number((db.prepare("SELECT COUNT(*) count FROM certification_snapshot_occurrences WHERE run_id=? AND certification_type='NET' AND certification_no='53-067' AND company_name_raw='(주)지디티'").get(runId) as {count:number}).count),
    jointMark: Number((db.prepare("SELECT COUNT(*) count FROM certification_snapshot_occurrences WHERE run_id=? AND certification_type='우수조달공동상표' AND certification_no='2022009' AND company_name_raw='펌프로'").get(runId) as {count:number}).count),
  };
  const result = { source, occurrence, fieldDifferences, reverseFieldDifferences, visibleIdentical, cases };
  if (source.count !== occurrence.count || source.distinct_count !== occurrence.distinct_count || source.min_no !== occurrence.min_no ||
    source.max_no !== occurrence.max_no || fieldDifferences !== 0 || reverseFieldDifferences !== 0 || visibleIdentical !== 27 ||
    cases.industry !== 82 || cases.net201411 !== 68 || cases.net53067 !== 10 || cases.jointMark !== 39) {
    throw new Error(`Occurrence backfill integrity failed: ${JSON.stringify(result)}`);
  }
  return result;
}
