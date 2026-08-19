use rusqlite::{Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use std::{
    env,
    fs,
    io::{BufRead, BufReader},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};
#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
struct CollectorChild {
    child: Child,
}

#[cfg(not(windows))]
struct CollectorChild {
    child: Child,
}

struct CollectorProcess(Mutex<Option<CollectorChild>>);

impl CollectorChild {
    fn new(child: Child) -> Result<Self, String> {
        Ok(Self { child })
    }

    fn terminate(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for CollectorChild {
    fn drop(&mut self) {
        self.terminate();
    }
}

fn terminate_collector(process: &CollectorProcess) {
    if let Ok(mut guard) = process.0.lock() {
        if let Some(mut owned) = guard.take() {
            owned.terminate();
        }
    }
}

fn project_root() -> PathBuf {
    if let Ok(dir) = env::var("MONA_CERTIFICATION_ROOT") {
        return PathBuf::from(dir);
    }
    if let Ok(cwd) = env::current_dir() {
        if cwd.join("collector/src/main.ts").is_file() {
            return cwd;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn db_path() -> Result<PathBuf, String> {
    let local_app_data = env::var_os("LOCALAPPDATA")
        .ok_or_else(|| "LOCALAPPDATA is not set".to_string())?;
    let data_dir = PathBuf::from(local_app_data)
        .join("com.monaradar.certification")
        .join("data");
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let path = data_dir.join("mona-radar-certification.sqlite");
    if !path.is_file() {
        return Err(format!(
            "SQLite database not found at {}. Run the collector first.",
            path.display()
        ));
    }
    Ok(path)
}

fn open_connection() -> Result<Connection, String> {
    let conn = Connection::open(db_path()?).map_err(|e| e.to_string())?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "foreign_keys", true)
        .map_err(|e| e.to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS certification_corrections (
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
         END;",
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

fn preferred_run_id(conn: &Connection) -> Result<i64, String> {
    let production_run_id: Option<i64> = conn
        .query_row(
            "SELECT id FROM collection_runs
             WHERE status = 'completed'
               AND (source_mode = 'production_v2' OR source_mode = 'production_v1' OR source_mode LIKE 'production%')
             ORDER BY id DESC
             LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(id) = production_run_id {
        return Ok(id);
    }

    let completed_run_id: Option<i64> = conn
        .query_row(
            "SELECT id FROM collection_runs
             WHERE status = 'completed'
             ORDER BY id DESC
             LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(id) = completed_run_id {
        return Ok(id);
    }

    conn.query_row(
        "SELECT id FROM collection_runs
         ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'interrupted' THEN 1 ELSE 2 END,
                  id DESC
         LIMIT 1",
        [],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "No collection runs found in database.".to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DbInfo {
    path: String,
    run_id: i64,
    run_status: String,
    record_count: i64,
}

#[tauri::command]
fn database_info() -> Result<DbInfo, String> {
    let conn = open_connection()?;
    let run_id = preferred_run_id(&conn)?;
    let run_status: String = conn
        .query_row(
            "SELECT status FROM collection_runs WHERE id = ?",
            [run_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let record_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM certification_records WHERE run_id = ?",
            [run_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(DbInfo {
        path: db_path()?.display().to_string(),
        run_id,
        run_status,
        record_count,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchFilters {
    company_name: Option<String>,
    certification_no: Option<String>,
    certification_type: Option<String>,
    certification_subject_name: Option<String>,
    status: Option<String>,
    page: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CertificationRow {
    id: i64,
    certification_type: String,
    certification_no: Option<String>,
    company_name: String,
    certification_subject_name: Option<String>,
    certification_start_date: Option<String>,
    certification_end_date: Option<String>,
    is_unlimited: bool,
    status_class: String,
    status_unknown: bool,
    company_name_corrected: bool,
    product_name_corrected: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CertificationCorrection {
    field_name: String,
    corrected_value: String,
    source_url: String,
    reason: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CertificationDetail {
    row: CertificationRow,
    original_company_name: String,
    original_product_name: Option<String>,
    corrections: Vec<CertificationCorrection>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveCorrectionInput {
    record_id: i64,
    field_name: String,
    corrected_value: String,
    source_url: String,
    reason: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteCorrectionInput {
    record_id: i64,
    field_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchResponse {
    rows: Vec<CertificationRow>,
    total: i64,
    page: i64,
    total_pages: i64,
    run_id: i64,
}

fn map_row(row: &Row<'_>) -> rusqlite::Result<CertificationRow> {
    Ok(CertificationRow {
        id: row.get("id")?,
        certification_type: row.get("certification_type")?,
        certification_no: row.get("certification_no")?,
        company_name: row.get("company_name")?,
        certification_subject_name: row.get("certification_subject_name")?,
        certification_start_date: row.get("certification_start_date")?,
        certification_end_date: row.get("certification_end_date")?,
        is_unlimited: row.get::<_, i64>("is_unlimited")? == 1,
        status_class: row.get("status_class")?,
        status_unknown: row.get::<_, i64>("status_unknown")? == 1,
        company_name_corrected: row.get::<_, i64>("company_name_corrected")? == 1,
        product_name_corrected: row.get::<_, i64>("product_name_corrected")? == 1,
    })
}

const EFFECTIVE_RECORDS_SQL: &str = "WITH effective_records AS (
    SELECT r.*,
           COALESCE(company.corrected_value, r.company_name) AS effective_company_name,
           COALESCE(product.corrected_value, r.product_name) AS effective_product_name,
           CASE WHEN company.id IS NULL THEN 0 ELSE 1 END AS company_name_corrected,
           CASE WHEN product.id IS NULL THEN 0 ELSE 1 END AS product_name_corrected
    FROM certification_records r
    LEFT JOIN certification_corrections company
      ON company.certification_type = r.certification_type
     AND company.certification_no = r.certification_no
     AND company.field_name = 'company_name'
    LEFT JOIN certification_corrections product
      ON product.certification_type = r.certification_type
     AND product.certification_no = r.certification_no
     AND product.field_name = 'product_name'
)";

#[tauri::command]
fn certification_detail(id: i64) -> Result<Option<CertificationDetail>, String> {
    let conn = open_connection()?;
    let run_id = preferred_run_id(&conn)?;
    let sql = format!(
        "{EFFECTIVE_RECORDS_SQL}
         SELECT id, certification_type, certification_no, effective_company_name AS company_name,
                effective_product_name AS certification_subject_name, certification_start_date,
                certification_end_date, is_unlimited_end_date AS is_unlimited,
                CASE WHEN is_unlimited_end_date = 1 OR is_currently_valid = 1 THEN 'current'
                     WHEN historical_certification = 1 THEN 'historical' ELSE 'unknown' END AS status_class,
                CASE WHEN is_unlimited_end_date = 0 AND is_currently_valid IS NOT 1
                          AND historical_certification IS NOT 1 THEN 1 ELSE 0 END AS status_unknown,
                company_name_corrected, product_name_corrected, company_name AS original_company_name,
                product_name AS original_product_name
         FROM effective_records WHERE run_id = ? AND id = ?"
    );
    let detail = conn
        .query_row(&sql, rusqlite::params![run_id, id], |row| {
            Ok((
                map_row(row)?,
                row.get::<_, String>("original_company_name")?,
                row.get::<_, Option<String>>("original_product_name")?,
            ))
        })
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((row, original_company_name, original_product_name)) = detail else {
        return Ok(None);
    };
    let mut stmt = conn
        .prepare(
            "SELECT field_name, corrected_value, source_url, reason
             FROM certification_corrections
             WHERE certification_type = ? AND certification_no = ?
               AND field_name IN ('company_name', 'product_name')
             ORDER BY field_name",
        )
        .map_err(|e| e.to_string())?;
    let corrections = stmt
        .query_map(
            rusqlite::params![row.certification_type, row.certification_no],
            |correction| {
                Ok(CertificationCorrection {
                    field_name: correction.get(0)?,
                    corrected_value: correction.get(1)?,
                    source_url: correction.get(2)?,
                    reason: correction.get(3)?,
                })
            },
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(Some(CertificationDetail {
        row,
        original_company_name,
        original_product_name,
        corrections,
    }))
}

fn correction_target(
    conn: &Connection,
    record_id: i64,
    field_name: &str,
) -> Result<(String, String), String> {
    if !matches!(field_name, "company_name" | "product_name") {
        return Err("보정 필드는 company_name 또는 product_name만 허용됩니다.".to_string());
    }
    let run_id = preferred_run_id(conn)?;
    conn.query_row(
        "SELECT certification_type, certification_no FROM certification_records
         WHERE run_id = ? AND id = ? AND certification_no IS NOT NULL",
        rusqlite::params![run_id, record_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "보정할 인증 레코드를 찾을 수 없습니다.".to_string())
}

#[tauri::command]
fn save_certification_correction(input: SaveCorrectionInput) -> Result<(), String> {
    let corrected_value = input.corrected_value.trim();
    let source_url = input.source_url.trim();
    let reason = input.reason.trim();
    if corrected_value.is_empty() || source_url.is_empty() || reason.is_empty() {
        return Err("보정값, 출처 URL, 보정 사유를 모두 입력하세요.".to_string());
    }
    let conn = open_connection()?;
    let (certification_type, certification_no) =
        correction_target(&conn, input.record_id, &input.field_name)?;
    conn.execute(
        "INSERT INTO certification_corrections
           (certification_type, certification_no, field_name, corrected_value, source_url, reason)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(certification_type, certification_no, field_name) DO UPDATE SET
           corrected_value = excluded.corrected_value,
           source_url = excluded.source_url,
           reason = excluded.reason,
           updated_at = CURRENT_TIMESTAMP",
        rusqlite::params![
            certification_type,
            certification_no,
            input.field_name,
            corrected_value,
            source_url,
            reason
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_certification_correction(input: DeleteCorrectionInput) -> Result<(), String> {
    let conn = open_connection()?;
    let (certification_type, certification_no) =
        correction_target(&conn, input.record_id, &input.field_name)?;
    conn.execute(
        "DELETE FROM certification_corrections
         WHERE certification_type = ? AND certification_no = ? AND field_name = ?",
        rusqlite::params![certification_type, certification_no, input.field_name],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn search_certifications(filters: SearchFilters) -> Result<SearchResponse, String> {
    let conn = open_connection()?;
    let run_id = preferred_run_id(&conn)?;
    let page = filters.page.unwrap_or(1).max(1);
    let per_page = 50;
    let offset = (page - 1) * per_page;

    let mut where_parts = vec!["run_id = ?".to_string()];
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(run_id)];

    if let Some(value) = filters
        .company_name
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        where_parts.push("effective_company_name LIKE ?".to_string());
        values.push(Box::new(format!("%{value}%")));
    }
    if let Some(value) = filters
        .certification_no
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        where_parts.push("certification_no LIKE ?".to_string());
        values.push(Box::new(format!("%{value}%")));
    }
    if let Some(value) = filters
        .certification_type
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        where_parts.push("certification_type = ?".to_string());
        values.push(Box::new(value.to_string()));
    }
    if let Some(value) = filters
        .certification_subject_name
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        where_parts.push("effective_product_name LIKE ?".to_string());
        values.push(Box::new(format!("%{value}%")));
    }
    if let Some(status) = filters.status.as_deref() {
        match status {
            "current" => where_parts.push("(is_unlimited_end_date = 1 OR is_currently_valid = 1)".to_string()),
            "historical" => where_parts.push("(is_unlimited_end_date = 0 AND is_currently_valid IS NOT 1 AND historical_certification = 1)".to_string()),
            "unlimited" => where_parts.push("is_unlimited_end_date = 1".to_string()),
            "unknown" => {
                where_parts.push("(is_unlimited_end_date = 0 AND is_currently_valid IS NOT 1 AND historical_certification IS NOT 1)".to_string())
            }
            _ => {}
        }
    }

    let where_sql = where_parts.join(" AND ");
    let count_sql = format!(
        "{EFFECTIVE_RECORDS_SQL} SELECT COUNT(*) FROM effective_records WHERE {where_sql}"
    );
    let total: i64 = conn
        .query_row(
            &count_sql,
            rusqlite::params_from_iter(values.iter().map(|v| v.as_ref())),
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let query_sql = format!(
        "{EFFECTIVE_RECORDS_SQL}
         SELECT id, certification_type, certification_no, effective_company_name AS company_name,
                effective_product_name AS certification_subject_name, certification_start_date, certification_end_date,
                is_unlimited_end_date AS is_unlimited,
                CASE WHEN is_unlimited_end_date = 1 OR is_currently_valid = 1 THEN 'current'
                     WHEN historical_certification = 1 THEN 'historical' ELSE 'unknown' END AS status_class,
                CASE WHEN is_unlimited_end_date = 0 AND is_currently_valid IS NOT 1
                          AND historical_certification IS NOT 1 THEN 1 ELSE 0 END AS status_unknown,
                company_name_corrected, product_name_corrected
         FROM effective_records
         WHERE {where_sql}
         ORDER BY certification_type, effective_company_name, certification_no
         LIMIT ? OFFSET ?"
    );
    let mut query_values = values;
    query_values.push(Box::new(per_page));
    query_values.push(Box::new(offset));

    let mut stmt = conn.prepare(&query_sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(
            rusqlite::params_from_iter(query_values.iter().map(|v| v.as_ref())),
            map_row,
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let total_pages = if total == 0 {
        1
    } else {
        (total + per_page - 1) / per_page
    };

    Ok(SearchResponse {
        rows,
        total,
        page,
        total_pages,
        run_id,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FilterOptions {
    certification_types: Vec<String>,
}

#[tauri::command]
fn filter_options() -> Result<FilterOptions, String> {
    let conn = open_connection()?;
    let run_id = preferred_run_id(&conn)?;
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT certification_type
             FROM certification_records
             WHERE run_id = ?
             ORDER BY certification_type COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;
    let certification_types = stmt
        .query_map([run_id], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<String>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(FilterOptions { certification_types })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CollectorStatus {
    process_running: bool,
    run_id: Option<i64>,
    run_status: Option<String>,
    current_page: i64,
    total_pages: i64,
    rows_inserted: i64,
    resumed: bool,
    search_total: Option<i64>,
    page_unit: Option<i64>,
    source_mode: Option<String>,
    error_summary: Option<String>,
}

#[tauri::command]
fn collector_status(state: State<CollectorProcess>) -> Result<CollectorStatus, String> {
    let process_running = match state.0.lock() {
        Ok(mut guard) => match guard.as_mut() {
            Some(owned) => match owned.child.try_wait() {
                Ok(status) => status.is_none(),
                Err(_) => false,
            },
            None => false,
        },
        Err(_) => false,
    };

    let conn = open_connection()?;
    let row = conn
        .query_row(
            "SELECT id, status, last_completed_page, rows_inserted, search_total, page_unit,
                    source_mode, error_summary
             FROM collection_runs
             ORDER BY id DESC
             LIMIT 1",
            [],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                    row.get::<_, Option<i64>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let (
        run_id,
        run_status,
        last_completed_page,
        rows_inserted,
        search_total,
        page_unit,
        source_mode,
        error_summary,
    ) = match row {
        Some(values) => values,
        None => {
            return Ok(CollectorStatus {
                process_running,
                run_id: None,
                run_status: None,
                current_page: 0,
                total_pages: 0,
                rows_inserted: 0,
                resumed: false,
                search_total: None,
                page_unit: None,
                source_mode: None,
                error_summary: None,
            });
        }
    };

    let unit = page_unit.unwrap_or(100).max(1);
    let total_pages = search_total
        .map(|total| (total + unit - 1) / unit)
        .unwrap_or(0);
    let current_page = if process_running || run_status == "running" {
        (last_completed_page + 1).min(total_pages.max(1))
    } else {
        last_completed_page
    };

    Ok(CollectorStatus {
        process_running,
        run_id: Some(run_id),
        run_status: Some(run_status),
        current_page,
        total_pages,
        rows_inserted,
        resumed: last_completed_page > 0,
        search_total,
        page_unit: Some(unit),
        source_mode,
        error_summary,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartCollectorArgs {
    new_run: Option<bool>,
    production: Option<bool>,
    latest: Option<bool>,
    page_unit: Option<i64>,
    stop_after_page: Option<i64>,
}

fn resolve_node() -> Result<PathBuf, String> {
    if let Ok(path) = env::var("MONA_NODE") {
        return Ok(PathBuf::from(path));
    }
    which_node("node").ok_or_else(|| {
        "Node.js not found in PATH. Install Node 24+ or set MONA_NODE.".to_string()
    })
}

fn which_node(binary: &str) -> Option<PathBuf> {
    let path_var = env::var_os("PATH")?;
    env::split_paths(&path_var)
        .map(|dir| dir.join(binary))
        .find(|candidate| {
            candidate.is_file()
                || candidate.with_extension("exe").is_file()
                || candidate.with_extension("cmd").is_file()
        })
        .or_else(|| {
            let fallback = PathBuf::from(binary);
            if fallback.is_file() {
                Some(fallback)
            } else {
                None
            }
        })
}

fn spawn_log_threads(app: AppHandle, stdout: Option<std::process::ChildStdout>, stderr: Option<std::process::ChildStderr>) {
    if let Some(stdout) = stdout {
        let handle = app.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let _ = handle.emit(
                    "collector-event",
                    serde_json::json!({"type":"log","message": line}),
                );
            }
        });
    }
    if let Some(stderr) = stderr {
        let handle = app.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if line.contains("ExperimentalWarning") {
                    continue;
                }
                let _ = handle.emit(
                    "collector-event",
                    serde_json::json!({"type":"error","message": line}),
                );
            }
        });
    }
}

#[tauri::command]
fn start_collector(
    app: AppHandle,
    state: State<CollectorProcess>,
    args: StartCollectorArgs,
) -> Result<(), String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "collector lock poisoned".to_string())?;
    if let Some(owned) = guard.as_mut() {
        if owned.child.try_wait().map_err(|e| e.to_string())?.is_none() {
            return Err("Collector is already running.".to_string());
        }
    }
    guard.take();

    let root = project_root();
    let main_script = root.join("collector/src/main.ts");
    if !main_script.is_file() {
        return Err(format!(
            "Collector entry not found at {}",
            main_script.display()
        ));
    }

    let page_unit = args.page_unit.unwrap_or(100);
    if page_unit != 15 && page_unit != 100 {
        return Err("pageUnit must be 15 or 100".to_string());
    }

    let mut command = Command::new(resolve_node()?);
    command
        .arg("--experimental-strip-types")
        .arg(&main_script)
        .arg(format!("--page-unit={page_unit}"))
        .current_dir(&root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if args.new_run.unwrap_or(false) {
        command.arg("--new-run");
    }
    if args.production.unwrap_or(false) {
        command.arg("--production");
    }
    if args.latest.unwrap_or(false) {
        command.arg("--latest");
    }
    if let Some(stop_after) = args.stop_after_page {
        command.arg(format!("--stop-after-page={stop_after}"));
    }

    #[cfg(windows)]
    command.creation_flags(0x08000000);

    let mut child = command
        .spawn()
        .map_err(|e| format!("collector start failed: {e}"))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    spawn_log_threads(app.clone(), stdout, stderr);
    let _ = app.emit(
        "collector-event",
        serde_json::json!({"type":"status","message":"Collector process started"}),
    );
    *guard = Some(CollectorChild::new(child)?);
    Ok(())
}

#[tauri::command]
fn stop_collector(state: State<CollectorProcess>) -> Result<(), String> {
    let maybe_run_id: Option<i64> = {
        let conn = open_connection()?;
        conn.query_row(
            "SELECT id FROM collection_runs WHERE status IN ('running','interrupted') ORDER BY id DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
    };
    if let Some(run_id) = maybe_run_id {
        let conn = open_connection()?;
        let updated_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        conn.execute(
            "UPDATE collection_runs SET status='interrupted', updated_at=?, error_summary='stopped_by_user' WHERE id=?",
            rusqlite::params![updated_at, run_id],
        )
        .map_err(|e| e.to_string())?;
    }
    terminate_collector(state.inner());
    Ok(())
}


#[tauri::command]
fn pause_collector(state: State<CollectorProcess>) -> Result<(), String> {
    let maybe_run_id: Option<i64> = {
        let conn = open_connection()?;
        conn.query_row(
            "SELECT id FROM collection_runs WHERE status IN ('running','interrupted') ORDER BY id DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
    };
    if let Some(run_id) = maybe_run_id {
        let conn = open_connection()?;
        let updated_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        conn.execute(
            "UPDATE collection_runs SET status='interrupted', updated_at=? WHERE id=?",
            rusqlite::params![updated_at, run_id],
        )
        .map_err(|e| e.to_string())?;
    }
    terminate_collector(state.inner());
    Ok(())
}

#[tauri::command]
fn collector_process_running(state: State<CollectorProcess>) -> Result<bool, String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "collector lock poisoned".to_string())?;
    Ok(match guard.as_mut() {
        Some(owned) => owned.child.try_wait().map_err(|e| e.to_string())?.is_none(),
        None => false,
    })
}

#[cfg(test)]
mod search_tests {
    use super::*;

    #[test]
    fn search_returns_rows_from_existing_db() {
        if db_path().is_err() {
            return;
        }
        let response = search_certifications(SearchFilters {
            company_name: None,
            certification_no: None,
            certification_type: None,
            certification_subject_name: None,
            status: None,
            page: Some(1),
        })
        .expect("search should succeed when db exists");
        assert!(response.total > 0, "expected occurrences in db");
        assert!(!response.rows.is_empty(), "expected at least one row");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(CollectorProcess(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            database_info,
            search_certifications,
            certification_detail,
            save_certification_correction,
            delete_certification_correction,
            filter_options,
            collector_status,
            start_collector,
            pause_collector,
            stop_collector,
            collector_process_running
        ])
        .build(tauri::generate_context!())
        .expect("error while building MONA RADAR Certification");
    app.run(|handle, event| {
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            terminate_collector(handle.state::<CollectorProcess>().inner());
        }
    });
}
