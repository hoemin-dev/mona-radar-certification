import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { config } from "./config.ts";

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export async function openBrowser(): Promise<BrowserSession> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    userAgent: config.userAgent,
  });
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(config.navigationTimeoutMs);
  page.setDefaultTimeout(30_000);
  return { browser, context, page };
}

