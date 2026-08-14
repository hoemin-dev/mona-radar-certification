import { config } from "./config.ts";
import { openBrowser } from "./browser.ts";
import { checkpointPage, moveToLastPage } from "./paginator.ts";
import { configurePageUnit, enableExpiredInclusion, loadSearchPage, readSearchTotal, submitSearchAndAssert } from "./search-state.ts";

let session: Awaited<ReturnType<typeof openBrowser>> | undefined;
console.log("last_page_diagnostic_start");
try {
  session = await openBrowser();
  await loadSearchPage(session.page);
  await enableExpiredInclusion(session.page);
  await configurePageUnit(session.page);
  await submitSearchAndAssert(session.page);
  const total = await readSearchTotal(session.page);
  const lastPage = Math.ceil(total / config.pageUnit);
  const expectedRows = total % config.pageUnit || config.pageUnit;
  await moveToLastPage(session.page);
  const checkpoint = await checkpointPage(session.page, lastPage, total);
  if (checkpoint.rowsFound !== expectedRows) {
    throw new Error(`Last-page row mismatch: expected ${expectedRows}, got ${checkpoint.rowsFound}`);
  }
  if (checkpoint.lastNo !== total) {
    throw new Error(`Last No mismatch: expected ${total}, got ${checkpoint.lastNo}`);
  }
  console.log(`search_total=${total}`);
  console.log(`page_unit=${config.pageUnit}`);
  console.log(`last_page=${lastPage}`);
  console.log(`expected_last_rows=${expectedRows}`);
  console.log(`rows_found=${checkpoint.rowsFound}`);
  console.log(`rows_parsed=${checkpoint.rowsParsed}`);
  console.log(`first_no=${checkpoint.firstNo}`);
  console.log(`last_no=${checkpoint.lastNo}`);
  console.log("expired_included=true");
  console.log("last_page_diagnostic_complete");
} catch (error) {
  console.error("LAST_PAGE_DIAGNOSTIC_FAILED", error);
  process.exitCode = 1;
} finally {
  await session?.browser.close();
}
