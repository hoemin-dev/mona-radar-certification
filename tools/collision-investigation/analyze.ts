import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const dbPath = resolve("collector/data/mona-radar-certification.sqlite");
const outputPath = resolve("tools/collision-investigation/results-run-8.json");
const runId = 8;
const db = new DatabaseSync(dbPath, { readOnly: true });
const all = (sql: string, ...args: unknown[]) => db.prepare(sql).all(...args) as Record<string, unknown>[];
const get = (sql: string, ...args: unknown[]) => db.prepare(sql).get(...args) as Record<string, unknown>;

const dimensions = [
  { key: "TYPE_1", group: "certification_type,certification_no", distinct: "company_name" },
  { key: "TYPE_2", group: "certification_type,certification_no,company_name", distinct: "COALESCE(product_name,'∅')" },
  { key: "TYPE_3", group: "certification_type,certification_no,company_name,COALESCE(product_name,'∅')", distinct: "COALESCE(certification_start_date,'∅')||'/'||COALESCE(certification_end_date,'∅')" },
  { key: "TYPE_4", group: "certification_type,certification_no,company_name,COALESCE(product_name,'∅'),COALESCE(certification_start_date,'∅'),COALESCE(certification_end_date,'∅')", distinct: null },
];

const collisionSummary: Record<string, unknown> = {};
for (const d of dimensions) {
  const having = d.distinct ? `COUNT(DISTINCT ${d.distinct})>1` : "COUNT(*)>1";
  collisionSummary[d.key] = get(`SELECT COUNT(*) group_count,COALESCE(SUM(n),0) row_count,MAX(n) max_group_size
    FROM (SELECT COUNT(*) n FROM certification_records WHERE run_id=? AND certification_no IS NOT NULL
      GROUP BY ${d.group} HAVING ${having})`, runId);
}

const selectedTypes = ["NET","NEP","성능인증","우수조달물품","GS","녹색기술제품","우수조달공동상표","산업융합품목"];
const byType = all(`WITH base AS (
  SELECT * FROM certification_records WHERE run_id=?
), t1 AS (SELECT certification_type,certification_no FROM base WHERE certification_no IS NOT NULL GROUP BY 1,2 HAVING COUNT(DISTINCT company_name)>1),
t2 AS (SELECT certification_type,certification_no,company_name FROM base WHERE certification_no IS NOT NULL GROUP BY 1,2,3 HAVING COUNT(DISTINCT COALESCE(product_name,'∅'))>1),
t3 AS (SELECT certification_type,certification_no,company_name,COALESCE(product_name,'∅') product_name FROM base WHERE certification_no IS NOT NULL GROUP BY 1,2,3,4 HAVING COUNT(DISTINCT COALESCE(certification_start_date,'∅')||'/'||COALESCE(certification_end_date,'∅'))>1),
t4 AS (SELECT certification_type,certification_no,company_name,COALESCE(product_name,'∅') product_name,COALESCE(certification_start_date,'∅') start_date,COALESCE(certification_end_date,'∅') end_date FROM base WHERE certification_no IS NOT NULL GROUP BY 1,2,3,4,5,6 HAVING COUNT(*)>1)
SELECT b.certification_type,COUNT(*) total_rows,
 COUNT(DISTINCT CASE WHEN t1.certification_no IS NOT NULL THEN b.certification_no END) type1_groups,
 COUNT(DISTINCT CASE WHEN t2.certification_no IS NOT NULL THEN b.certification_no||'|'||b.company_name END) type2_groups,
 COUNT(DISTINCT CASE WHEN t3.certification_no IS NOT NULL THEN b.certification_no||'|'||b.company_name||'|'||COALESCE(b.product_name,'∅') END) type3_groups,
 COUNT(DISTINCT CASE WHEN t4.certification_no IS NOT NULL THEN b.certification_no||'|'||b.company_name||'|'||COALESCE(b.product_name,'∅')||'|'||COALESCE(b.certification_start_date,'∅')||'|'||COALESCE(b.certification_end_date,'∅') END) type4_groups
FROM base b LEFT JOIN t1 USING(certification_type,certification_no)
LEFT JOIN t2 USING(certification_type,certification_no,company_name)
LEFT JOIN t3 ON t3.certification_type=b.certification_type AND t3.certification_no=b.certification_no AND t3.company_name=b.company_name AND t3.product_name=COALESCE(b.product_name,'∅')
LEFT JOIN t4 ON t4.certification_type=b.certification_type AND t4.certification_no=b.certification_no AND t4.company_name=b.company_name AND t4.product_name=COALESCE(b.product_name,'∅') AND t4.start_date=COALESCE(b.certification_start_date,'∅') AND t4.end_date=COALESCE(b.certification_end_date,'∅')
WHERE b.certification_type IN (${selectedTypes.map(()=>"?").join(",")}) GROUP BY b.certification_type ORDER BY total_rows DESC`, runId, ...selectedTypes);
for (const row of byType) {
  const type = String(row.certification_type);
  const denominators = get(`SELECT
    (SELECT COUNT(*) FROM (SELECT certification_no FROM certification_records WHERE run_id=? AND certification_type=? AND certification_no IS NOT NULL GROUP BY certification_no)) level1_groups,
    (SELECT COUNT(*) FROM (SELECT certification_no,company_name FROM certification_records WHERE run_id=? AND certification_type=? AND certification_no IS NOT NULL GROUP BY certification_no,company_name)) level2_groups,
    (SELECT COUNT(*) FROM (SELECT certification_no,company_name,COALESCE(product_name,'∅') FROM certification_records WHERE run_id=? AND certification_type=? AND certification_no IS NOT NULL GROUP BY certification_no,company_name,COALESCE(product_name,'∅'))) level3_groups,
    (SELECT COUNT(*) FROM (SELECT certification_no,company_name,COALESCE(product_name,'∅'),certification_start_date,certification_end_date FROM certification_records WHERE run_id=? AND certification_type=? AND certification_no IS NOT NULL GROUP BY certification_no,company_name,COALESCE(product_name,'∅'),certification_start_date,certification_end_date)) visible_groups`,
    runId,type,runId,type,runId,type,runId,type);
  Object.assign(row, denominators);
}

function caseRows(type: string, no: string, company?: string) {
  return all(`SELECT source_row_no,certification_type,certification_no,company_name,product_name,
    certification_start_date,certification_end_date,raw_json FROM certification_records
    WHERE run_id=? AND certification_type=? AND certification_no=? ${company ? "AND company_name=?" : ""}
    ORDER BY company_name,product_name,certification_start_date,certification_end_date,source_row_no`, runId, type, no, ...(company ? [company] : []));
}

const caseCCompanies = all(`SELECT company_name,COUNT(*) n,COUNT(DISTINCT COALESCE(product_name,'∅')) products
  FROM certification_records WHERE run_id=? AND certification_type='NET' AND certification_no='53-067'
  GROUP BY company_name ORDER BY n DESC`,runId);
const caseCCompany = String(caseCCompanies.find(x=>Number(x.n)===10 && Number(x.products)===4)?.company_name ?? caseCCompanies[0]?.company_name ?? "");

const cases = {
  industryConvergence: caseRows("산업융합품목", "제2020-693호"),
  net201411: caseRows("NET", "20-1411"),
  net53067: { company: caseCCompany, alternatives: caseCCompanies, rows: caseRows("NET", "53-067", caseCCompany) },
  jointMark2022009: caseRows("우수조달공동상표", "2022009"),
};

const identicalTop = all(`SELECT certification_type,certification_no,company_name,product_name,
 certification_start_date,certification_end_date,COUNT(*) occurrences,
 GROUP_CONCAT(source_row_no) source_rows
 FROM certification_records WHERE run_id=? GROUP BY certification_type,certification_no,company_name,product_name,
 certification_start_date,certification_end_date HAVING COUNT(*)>1 ORDER BY occurrences DESC,certification_type LIMIT 30`,runId);

const periodRows = all(`SELECT certification_type,certification_no,company_name,product_name,
 certification_start_date start_date,certification_end_date end_date
 FROM certification_records WHERE run_id=? AND certification_no IS NOT NULL
 GROUP BY certification_type,certification_no,company_name,product_name,certification_start_date,certification_end_date`,runId);
type Period = { start_date: string|null; end_date: string|null };
const groups = new Map<string, Period[]>();
for (const r of periodRows) {
  const key=[r.certification_type,r.certification_no,r.company_name,r.product_name].join("\u001f");
  const list=groups.get(key)??[]; list.push({start_date:r.start_date as string|null,end_date:r.end_date as string|null}); groups.set(key,list);
}
const periodRelations: Record<string,number>={same_period:0,overlap:0,contiguous:0,gap:0,unknown:0};
const day=86400000;
for(const periods of groups.values()) for(let i=0;i<periods.length;i++) for(let j=i+1;j<periods.length;j++) {
  const a=periods[i],b=periods[j];
  if(!a.start_date||!a.end_date||!b.start_date||!b.end_date||a.end_date==="9999-12-31"||b.end_date==="9999-12-31") { periodRelations.unknown++; continue; }
  const as=Date.parse(a.start_date),ae=Date.parse(a.end_date),bs=Date.parse(b.start_date),be=Date.parse(b.end_date);
  if([as,ae,bs,be].some(Number.isNaN)){periodRelations.unknown++;continue;}
  if(as===bs&&ae===be) periodRelations.same_period++;
  else if(ae+day===bs||be+day===as) periodRelations.contiguous++;
  else if(as<=be&&bs<=ae) periodRelations.overlap++;
  else periodRelations.gap++;
}

const topIdenticalByType = all(`SELECT certification_type,COUNT(*) group_count,SUM(n) occurrence_rows,MAX(n) max_group_size
 FROM (SELECT certification_type,COUNT(*) n FROM certification_records WHERE run_id=? GROUP BY certification_type,
 certification_no,company_name,product_name,certification_start_date,certification_end_date HAVING COUNT(*)>1)
 GROUP BY certification_type ORDER BY group_count DESC`,runId);

const result={runId,total:get("SELECT COUNT(*) rows FROM certification_records WHERE run_id=?",runId),collisionSummary,byType,
 cases,identicalTop,topIdenticalByType,periodRelations,
 notes:{collisionTypesOverlap:true,periodUnit:"unique period pairs within type/no/company/product",databaseMode:"read-only"}};
writeFileSync(outputPath,JSON.stringify(result,null,2),"utf8");
console.log(JSON.stringify({runId,total:result.total,collisionSummary,byType,caseSizes:{
  industryConvergence:cases.industryConvergence.length,net201411:cases.net201411.length,
  net53067:(cases.net53067 as {rows:unknown[]}).rows.length,jointMark2022009:cases.jointMark2022009.length},
  caseCCompany,periodRelations,topIdenticalByType},null,2));
db.close();
