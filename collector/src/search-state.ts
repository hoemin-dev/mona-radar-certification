import type { Page } from "playwright";
import { config } from "./config.ts";

export class CollectionStateError extends Error {}

export async function loadSearchPage(page: Page): Promise<void> {
  await page.goto(config.sourceUrl, { waitUntil: "domcontentloaded" });
  const form = page.locator("#searchForm");
  const expired = page.locator("#searchOverDateYn");
  if ((await form.count()) !== 1 || (await expired.count()) !== 1) {
    throw new CollectionStateError("Required search controls are missing");
  }
}

export async function enableExpiredInclusion(page: Page): Promise<void> {
  const expired = page.locator("#searchOverDateYn");
  if (!(await expired.isChecked())) {
    // SMPP's wide desktop layout can place the input box outside Chromium's
    // calculated viewport. Clicking its associated label is still a real
    // pointer interaction and toggles the checkbox without DOM mutation.
    await page.locator('label[for="searchOverDateYn"]').click();
  }
  if (!(await expired.isChecked())) {
    throw new CollectionStateError("Expired-certification inclusion was not activated");
  }
}

export async function configurePageUnit(page: Page): Promise<void> {
  const select = page.locator('select[name="pageUnit"]');
  if ((await select.count()) !== 1) throw new CollectionStateError("pageUnit selector is missing");
  await select.selectOption(String(config.pageUnit));
  if (Number(await select.inputValue()) !== config.pageUnit) {
    throw new CollectionStateError(`Could not select pageUnit=${config.pageUnit}`);
  }
}

export async function assertSearchConditions(page: Page): Promise<void> {
  if (!(await page.locator("#searchOverDateYn").isChecked())) {
    throw new CollectionStateError("Expired-certification inclusion is not active");
  }
  const actualPageUnit = Number(await page.locator('select[name="pageUnit"]').inputValue());
  if (actualPageUnit !== config.pageUnit) {
    throw new CollectionStateError(`pageUnit changed: expected ${config.pageUnit}, got ${actualPageUnit}`);
  }
}

export async function submitSearchAndAssert(page: Page): Promise<void> {
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.locator("#search").click(),
  ]);
  await assertSearchConditions(page);
}

export async function readSearchTotal(page: Page): Promise<number> {
  const text = await page.locator("p", { hasText: /^전체\s*[\d,]+개/ }).first().innerText();
  const match = text.match(/전체\s*([\d,]+)개/);
  if (!match) throw new CollectionStateError(`Could not parse search total: ${text}`);
  return Number(match[1].replaceAll(",", ""));
}
