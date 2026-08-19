import { config } from "./config.ts";
import { openBrowser } from "./browser.ts";
import { checkpointPage, moveToPageViaVisibleBlocks } from "./paginator.ts";
import { configurePageUnit, enableExpiredInclusion, loadSearchPage, readSearchTotal, submitSearchAndAssert } from "./search-state.ts";
import { acquireIncrementalRun, acquireRun, assertIncrementalOverlap, commitPage, completeIncrementalRun, completeProductionRun, completeRun, countRunRecords, failRun, incrementRetry, incrementalBaselineMax, interruptRun, markPageFailed, openDatabase, productionIntegrity, saveFailures, setInitialSearchTotal, startPage, updateSearchTotal } from "./sink.ts";

function numericArg(name: string, fallback?: number): number | undefined {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=",2)[1];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || (!config.production && value > 6)) throw new Error(`${name} is outside the allowed range`);
  return value;
}

const requestedStop = numericArg("stop-after-page", config.production ? undefined : 3);
const failAfterPage = numericArg("fail-after-page");
const db = openDatabase();
const forceNew = process.argv.includes("--new-run");
const acquired = config.incremental ? acquireIncrementalRun(db, forceNew) : acquireRun(db, forceNew);
const run = acquired.run;
let session: Awaited<ReturnType<typeof openBrowser>> | undefined;
let activePage: number | null = null;
const runStartedAt = Date.now();

console.log(config.production && !acquired.resumed ? "production_run_created" : acquired.resumed ? "run_resumed" : "run_created");
console.log(`run_id=${run.id}`);
if (acquired.resumed) console.log(`checkpoint_loaded last_completed_page=${run.lastCompletedPage}`);
const resumeFromPage = run.lastCompletedPage + 1;
console.log(`resume_from_page=${resumeFromPage}`);
console.log("collection_start");

try {
  session = await openBrowser();
  await loadSearchPage(session.page);
  await enableExpiredInclusion(session.page);
  await configurePageUnit(session.page);
  await submitSearchAndAssert(session.page);
  const searchTotal = await readSearchTotal(session.page);
  if (run.searchTotal !== null && searchTotal !== run.searchTotal) {
    if (!config.incremental || searchTotal < run.searchTotal) throw new Error(`Search total changed: stored_total=${run.searchTotal} current_total=${searchTotal}`);
    updateSearchTotal(db,run.id,searchTotal);
  }
  if (run.searchTotal === null) setInitialSearchTotal(db,run.id,searchTotal);
  const totalPages = Math.ceil(searchTotal / config.pageUnit);
  const stopAfterPage = requestedStop ?? totalPages;
  if (stopAfterPage > totalPages || resumeFromPage > stopAfterPage) throw new Error("Invalid collection page range");
  console.log(`search_total=${searchTotal}`);
  console.log(`total_pages=${totalPages}`);

  for (let pageNo=resumeFromPage; pageNo<=stopAfterPage; pageNo+=1) {
    activePage=pageNo;
    const pageStartedAt=Date.now();
    console.log(`page_start page=${pageNo}/${totalPages}`);
    startPage(db,run.id,pageNo);
    let checkpoint: Awaited<ReturnType<typeof checkpointPage>> | undefined;
    let lastError: unknown;
    for (let attempt=1; attempt<=3; attempt+=1) {
      try {
        if (pageNo!==1 && attempt===1) await moveToPageViaVisibleBlocks(session.page,pageNo);
        checkpoint=await checkpointPage(session.page,pageNo,searchTotal);
        break;
      } catch (error) {
        lastError=error;
        if (attempt===3) break;
        incrementRetry(db,run.id);
        console.log(`page_retry page=${pageNo} attempt=${attempt+1}`);
        await session.page.waitForTimeout(1000*attempt);
      }
    }
    if (!checkpoint) throw lastError;
    if (checkpoint.failures.length) {
      saveFailures(db,run.id,checkpoint.failures);
      throw new Error(`Row parsing failed on page ${pageNo}: ${checkpoint.failures.length}`);
    }
    if (config.incremental) {
      const baselineMax = incrementalBaselineMax(db);
      assertIncrementalOverlap(db,checkpoint.records,baselineMax);
      checkpoint.records = checkpoint.records.filter((record) => record.sourceRowNo > baselineMax);
      checkpoint.rowsParsed = checkpoint.records.length;
    }
    const {inserted,elapsedMs}=commitPage(db,run.id,checkpoint,failAfterPage===pageNo,pageStartedAt);
    console.log(`page_complete page=${pageNo}/${totalPages} rows=${checkpoint.rowsFound} parsed=${checkpoint.rowsParsed} inserted=${inserted} elapsed_ms=${elapsedMs}`);
    console.log("checkpoint_saved");
    activePage=null;
    if (pageNo%25===0 || pageNo===stopAfterPage) console.log(`progress pages=${pageNo}/${totalPages} stored_rows=${countRunRecords(db,run.id)}`);
  }

  if (config.incremental && stopAfterPage===totalPages) {
    completeIncrementalRun(db,run.id,searchTotal);
    console.log(`collection_elapsed_ms=${Date.now()-runStartedAt}`);
    console.log("collection_complete");
  } else if (config.production && stopAfterPage===totalPages) {
    const integrity=productionIntegrity(db,run.id,totalPages,searchTotal);
    completeProductionRun(db,run.id);
    console.log(`integrity=${JSON.stringify(integrity)}`);
    console.log(`collection_elapsed_ms=${Date.now()-runStartedAt}`);
    console.log("collection_complete");
  } else if (process.argv.includes("--complete-run") && stopAfterPage===totalPages) {
    completeRun(db,run.id);
  } else {
    interruptRun(db,run.id,"bounded checkpoint stop");
    console.log("collector_interrupted");
  }
} catch(error) {
  if(activePage!==null) markPageFailed(db,run.id,activePage,error); else failRun(db,run.id,error);
  console.log("collector_interrupted");
  console.error("COLLECTION_FAILED",error);
  process.exitCode=1;
} finally {
  await session?.browser.close();
  db.close();
}
