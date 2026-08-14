import { resolve } from "node:path";

const pageUnitArg = process.argv.find((arg) => arg.startsWith("--page-unit="))?.split("=", 2)[1];
const pageUnit = Number(pageUnitArg ?? "100");
if (![15, 100].includes(pageUnit)) throw new Error("page-unit must be 15 or 100");
const production = process.argv.includes("--production");

export const config = {
  sourceUrl: "https://www.smpp.go.kr/prd/prdinfo/tdprd/SelectTdPrdListVw.do",
  dbPath: resolve("collector/data/mona-radar-certification.sqlite"),
  navigationTimeoutMs: 90_000,
  sourcePageNo: 1,
  pageUnit,
  sourceMode: production ? "production_v2" : "smpp_tdprd_occurrence_v2",
  collectorSchemaVersion: "v2",
  production,
  userAgent: "MONA-RADAR-Certification-MVP/0.1 (+one-page public-data collector)",
} as const;
