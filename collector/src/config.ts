import { mkdirSync } from "node:fs";
import { join } from "node:path";

const localAppData = process.env.LOCALAPPDATA;
if (!localAppData) throw new Error("LOCALAPPDATA is not set");
const dataDir = join(localAppData, "com.monaradar.certification", "data");
mkdirSync(dataDir, { recursive: true });

const pageUnitArg = process.argv.find((arg) => arg.startsWith("--page-unit="))?.split("=", 2)[1];
const pageUnit = Number(pageUnitArg ?? "100");
if (![15, 100].includes(pageUnit)) throw new Error("page-unit must be 15 or 100");
const production = process.argv.includes("--production");

export const config = {
  sourceUrl: "https://www.smpp.go.kr/prd/prdinfo/tdprd/SelectTdPrdListVw.do",
  dbPath: join(dataDir, "mona-radar-certification.sqlite"),
  navigationTimeoutMs: 90_000,
  sourcePageNo: 1,
  pageUnit,
  sourceMode: production ? "production_v2" : "smpp_tdprd_occurrence_v2",
  collectorSchemaVersion: "v2",
  production,
  userAgent: "MONA-RADAR-Certification-MVP/0.1 (+one-page public-data collector)",
} as const;
