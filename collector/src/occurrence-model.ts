import { createHash } from "node:crypto";
import type { CertificationRecord } from "./types.ts";
import { sourceCertificationCodeFor } from "./source-certification-codes.ts";

export const CANDIDATE_RULE_VERSION = "C1";

export type StatusClass = "current" | "historical" | "unknown";

export interface SnapshotOccurrence {
  sourceCertificationCode: string | null;
  certificationSubjectName: string | null;
  companyNameNormalized: string | null;
  certificationSubjectNameNormalized: string | null;
  certificationStartDateRaw: string;
  certificationEndDateRaw: string;
  isUnlimited: boolean;
  statusClass: StatusClass;
  statusUnknown: boolean;
  candidateFingerprint: string | null;
  candidateRuleVersion: string;
}

const normalizedText = (value: string | null): string | null => {
  if (value === null) return null;
  const result = value.normalize("NFKC").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  return result === "" ? null : result;
};

export const normalizeCompanyName = (value: string | null): string | null => normalizedText(value)?.toLocaleLowerCase("ko-KR") ?? null;
export const normalizeSubjectName = normalizedText;

function candidateFingerprint(record: CertificationRecord, subject: string | null): string | null {
  if (!record.certificationNo || !record.companyName || !subject) return null;
  const input = [record.certificationType, record.certificationNo, record.companyName, subject].join("\u001f");
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function toSnapshotOccurrence(record: CertificationRecord): SnapshotOccurrence {
  const isUnlimited = record.certificationEndDateRaw.trim() === "9999-12-31";
  // Method A: status_class is temporal current/historical/unknown; unlimited is
  // an independent sentinel flag and may overlap `current`.
  const statusClass: StatusClass = isUnlimited || record.isCurrentlyValid === true
    ? "current"
    : record.historicalCertification === true ? "historical" : "unknown";
  const subject = record.productName;
  return {
    sourceCertificationCode: sourceCertificationCodeFor(record.certificationType),
    certificationSubjectName: subject,
    companyNameNormalized: normalizeCompanyName(record.companyName),
    certificationSubjectNameNormalized: normalizeSubjectName(subject),
    certificationStartDateRaw: record.certificationStartDateRaw,
    certificationEndDateRaw: record.certificationEndDateRaw,
    isUnlimited,
    statusClass,
    statusUnknown: statusClass === "unknown",
    candidateFingerprint: candidateFingerprint(record, subject),
    candidateRuleVersion: CANDIDATE_RULE_VERSION,
  };
}
