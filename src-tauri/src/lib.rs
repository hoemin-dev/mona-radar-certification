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

fn backup_dir() -> PathBuf {
    project_root().join("collector/data/backups")
}

fn now_iso() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let timestamp = secs / 1000;
    let nanos = (secs % 1000) as u32;
    format!("{timestamp:013}.{nanos:03}")
}

fn backup_db_file() -> Result<PathBuf, String> {
    let src = db_path()?;
    let dir = backup_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ts = now_iso();
    let dst = dir.join(format!("mona-radar-certification-{ts}.sqlite"));
    fs::copy(&src, &dst).map_err(|e| e.to_string())?;
    for suffix in ["-wal", "-shm"] {
        let wal_src = src.with_extension(format!("sqlite{suffix}"));
        let wal_dst = dst.with_extension(format!("sqlite{suffix}"));
        if wal_src.is_file() {
            let _ = fs::copy(&wal_src, &wal_dst);
        }
    }
    Ok(dst)
}

fn open_connection() -> Result<Connection, String> {
    let conn = Connection::open(db_path()?).map_err(|e| e.to_string())?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "foreign_keys", true)
        .map_err(|e| e.to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
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
    occurrence_count: i64,
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
    let occurrence_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM certification_snapshot_occurrences WHERE run_id = ?",
            [run_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(DbInfo {
        path: db_path()?.display().to_string(),
        run_id,
        run_status,
        occurrence_count,
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
        company_name: row.get("company_name_raw")?,
        certification_subject_name: row.get("certification_subject_name")?,
        certification_start_date: row.get("certification_start_date")?,
        certification_end_date: row.get("certification_end_date")?,
        is_unlimited: row.get::<_, i64>("is_unlimited")? == 1,
        status_class: row.get("status_class")?,
        status_unknown: row.get::<_, i64>("status_unknown")? == 1,
    })
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
        where_parts.push("company_name_raw LIKE ?".to_string());
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
        where_parts.push("certification_subject_name LIKE ?".to_string());
        values.push(Box::new(format!("%{value}%")));
    }
    if let Some(status) = filters.status.as_deref() {
        match status {
            "current" => where_parts.push("status_class = 'current'".to_string()),
            "historical" => where_parts.push("status_class = 'historical'".to_string()),
            "unlimited" => where_parts.push("is_unlimited = 1".to_string()),
            "unknown" => {
                where_parts.push("(status_unknown = 1 OR status_class = 'unknown')".to_string())
            }
            _ => {}
        }
    }

    let where_sql = where_parts.join(" AND ");
    let count_sql = format!(
        "SELECT COUNT(*) FROM certification_snapshot_occurrences WHERE {where_sql}"
    );
    let total: i64 = conn
        .query_row(
            &count_sql,
            rusqlite::params_from_iter(values.iter().map(|v| v.as_ref())),
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let query_sql = format!(
        "SELECT id, certification_type, certification_no, company_name_raw,
                certification_subject_name, certification_start_date, certification_end_date,
                is_unlimited, status_class, status_unknown
         FROM certification_snapshot_occurrences
         WHERE {where_sql}
         ORDER BY certification_type, company_name_raw, certification_no
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
             FROM certification_snapshot_occurrences
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DbBackup {
    name: String,
    path: String,
}

#[tauri::command]
fn database_backups() -> Result<Vec<DbBackup>, String> {
    let dir = backup_dir();
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut entries = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_name()?.to_string_lossy().to_string();
            if path.is_file() && name.ends_with(".sqlite") {
                Some(DbBackup {
                    name: name.clone(),
                    path: path.display().to_string(),
                })
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    entries.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(entries)
}

#[tauri::command]
fn backup_database() -> Result<DbBackup, String> {
    let path = backup_db_file()?;
    Ok(DbBackup {
        name: path.file_name().unwrap().to_string_lossy().to_string(),
        path: path.display().to_string(),
    })
}

#[tauri::command]
fn restore_database(backup_name: String) -> Result<String, String> {
    let dir = backup_dir();
    let src = dir.join(&backup_name);
    if !src.is_file() {
        return Err(format!("Backup file not found: {}", backup_name));
    }
    let _ = backup_db_file()?;
    let target = db_path()?;
    fs::copy(&src, &target).map_err(|e| e.to_string())?;
    for suffix in ["-wal", "-shm"] {
        let backup_src = src.with_extension(format!("sqlite{suffix}"));
        let target_src = target.with_extension(format!("sqlite{suffix}"));
        if backup_src.is_file() {
            let _ = fs::copy(&backup_src, &target_src);
        }
    }
    Ok(target.display().to_string())
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
            filter_options,
            collector_status,
            start_collector,
            pause_collector,
            stop_collector,
            database_backups,
            backup_database,
            restore_database,
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
