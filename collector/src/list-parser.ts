import type { Page } from "playwright";
import { config } from "./config.ts";
import type { CertificationRecord, ParseResult, RawListRow } from "./types.ts";

const clean = (value: string): string => value.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
const emptyToNull = (value: string): string | null => value.trim() === "" ? null : value.trim();
const dateOrNull = (value: string): string | null => {
  const match = value.match(/\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? null;
};

function labelledValue(raw: string, label: RegExp, next?: RegExp): string | null {
  const normalized = clean(raw);
  const start = normalized.match(label);
  if (!start || start.index === undefined) return null;
  const rest = normalized.slice(start.index + start[0].length);
  const end = next ? rest.search(next) : -1;
  return emptyToNull(clean(end >= 0 ? rest.slice(0, end) : rest));
}

export async function readRawRows(page: Page): Promise<RawListRow[]> {
  return page.locator('tr:has(td[data-label="인증구분"])').evaluateAll((rows) => rows.map((row) => {
    const cell = (label: string) => row.querySelector(`td[data-label="${label}"]`);
    const noText = row.querySelector("td")?.textContent?.trim() ?? "";
    const image = cell("제품사진")?.querySelector("img");
    return {
      sourceRowNo: /^\d+$/.test(noText) ? Number(noText) : null,
      rawCertificationType: cell("인증구분")?.textContent ?? "",
      rawCertificationInfo: cell("인증정보")?.textContent ?? "",
      rawCompanyInfo: cell("회사정보")?.textContent ?? "",
      rawStartDate: cell("인증일자")?.textContent ?? "",
      rawEndDate: cell("만료일자")?.textContent ?? "",
      imageSrc: image?.getAttribute("src") ?? null,
      rowHtml: row.outerHTML,
    };
  }));
}

export function parseRows(
  rows: RawListRow[],
  sourcePageNo = config.sourcePageNo,
  collectedAt = new Date().toISOString(),
): ParseResult {
  const records: CertificationRecord[] = [];
  const failures: ParseResult["failures"] = [];

  for (const raw of rows) {
    try {
      const certificationType = clean(raw.rawCertificationType);
      const certificationInfo = clean(raw.rawCertificationInfo);
      const companyInfo = clean(raw.rawCompanyInfo);
      const certificationNo = labelledValue(certificationInfo, /인증번호\s*:\s*/);
      const productName = emptyToNull(clean(certificationInfo.replace(/\s*인증번호\s*:[\s\S]*$/, "")));
      const companyName = labelledValue(companyInfo, /업체명\s*:\s*/, /\n?대표자\s*:/);
      const representativeName = labelledValue(companyInfo, /대표자\s*:\s*/, /\n?주\s*소\s*:/);
      const addressRaw = labelledValue(companyInfo, /주\s*소\s*:\s*/);
      const startDate = dateOrNull(raw.rawStartDate);
      const endDate = dateOrNull(raw.rawEndDate);

      if (!certificationType || !companyName) {
        throw new Error("required field missing: certification_type or company_name");
      }

      const unlimited = endDate === "9999-12-31";
      const today = collectedAt.slice(0, 10);
      const historical = endDate === null || unlimited ? null : endDate < today;
      const currentlyValid = unlimited ? true : startDate && endDate ? startDate <= today && today <= endDate : null;
      const imageUrl = raw.imageSrc ? new URL(raw.imageSrc, config.sourceUrl).href : null;

      records.push({
        sourceRowNo: raw.sourceRowNo,
        certificationType,
        certificationNo,
        productName,
        companyName,
        representativeName,
        addressRaw,
        certificationStartDateRaw: raw.rawStartDate,
        certificationEndDateRaw: raw.rawEndDate,
        certificationStartDate: startDate,
        certificationEndDate: endDate,
        isCurrentlyValid: currentlyValid,
        historicalCertification: historical,
        isUnlimitedEndDate: unlimited,
        imageUrl,
        sourcePageNo,
        businessRegistrationNo: null,
        companyIdentifier: null,
        detailedItemName: null,
        detailedItemCode: null,
        sourceSeqNo: null,
        detailUrl: null,
        rawJson: JSON.stringify(raw),
        collectedAt,
      });
    } catch (error) {
      failures.push({
        sourceRowNo: raw.sourceRowNo,
        reason: error instanceof Error ? error.message : String(error),
        rawJson: JSON.stringify(raw),
        collectedAt,
      });
    }
  }
  return { records, failures };
}
