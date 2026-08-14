export interface RawListRow {
  sourceRowNo: number | null;
  rawCertificationType: string;
  rawCertificationInfo: string;
  rawCompanyInfo: string;
  rawStartDate: string;
  rawEndDate: string;
  imageSrc: string | null;
  rowHtml: string;
}

export interface CertificationRecord {
  sourceRowNo: number | null;
  certificationType: string;
  certificationNo: string | null;
  productName: string | null;
  companyName: string;
  representativeName: string | null;
  addressRaw: string | null;
  certificationStartDateRaw: string;
  certificationEndDateRaw: string;
  certificationStartDate: string | null;
  certificationEndDate: string | null;
  isCurrentlyValid: boolean | null;
  historicalCertification: boolean | null;
  isUnlimitedEndDate: boolean;
  imageUrl: string | null;
  sourcePageNo: number;
  businessRegistrationNo: null;
  companyIdentifier: null;
  detailedItemName: null;
  detailedItemCode: null;
  sourceSeqNo: null;
  detailUrl: null;
  rawJson: string;
  collectedAt: string;
}

export interface RowParseFailure {
  sourceRowNo: number | null;
  reason: string;
  rawJson: string;
  collectedAt: string;
}

export interface ParseResult {
  records: CertificationRecord[];
  failures: RowParseFailure[];
}

export interface CollectionRun {
  id: number;
  status: "running" | "interrupted" | "completed" | "failed";
  searchTotal: number | null;
  lastCompletedPage: number;
}
