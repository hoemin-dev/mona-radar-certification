import "./styles.css";
import "./search.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

type View = "search" | "dash" | "analysis" | "collector";

interface CertificationRow {
  id: number;
  certificationType: string;
  certificationNo?: string;
  companyName: string;
  certificationSubjectName?: string;
  certificationStartDate?: string;
  certificationEndDate?: string;
  isUnlimited: boolean;
  statusClass: string;
  statusUnknown: boolean;
  companyNameCorrected: boolean;
  productNameCorrected: boolean;
}

interface CertificationCorrection {
  fieldName: "company_name" | "product_name";
  correctedValue: string;
  sourceUrl: string;
  reason: string;
}

interface CertificationDetail {
  row: CertificationRow;
  originalCompanyName: string;
  originalProductName?: string;
  corrections: CertificationCorrection[];
}

interface SearchResponse {
  rows: CertificationRow[];
  total: number;
  page: number;
  totalPages: number;
  runId: number;
}

interface FilterOptions {
  certificationTypes: string[];
}

interface DbInfo {
  path: string;
  runId: number;
  runStatus: string;
  recordCount: number;
}

interface CollectorStatus {
  processRunning: boolean;
  runId?: number;
  runStatus?: string;
  currentPage: number;
  totalPages: number;
  rowsInserted: number;
  resumed: boolean;
  searchTotal?: number;
  pageUnit?: number;
  sourceMode?: string;
  errorSummary?: string;
}

const app = document.querySelector<HTMLDivElement>("#app")!;
let view: View = "search";
let dbInfo: DbInfo | undefined;
let dbError = "";
let filterOptions: FilterOptions = { certificationTypes: [] };

let companyName = "";
let certificationNo = "";
let certificationType = "";
let certificationSubjectName = "";
let statusFilter = "";
let searchData: SearchResponse = { rows: [], total: 0, page: 1, totalPages: 1, runId: 0 };
let searchError = "";
let searchTimer: number | undefined;
let searchRequestId = 0;
let selectedDetail: CertificationDetail | undefined;
let selectedCorrectionField: "company_name" | "product_name" = "company_name";
let detailError = "";

let collectorStatus: CollectorStatus = {
  processRunning: false,
  currentPage: 0,
  totalPages: 0,
  rowsInserted: 0,
  resumed: false,
};
let collectorLogs: string[] = [];
let statusPollTimer: number | undefined;

const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );

const tabIcon = (item: View) =>
  item === "search" ? "⌕" : item === "dash" ? "▦" : item === "analysis" ? "◇" : "↯";

const statusLabel = (row: CertificationRow) => {
  if (row.isUnlimited) return { text: "무기한", className: "unlimited" };
  if (row.statusUnknown || row.statusClass === "unknown") return { text: "알 수 없음", className: "unknown" };
  if (row.statusClass === "historical") return { text: "과거", className: "historical" };
  return { text: "현재", className: "current" };
};

const endDateLabel = (row: CertificationRow) =>
  row.isUnlimited ? "무기한" : escapeHtml(row.certificationEndDate ?? "—");

const correctedBadge = (corrected: boolean) =>
  corrected ? '<small class="correction-badge">보정됨</small>' : "";

const detailPanel = () => {
  if (!selectedDetail) return "";
  const { row } = selectedDetail;
  const correction = selectedDetail.corrections.find((item) => item.fieldName === selectedCorrectionField);
  const originalValue = selectedCorrectionField === "company_name"
    ? selectedDetail.originalCompanyName
    : selectedDetail.originalProductName ?? "";
  return `<section class="detail-panel" aria-label="인증 상세">
    <div class="detail-head">
      <div><p class="eyebrow">CERTIFICATION DETAIL</p><h3>${escapeHtml(row.certificationType)} · ${escapeHtml(row.certificationNo ?? "—")}</h3></div>
      <button type="button" data-action="close_detail" aria-label="상세 닫기">닫기</button>
    </div>
    <div class="detail-summary">
      <div><small>업체명 ${correctedBadge(row.companyNameCorrected)}</small><strong>${escapeHtml(row.companyName)}</strong>${row.companyNameCorrected ? `<em>원본: ${escapeHtml(selectedDetail.originalCompanyName)}</em>` : ""}</div>
      <div><small>인증대상명 ${correctedBadge(row.productNameCorrected)}</small><strong>${escapeHtml(row.certificationSubjectName ?? "—")}</strong>${row.productNameCorrected ? `<em>원본: ${escapeHtml(selectedDetail.originalProductName ?? "—")}</em>` : ""}</div>
    </div>
    <div class="correction-editor">
      <h4>원본 데이터 보정</h4>
      ${detailError ? `<p class="correction-error">${escapeHtml(detailError)}</p>` : ""}
      <div class="correction-grid">
        <label>보정 필드<select id="correction-field">
          <option value="company_name" ${selectedCorrectionField === "company_name" ? "selected" : ""}>company_name</option>
          <option value="product_name" ${selectedCorrectionField === "product_name" ? "selected" : ""}>product_name</option>
        </select></label>
        <label>원본값<input value="${escapeHtml(originalValue)}" readonly></label>
        <label>보정값<input id="correction-value" value="${escapeHtml(correction?.correctedValue ?? "")}" autocomplete="off"></label>
        <label>출처 URL<input id="correction-url" type="url" value="${escapeHtml(correction?.sourceUrl ?? "")}" autocomplete="off"></label>
        <label class="correction-reason">보정 사유<textarea id="correction-reason" rows="2">${escapeHtml(correction?.reason ?? "")}</textarea></label>
      </div>
      <div class="correction-actions">
        <button class="primary" type="button" data-action="save_correction">저장</button>
        <button class="danger" type="button" data-action="delete_correction" ${correction ? "" : "disabled"}>보정 해제</button>
      </div>
    </div>
  </section>`;
};

function setupWindowChrome() {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const appWindow = getCurrentWindow();
  const titlebar = document.querySelector<HTMLElement>("#window-titlebar");
  const minimize = document.querySelector<HTMLButtonElement>("#window-minimize");
  const maximize = document.querySelector<HTMLButtonElement>("#window-maximize");
  const maximizeIcon = document.querySelector<HTMLElement>("#window-maximize-icon");
  const close = document.querySelector<HTMLButtonElement>("#window-close");
  if (!titlebar || !minimize || !maximize || !maximizeIcon || !close) return;

  const updateMaximizeState = async () => {
    const isMaximized = await appWindow.isMaximized();
    maximizeIcon.classList.toggle("is-restore", isMaximized);
    maximize.ariaLabel = isMaximized ? "복원" : "최대화";
  };
  minimize.addEventListener("click", () => void appWindow.minimize());
  maximize.addEventListener("click", () => void appWindow.toggleMaximize().then(updateMaximizeState));
  close.addEventListener("click", () => void appWindow.close());
  titlebar.addEventListener("dblclick", (event) => {
    if ((event.target as HTMLElement).closest(".window-controls")) return;
    void appWindow.toggleMaximize().then(updateMaximizeState);
  });
  void updateMaximizeState();
  void appWindow.onResized(() => void updateMaximizeState());
}

const nav = () => `
  <aside>
    <div class="brand">
      <span>MR</span>
      <div><b>MONA RADAR</b><small>Certification</small></div>
    </div>
    <nav>
      ${(["search", "dash", "analysis", "collector"] as View[])
        .map(
          (item) => `
        <button data-view="${item}" class="${view === item ? "active" : ""}" type="button">
          <i>${tabIcon(item)}</i>${item[0]!.toUpperCase() + item.slice(1)}
        </button>`,
        )
        .join("")}
    </nav>
    <footer>LOCAL SQLITE<br><span>certification records</span></footer>
  </aside>`;

const placeholder = (name: string) => `
  <section class="page centered">
    <p class="eyebrow">COMING SOON</p>
    <div class="orb"></div>
    <h3>${escapeHtml(name)}</h3>
    <p>v0.1에서는 Search와 Collector를 우선 제공합니다.</p>
  </section>`;

const dbBanner = () => {
  if (dbError) {
    return `<div class="db-banner error"><strong>DB 연결 실패</strong> — ${escapeHtml(dbError)}</div>`;
  }
  if (!dbInfo) return "";
  return `<div class="db-banner">
    <strong>Run #${dbInfo.runId}</strong> · ${escapeHtml(dbInfo.runStatus)} ·
    ${dbInfo.recordCount.toLocaleString()}건 ·
    <span class="muted">${escapeHtml(dbInfo.path)}</span>
  </div>`;
};

const pagination = () => {
  if (searchData.totalPages <= 1) return "";
  const start = Math.max(1, searchData.page - 2);
  const end = Math.min(searchData.totalPages, start + 4);
  const pages = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  return `<nav class="pagination-controls">
    <button data-page="${searchData.page - 1}" ${searchData.page <= 1 ? "disabled" : ""}>이전</button>
    ${pages
      .map(
        (page) =>
          `<button data-page="${page}" class="${page === searchData.page ? "active" : ""}">${page}</button>`,
      )
      .join("")}
    <button data-page="${searchData.page + 1}" ${searchData.page >= searchData.totalPages ? "disabled" : ""}>다음</button>
  </nav>`;
};

const searchResults = () =>
  searchError
    ? `<div class="db-banner error">${escapeHtml(searchError)}</div>`
    : searchData.rows.length
      ? `<div class="results-table">
          <div class="results-head">
            <span>인증유형</span><span>인증번호</span><span>업체명</span><span>인증대상명</span>
            <span>시작일</span><span>종료일</span><span>상태</span>
          </div>
          ${searchData.rows
            .map((row) => {
              const status = statusLabel(row);
              return `<button type="button" class="results-row" data-record-id="${row.id}">
                <span>${escapeHtml(row.certificationType)}</span>
                <span>${escapeHtml(row.certificationNo ?? "—")}</span>
                <span>${escapeHtml(row.companyName)}${correctedBadge(row.companyNameCorrected)}</span>
                <span>${escapeHtml(row.certificationSubjectName ?? "—")}${correctedBadge(row.productNameCorrected)}</span>
                <span>${escapeHtml(row.certificationStartDate ?? "—")}</span>
                <span>${endDateLabel(row)}</span>
                <span><span class="status-pill ${status.className}">${status.text}</span></span>
              </button>`;
            })
            .join("")}
        </div>${pagination()}`
      : `<div class="empty-card"><p>${dbError ? "DB를 연결한 뒤 검색하세요." : "검색 결과가 없습니다."}</p></div>`;

const searchPage = () => `
  <section class="page">
    <header>
      <p class="eyebrow">CERTIFICATION SNAPSHOT</p>
      <h2>Search</h2>
      <p>최근 정상 완료된 Production run의 <code>certification_records</code>를 조회합니다.</p>
    </header>
    ${dbBanner()}
    ${detailPanel()}
    <div class="search-panel">
      <div class="search-grid">
        <label>업체명<input id="filter-company" value="${escapeHtml(companyName)}" autocomplete="off" placeholder="업체명 검색"></label>
        <label>인증번호<input id="filter-cert-no" value="${escapeHtml(certificationNo)}" autocomplete="off" placeholder="인증번호"></label>
        <label>인증유형
          <select id="filter-cert-type">
            <option value="">전체</option>
            ${filterOptions.certificationTypes
              .map(
                (type) =>
                  `<option value="${escapeHtml(type)}" ${certificationType === type ? "selected" : ""}>${escapeHtml(type)}</option>`,
              )
              .join("")}
          </select>
        </label>
        <label>인증대상명<input id="filter-subject" value="${escapeHtml(certificationSubjectName)}" autocomplete="off" placeholder="인증대상명"></label>
        <label>상태
          <select id="filter-status">
            <option value="">전체</option>
            <option value="current" ${statusFilter === "current" ? "selected" : ""}>현재</option>
            <option value="historical" ${statusFilter === "historical" ? "selected" : ""}>과거</option>
            <option value="unlimited" ${statusFilter === "unlimited" ? "selected" : ""}>무기한</option>
            <option value="unknown" ${statusFilter === "unknown" ? "selected" : ""}>알 수 없음</option>
          </select>
        </label>
      </div>
      <div class="search-actions">
        <button class="primary" data-action="search" type="button">검색</button>
        <button data-action="reset_search" type="button">초기화</button>
        <span class="search-meta">${searchData.total.toLocaleString()}건 · Run #${searchData.runId || "—"}</span>
      </div>
    </div>
    <div id="search-results">${searchResults()}</div>
  </section>`;

const collectorPage = () => `
  <section class="page">
    <header>
      <p class="eyebrow">SMPP COLLECTOR V2</p>
      <h2>Collector</h2>
      <p>검증된 Collector v2를 앱에서 실행하고 상태를 확인합니다. 기존 checkpoint/resume 구조를 그대로 사용합니다.</p>
    </header>
    <div class="guide"><b>안내</b><span>전체 수집 = 새 Production run</span><span>최신 자료 수집 = 마지막 완료 이후 자료</span><span>Pause/Resume = checkpoint 유지</span></div>
    <div class="status-grid">
      <article><span>프로세스</span><strong class="${collectorStatus.processRunning ? "good" : ""}">${collectorStatus.processRunning ? "실행 중" : "중지됨"}</strong><small>Node collector subprocess</small></article>
      <article><span>Run 상태</span><strong>${escapeHtml(collectorStatus.runStatus ?? "—")}</strong><small>Run #${escapeHtml(collectorStatus.runId ?? "—")}</small></article>
      <article><span>페이지</span><strong>${collectorStatus.currentPage} / ${collectorStatus.totalPages || "—"}</strong><small>${collectorStatus.searchTotal ? `총 ${collectorStatus.searchTotal.toLocaleString()}건` : "search total 대기"}</small></article>
      <article><span>수집 건수</span><strong>${collectorStatus.rowsInserted.toLocaleString()}</strong><small>Resume: <span class="${collectorStatus.resumed ? "warn" : "muted"}">${collectorStatus.resumed ? "예" : "아니오"}</span></small></article>
    </div>
    <div class="workspace">
      <div class="actions">
        <button class="primary" data-action="start_collector" type="button" ${collectorStatus.processRunning || (collectorStatus.runStatus === "interrupted" && collectorStatus.errorSummary !== "stopped_by_user") ? "disabled" : ""}>전체 수집</button>
        <button class="primary" data-action="start_latest_collector" type="button" ${collectorStatus.processRunning || (collectorStatus.runStatus === "interrupted" && collectorStatus.errorSummary !== "stopped_by_user") ? "disabled" : ""}>최신 자료 수집</button>
        <button data-action="pause_collector" type="button" ${collectorStatus.processRunning ? "" : "disabled"}>Pause</button>
        <button data-action="resume_collector" type="button" ${!collectorStatus.processRunning && collectorStatus.runStatus === "interrupted" && collectorStatus.errorSummary !== "stopped_by_user" ? "" : "disabled"}>Resume</button>
        <button data-action="stop_collector" type="button" ${collectorStatus.processRunning || (collectorStatus.runStatus === "interrupted" && collectorStatus.errorSummary !== "stopped_by_user") ? "" : "disabled"}>Stop</button>
      </div>
      ${collectorStatus.errorSummary ? `<p class="error" style="margin-top:16px">${escapeHtml(collectorStatus.errorSummary)}</p>` : ""}
      ${collectorStatus.sourceMode ? `<p class="muted" style="margin-top:8px">source_mode: ${escapeHtml(collectorStatus.sourceMode)}</p>` : ""}
    </div>
    <div class="log">
      <div class="log-head">
        <h3>최근 로그</h3>
        <div><span>${collectorLogs.length} lines</span><button type="button" data-action="copy_logs" ${collectorLogs.length ? "" : "disabled"}>전체 복사</button></div>
      </div>
      ${
        collectorLogs.length
          ? collectorLogs
              .slice(-40)
              .reverse()
              .map((line) => `<div class="event-row">${escapeHtml(line)}</div>`)
              .join("")
          : '<div class="empty">수집 방식을 선택해 시작하세요.</div>'
      }
    </div>
  </section>`;

const shell = (body: string) => `${nav()}<main>${body}</main>`;

function render() {
  const activeElement = document.activeElement as HTMLInputElement | HTMLSelectElement | null;
  const activeId = activeElement?.id;
  const selection =
    activeElement instanceof HTMLInputElement
      ? { start: activeElement.selectionStart, end: activeElement.selectionEnd }
      : undefined;
  const body =
    view === "search"
      ? searchPage()
      : view === "collector"
        ? collectorPage()
        : placeholder(view === "dash" ? "Dashboard" : "Analysis");
  app.innerHTML = shell(body);
  bind();

  if (activeId) {
    const replacement = document.getElementById(activeId) as HTMLInputElement | HTMLSelectElement | null;
    replacement?.focus({ preventScroll: true });
    if (replacement instanceof HTMLInputElement && selection && selection.start !== null && selection.end !== null) {
      replacement.setSelectionRange(selection.start, selection.end);
    }
  }
}

function readSearchFiltersFromDom() {
  companyName = document.querySelector<HTMLInputElement>("#filter-company")?.value ?? companyName;
  certificationNo = document.querySelector<HTMLInputElement>("#filter-cert-no")?.value ?? certificationNo;
  certificationType = document.querySelector<HTMLSelectElement>("#filter-cert-type")?.value ?? certificationType;
  certificationSubjectName = document.querySelector<HTMLInputElement>("#filter-subject")?.value ?? certificationSubjectName;
  statusFilter = document.querySelector<HTMLSelectElement>("#filter-status")?.value ?? statusFilter;
}

async function loadDbInfo() {
  try {
    dbInfo = await invoke<DbInfo>("database_info");
    dbError = "";
  } catch (error) {
    dbInfo = undefined;
    dbError = String(error);
  }
}

async function loadFilterOptions() {
  try {
    filterOptions = await invoke<FilterOptions>("filter_options");
  } catch {
    filterOptions = { certificationTypes: [] };
  }
}

async function loadSearch(page = 1) {
  readSearchFiltersFromDom();
  const requestId = ++searchRequestId;
  searchError = "";
  try {
    const result = await invoke<SearchResponse>("search_certifications", {
      filters: {
        companyName: companyName || null,
        certificationNo: certificationNo || null,
        certificationType: certificationType || null,
        certificationSubjectName: certificationSubjectName || null,
        status: statusFilter || null,
        page,
      },
    });
    if (requestId !== searchRequestId) return;
    searchData = result;
  } catch (error) {
    if (requestId !== searchRequestId) return;
    searchError = String(error);
    searchData = { rows: [], total: 0, page: 1, totalPages: 1, runId: 0 };
  }
  if (view === "search" && document.querySelector("#search-results")) {
    updateSearchResults();
  } else {
    render();
  }
}

async function loadDetail(id: number) {
  detailError = "";
  try {
    selectedDetail = (await invoke<CertificationDetail | null>("certification_detail", { id })) ?? undefined;
  } catch (error) {
    selectedDetail = undefined;
    searchError = String(error);
  }
  render();
}

async function refreshCollectorStatus() {
  try {
    collectorStatus = await invoke<CollectorStatus>("collector_status");
  } catch (error) {
    collectorLogs.push(`[status] ${String(error)}`);
  }
  if (view === "collector") render();
}

async function copyLogs() {
  const text = collectorLogs.join("\r\n");
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  const button = document.querySelector<HTMLButtonElement>("[data-action=copy_logs]");
  if (button) {
    button.textContent = "복사됨";
    window.setTimeout(() => {
      if (button.isConnected) button.textContent = "전체 복사";
    }, 1200);
  }
}

function scheduleSearch() {
  readSearchFiltersFromDom();
  searchRequestId += 1;
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => void loadSearch(1), 250);
}

function bindSearchResults() {
  document.querySelectorAll("[data-page]").forEach((element) => {
    element.addEventListener("click", () => {
      const page = Number((element as HTMLElement).dataset.page);
      if (!Number.isFinite(page)) return;
      void loadSearch(page);
    });
  });

  document.querySelectorAll<HTMLElement>("[data-record-id]").forEach((element) => {
    element.addEventListener("click", () => void loadDetail(Number(element.dataset.recordId)));
  });
}

function updateSearchResults() {
  const results = document.querySelector<HTMLElement>("#search-results");
  if (!results) return;
  results.innerHTML = searchResults();
  const meta = document.querySelector<HTMLElement>(".search-meta");
  if (meta) meta.textContent = `${searchData.total.toLocaleString()}건 · Run #${searchData.runId || "—"}`;
  bindSearchResults();
}

function bind() {
  document.querySelectorAll("[data-view]").forEach((element) => {
    element.addEventListener("click", () => {
      view = (element as HTMLElement).dataset.view as View;
      render();
      if (view === "search") void loadSearch(1);
      if (view === "collector") void refreshCollectorStatus();
    });
  });

  document.querySelector("[data-action=search]")?.addEventListener("click", () => void loadSearch(1));
  document.querySelector("[data-action=reset_search]")?.addEventListener("click", () => {
    companyName = "";
    certificationNo = "";
    certificationType = "";
    certificationSubjectName = "";
    statusFilter = "";
    void loadSearch(1);
  });

  ["#filter-company", "#filter-cert-no", "#filter-subject"].forEach((selector) => {
    const input = document.querySelector<HTMLInputElement>(selector);
    input?.addEventListener("input", scheduleSearch);
    input?.addEventListener("compositionstart", () => {
      searchRequestId += 1;
      window.clearTimeout(searchTimer);
    });
    input?.addEventListener("compositionend", scheduleSearch);
  });
  ["#filter-cert-type", "#filter-status"].forEach((selector) => {
    document.querySelector(selector)?.addEventListener("change", () => void loadSearch(1));
  });

  bindSearchResults();
  document.querySelector("[data-action=close_detail]")?.addEventListener("click", () => {
    selectedDetail = undefined;
    detailError = "";
    render();
  });
  document.querySelector("#correction-field")?.addEventListener("change", (event) => {
    selectedCorrectionField = (event.target as HTMLSelectElement).value as "company_name" | "product_name";
    detailError = "";
    render();
  });
  document.querySelector("[data-action=save_correction]")?.addEventListener("click", async () => {
    if (!selectedDetail) return;
    const recordId = selectedDetail.row.id;
    try {
      await invoke("save_certification_correction", {
        input: {
          recordId,
          fieldName: selectedCorrectionField,
          correctedValue: document.querySelector<HTMLInputElement>("#correction-value")?.value ?? "",
          sourceUrl: document.querySelector<HTMLInputElement>("#correction-url")?.value ?? "",
          reason: document.querySelector<HTMLTextAreaElement>("#correction-reason")?.value ?? "",
        },
      });
      await loadSearch(searchData.page);
      await loadDetail(recordId);
    } catch (error) {
      detailError = String(error);
      render();
    }
  });
  document.querySelector("[data-action=delete_correction]")?.addEventListener("click", async () => {
    if (!selectedDetail) return;
    const recordId = selectedDetail.row.id;
    try {
      await invoke("delete_certification_correction", {
        input: { recordId, fieldName: selectedCorrectionField },
      });
      await loadSearch(searchData.page);
      await loadDetail(recordId);
    } catch (error) {
      detailError = String(error);
      render();
    }
  });

  document.querySelector("[data-action=start_collector]")?.addEventListener("click", async () => {
    try {
      await invoke("start_collector", {
        args: {
          newRun: true,
          production: true,
          latest: false,
          pageUnit: 100,
          stopAfterPage: null,
        },
      });
      collectorLogs.push("[app] 전체 수집: new Production run");
      await refreshCollectorStatus();
      render();
    } catch (error) {
      collectorLogs.push(`[app] 전체 수집 failed: ${String(error)}`);
      render();
    }
  });

  document.querySelector("[data-action=start_latest_collector]")?.addEventListener("click", async () => {
    try {
      await invoke("start_collector", {
        args: { newRun: true, production: true, latest: true, pageUnit: 100, stopAfterPage: null },
      });
      collectorLogs.push("[app] 최신 자료 수집: continue after Production checkpoint");
      await refreshCollectorStatus();
      render();
    } catch (error) {
      collectorLogs.push(`[app] 최신 자료 수집 failed: ${String(error)}`);
      render();
    }
  });

  document.querySelector("[data-action=pause_collector]")?.addEventListener("click", async () => {
    try {
      await invoke("pause_collector");
      collectorLogs.push("[app] Pause: checkpoint kept");
      await refreshCollectorStatus();
      render();
    } catch (error) {
      collectorLogs.push(`[app] Pause failed: ${String(error)}`);
      render();
    }
  });

  document.querySelector("[data-action=resume_collector]")?.addEventListener("click", async () => {
    try {
      await invoke("start_collector", {
        args: {
          newRun: false,
          production: true,
          latest: collectorStatus.sourceMode === "incremental_v2",
          pageUnit: 100,
          stopAfterPage: null,
        },
      });
      collectorLogs.push("[app] Resume: continue from checkpoint");
      await refreshCollectorStatus();
      render();
    } catch (error) {
      collectorLogs.push(`[app] Resume failed: ${String(error)}`);
      render();
    }
  });

  document.querySelector("[data-action=stop_collector]")?.addEventListener("click", async () => {
    try {
      await invoke("stop_collector");
      collectorLogs.push("[app] Stop: run ended");
      await refreshCollectorStatus();
      render();
    } catch (error) {
      collectorLogs.push(`[app] Stop failed: ${String(error)}`);
      render();
    }
  });

  document.querySelector("[data-action=copy_logs]")?.addEventListener("click", () => void copyLogs());
}

async function boot() {
  setupWindowChrome();
  await loadDbInfo();
  await loadFilterOptions();
  render();
  if (!dbError) await loadSearch(1);

  if ("__TAURI_INTERNALS__" in window) {
    void listen<{ type?: string; message?: string }>("collector-event", (event) => {
      const payload = event.payload;
      if (payload.message) collectorLogs.push(payload.message);
      if (collectorLogs.length > 500) collectorLogs = collectorLogs.slice(-500);
      void refreshCollectorStatus();
    });

    statusPollTimer = window.setInterval(() => {
      if (view === "collector" || collectorStatus.processRunning) void refreshCollectorStatus();
    }, 3000);
  }
}

void boot();

// Keep timer reference for lint cleanliness
void statusPollTimer;
