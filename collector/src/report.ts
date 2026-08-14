import { DatabaseSync } from "node:sqlite";
import { config } from "./config.ts";

const runIdArg = process.argv.find((arg) => arg.startsWith("--run-id="))?.split("=", 2)[1];
if (!runIdArg) throw new Error("--run-id is required");
const runId = Number(runIdArg);
const db = new DatabaseSync(config.dbPath, { readOnly: true });

console.log("run", db.prepare(`SELECT id,status,source_mode,page_unit,search_over_date_yn,search_total,
  last_completed_page,rows_inserted,retry_count,started_at,completed_at FROM collection_runs WHERE id=?`).get(runId));
if (!process.argv.includes("--summary")) console.log("pages", db.prepare(`SELECT page_no,rows_found,rows_parsed,rows_inserted,
  first_no,last_no,page_elapsed_ms FROM collection_run_pages WHERE run_id=? ORDER BY page_no`).all(runId));
console.log("types", db.prepare(`SELECT certification_type,COUNT(*) count FROM certification_records
  WHERE run_id=? GROUP BY certification_type ORDER BY count DESC`).all(runId));
console.log("quality", db.prepare(`SELECT COUNT(*) total,
  SUM(certification_no IS NULL OR TRIM(certification_no)='') certification_no_empty,
  SUM(company_name IS NULL OR TRIM(company_name)='') company_name_empty,
  SUM(product_name IS NULL OR TRIM(product_name)='') product_name_empty,
  SUM(representative_name IS NULL OR TRIM(representative_name)='') representative_name_empty,
  SUM(certification_start_date IS NULL) start_date_null,
  SUM(certification_end_date IS NULL) end_date_null,
  SUM(certification_end_date='9999-12-31') unlimited_count,
  SUM(address_raw IS NULL OR TRIM(address_raw)='') address_empty
  ,SUM(historical_certification=1) historical_count
  ,SUM(is_currently_valid=1) currently_valid_count
  FROM certification_records WHERE run_id=?`).get(runId));
console.log("timing", db.prepare(`SELECT ROUND(AVG(page_elapsed_ms),2) avg_ms,
  MIN(page_elapsed_ms) min_ms,MAX(page_elapsed_ms) max_ms
  FROM collection_run_pages WHERE run_id=? AND status='completed'`).get(runId));
console.log("integrity", db.prepare(`SELECT COUNT(*) count,COUNT(DISTINCT source_row_no) distinct_count,
  MIN(source_row_no) first_no,MAX(source_row_no) last_no
  FROM certification_records WHERE run_id=?`).get(runId));
console.log("diagnostics", db.prepare("SELECT COUNT(*) count FROM collection_diagnostics WHERE run_id=?").get(runId));
console.log("foreign_keys", db.prepare("PRAGMA foreign_key_check").all());
db.close();
