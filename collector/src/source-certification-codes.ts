export const SOURCE_CERTIFICATION_CODE_VERSION = "SMPP_UI_2026-08-14";

// Values are the public `searchCrtfcSeCode` checkbox values observed on the
// SMPP search form. They classify a source label; they are not row IDs.
export const sourceCertificationCodes: Record<string, string> = {
  "NEP": "01",
  "NET": "02",
  "GS": "03",
  "우수조달물품": "04",
  "성능인증": "05",
  "구매조건부신기술개발": "07",
  "녹색기술제품": "08",
  "우수조달공동상표": "09",
  "민관공동투자기술개발": "10",
  "산업융합품목": "11",
  "성과공유기술개발": "12",
  "ICT융합품질인증": "13",
  "중소기업융복합기술개발": "14",
  "산업융합신제품적합성인증": "15",
  "우수산업디자인": "16",
  "우수산업디자인(GD)": "16",
  "공공기관 개발선정품": "27",
  "우수연구개발혁신제품": "28",
  "물산업우수제품 등 지정": "29",
  "혁신시제품": "30",
  "기타혁신제품": "31",
  "재난안전제품": "32",
  "재난안전제품인증": "32",
};

export function sourceCertificationCodeFor(type: string): string | null {
  return sourceCertificationCodes[type] ?? null;
}
