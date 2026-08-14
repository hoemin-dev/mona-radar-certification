import type { Page } from "playwright";
import { readRawRows, parseRows } from "./list-parser.ts";
import { config } from "./config.ts";
import { assertSearchConditions, CollectionStateError, readSearchTotal } from "./search-state.ts";
import type { CertificationRecord, RowParseFailure } from "./types.ts";

export interface PageCheckpoint {
  pageNo: number;
  searchTotal: number;
  rowsFound: number;
  rowsParsed: number;
  firstNo: number | null;
  lastNo: number | null;
  expiredIncluded: true;
  records: CertificationRecord[];
  failures: RowParseFailure[];
}

export async function moveToPage(page: Page, pageNo: number): Promise<void> {
  const link = page.getByRole("link", { name: String(pageNo), exact: true });
  const numericCount = await link.count();
  const target = numericCount === 1 ? link : pageNo % 10 === 1
    ? page.getByRole("link", { name: "다음 페이지", exact: true }) : null;
  if (!target || (await target.count()) !== 1) throw new CollectionStateError(`No site pagination link for page ${pageNo}`);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    target.click(),
  ]);
}

export async function moveToPageViaVisibleBlocks(page: Page, pageNo: number): Promise<void> {
  // A new browser session starts at block 1 (1..10). Reaching page 31 needs
  // three visible next-block actions (1->11->21->31), not a single click.
  const maximumBlockTransitions = Math.ceil(pageNo / 10) + 1;
  for (let transition = 0; transition < maximumBlockTransitions; transition += 1) {
    const direct = page.getByRole("link", { name: String(pageNo), exact: true });
    if ((await direct.count()) === 1) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded" }),
        direct.click(),
      ]);
      return;
    }
    const nextBlock = page.getByRole("link", { name: "다음 페이지", exact: true });
    if ((await nextBlock.count()) !== 1) break;
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      nextBlock.click(),
    ]);
  }
  throw new CollectionStateError(`No site pagination path for page ${pageNo}`);
}

export async function moveToLastPage(page: Page): Promise<void> {
  const link = page.getByRole("link", { name: "마지막 페이지", exact: true });
  if ((await link.count()) !== 1) throw new CollectionStateError("Last-page link is missing");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    link.click(),
  ]);
}

async function readCurrentPageNo(page: Page): Promise<number | null> {
  return page.locator("a.on").evaluateAll((links) => {
    const values = links.map((link) => link.textContent?.trim() ?? "").filter((value) => /^\d+$/.test(value));
    return values.length === 1 ? Number(values[0]) : null;
  });
}

export async function checkpointPage(
  page: Page,
  expectedPageNo: number,
  expectedSearchTotal: number,
): Promise<PageCheckpoint> {
  await assertSearchConditions(page);
  const searchTotal = await readSearchTotal(page);
  if (searchTotal !== expectedSearchTotal) {
    throw new CollectionStateError(
      `Search total changed on page ${expectedPageNo}: expected ${expectedSearchTotal}, got ${searchTotal}`,
    );
  }
  const currentPageNo = await readCurrentPageNo(page);
  if (currentPageNo !== expectedPageNo) {
    throw new CollectionStateError(
      `Current page mismatch: expected ${expectedPageNo}, got ${currentPageNo ?? "unknown"}`,
    );
  }

  const rawRows = await readRawRows(page);
  if (rawRows.length > config.pageUnit) {
    throw new CollectionStateError(`Page ${expectedPageNo} returned ${rawRows.length} rows for pageUnit=${config.pageUnit}`);
  }
  const parsed = parseRows(rawRows, expectedPageNo);
  const rowNumbers = rawRows.map((row) => row.sourceRowNo).filter((value): value is number => value !== null);
  if (rowNumbers.length !== rawRows.length) {
    throw new CollectionStateError(`One or more row numbers are missing on page ${expectedPageNo}`);
  }

  return {
    pageNo: expectedPageNo,
    searchTotal,
    rowsFound: rawRows.length,
    rowsParsed: parsed.records.length,
    firstNo: rowNumbers[0] ?? null,
    lastNo: rowNumbers.at(-1) ?? null,
    expiredIncluded: true,
    records: parsed.records,
    failures: parsed.failures,
  };
}
