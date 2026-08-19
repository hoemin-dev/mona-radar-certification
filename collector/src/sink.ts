import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.ts";
import type { CertificationRecord, CollectionRun, RowParseFailure } from "./types.ts";
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
    CREATE TABLE IF NOT EXISTS certification_corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      certification_type TEXT NOT NULL,
      certification_no TEXT NOT NULL,
      field_name TEXT NOT NULL,
      corrected_value TEXT NOT NULL,
      source_url TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(certification_type, certification_no, field_name)
    );
    CREATE TRIGGER IF NOT EXISTS certification_corrections_touch_updated_at
    AFTER UPDATE ON certification_corrections
    FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
    BEGIN
      UPDATE certification_corrections
      SET updated_at = CURRENT_TIMESTAMP
      WHERE id = NEW.id;
    END;
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

export function commitPage(db: DatabaseSync, runId: number, page: {
  pageNo: number; searchTotal: number; rowsFound: number; rowsParsed: number;
  firstNo: number | null; lastNo: number | null; records: CertificationRecord[];
  failures: RowParseFailure[];
}, injectFailure = false, pageStartedAt = Date.now()): { inserted: number; elapsedMs: number } {
  if (page.failures.length !== 0) throw new Error("Cannot complete a page with parsing diagnostics");
  const unmappedTypes = [...new Set(page.records
    .filter((record) => sourceCertificationCodeFor(record.certificationType) === null)
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

export function completeProductionRun(db: DatabaseSync, runId: number): void {
  const run = db.prepare("SELECT source_mode FROM collection_runs WHERE id=?").get(runId) as { source_mode: string } | undefined;
  if (!run?.source_mode.startsWith("production")) {
    throw new Error(`Run ${runId} is not a production run`);
  }

  const timestamp = now();
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE collection_runs SET status='completed',updated_at=?,completed_at=?,error_summary=NULL WHERE id=?")
      .run(timestamp, timestamp, runId);
    db.prepare("DELETE FROM certification_records WHERE run_id<>?").run(runId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
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
