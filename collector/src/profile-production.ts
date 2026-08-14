import { DatabaseSync } from "node:sqlite";
import { config } from "./config.ts";

const runId = Number(process.argv.find((x) => x.startsWith("--run-id="))?.split("=")[1] ?? "8");
const db = new DatabaseSync(config.dbPath, { readOnly: true });
const all = (sql: string, ...args: unknown[]) => db.prepare(sql).all(...args);
const get = (sql: string, ...args: unknown[]) => db.prepare(sql).get(...args);
const out: Record<string, unknown> = {};

const fields = ["certification_type","certification_no","product_name","company_name","representative_name","address_raw","certification_start_date","certification_end_date","source_row_no"];
out.fieldProfiles = Object.fromEntries(fields.map((field) => [field, get(`SELECT COUNT(*) count,
  SUM(${field} IS NULL) null_count,SUM(${field} IS NOT NULL AND TRIM(CAST(${field} AS TEXT))='') empty_count,
  COUNT(DISTINCT ${field}) distinct_count,MIN(LENGTH(CAST(${field} AS TEXT))) min_length,
  MAX(LENGTH(CAST(${field} AS TEXT))) max_length FROM certification_records WHERE run_id=?`,runId)]));

out.typeQuality = all(`SELECT certification_type,COUNT(*) total,
  SUM(certification_no IS NULL OR TRIM(certification_no)='') certification_no_missing,
  SUM(product_name IS NULL OR TRIM(product_name)='') product_name_missing,
  SUM(representative_name IS NULL OR TRIM(representative_name)='') representative_missing,
  SUM(address_raw IS NULL OR TRIM(address_raw)='') address_missing,
  SUM(certification_start_date IS NULL) start_missing,SUM(certification_end_date IS NULL) end_missing,
  SUM(certification_end_date='9999-12-31') unlimited_count,
  SUM(is_currently_valid=1) currently_valid,SUM(historical_certification=1) historical
  FROM certification_records WHERE run_id=? GROUP BY certification_type ORDER BY total DESC`,runId);

out.unlimited = {
  byType: all(`SELECT certification_type,COUNT(*) count,SUM(certification_start_date IS NULL) start_missing,
    SUM(product_name IS NULL OR TRIM(product_name)='') product_missing FROM certification_records
    WHERE run_id=? AND certification_end_date='9999-12-31' GROUP BY certification_type ORDER BY count DESC`,runId),
  mixedNumberGroups: get(`SELECT COUNT(*) groups_count FROM (SELECT certification_type,certification_no
    FROM certification_records WHERE run_id=? AND certification_no IS NOT NULL GROUP BY certification_type,certification_no
    HAVING SUM(certification_end_date='9999-12-31')>0 AND SUM(certification_end_date IS NOT NULL AND certification_end_date<>'9999-12-31')>0)`,runId),
};

out.unclassified = {
  total: get(`SELECT COUNT(*) count FROM certification_records WHERE run_id=?
    AND COALESCE(historical_certification,0)=0 AND COALESCE(is_currently_valid,0)=0`,runId),
  reasons: all(`SELECT CASE WHEN certification_start_date IS NULL AND certification_end_date IS NULL THEN 'both_dates_null'
    WHEN certification_end_date IS NULL THEN 'end_date_null' WHEN certification_start_date IS NULL THEN 'start_date_null'
    ELSE 'other' END reason,COUNT(*) count FROM certification_records WHERE run_id=?
    AND COALESCE(historical_certification,0)=0 AND COALESCE(is_currently_valid,0)=0 GROUP BY reason`,runId),
  samples: all(`SELECT source_row_no,certification_type,certification_no,company_name,product_name,
    certification_start_date,certification_end_date,is_currently_valid,historical_certification
    FROM certification_records WHERE run_id=? AND COALESCE(historical_certification,0)=0
    AND COALESCE(is_currently_valid,0)=0 ORDER BY source_row_no LIMIT 20`,runId),
};

const candidates: Record<string,string[]> = {
  A:["certification_type","certification_no"],
  B:["certification_type","certification_no","company_name"],
  C:["certification_type","certification_no","company_name","product_name"],
  D:["certification_type","certification_no","company_name","certification_start_date"],
};
out.identity = Object.fromEntries(Object.entries(candidates).map(([name,cols]) => {
  const group=cols.map((c)=>`COALESCE(${c},'∅')`).join(",");
  return [name,get(`SELECT COUNT(*) unique_keys,SUM(n>1) duplicate_groups,
    COALESCE(SUM(CASE WHEN n>1 THEN n ELSE 0 END),0) duplicate_rows,MAX(n) max_group_size
    FROM (SELECT COUNT(*) n FROM certification_records WHERE run_id=? GROUP BY ${group})`,runId)];
}));

out.duplicatePatterns = {
  differentCompanies: all(`SELECT certification_type,certification_no,COUNT(*) rows_count,COUNT(DISTINCT company_name) companies
    FROM certification_records WHERE run_id=? AND certification_no IS NOT NULL GROUP BY certification_type,certification_no
    HAVING COUNT(DISTINCT company_name)>1 ORDER BY rows_count DESC LIMIT 8`,runId),
  differentProducts: all(`SELECT certification_type,certification_no,company_name,COUNT(*) rows_count,
    COUNT(DISTINCT COALESCE(product_name,'∅')) products FROM certification_records WHERE run_id=? AND certification_no IS NOT NULL
    GROUP BY certification_type,certification_no,company_name HAVING COUNT(DISTINCT COALESCE(product_name,'∅'))>1
    ORDER BY rows_count DESC LIMIT 8`,runId),
  differentPeriods: all(`SELECT certification_type,certification_no,company_name,COUNT(*) rows_count,
    COUNT(DISTINCT COALESCE(certification_start_date,'∅')||'/'||COALESCE(certification_end_date,'∅')) periods
    FROM certification_records WHERE run_id=? AND certification_no IS NOT NULL GROUP BY certification_type,certification_no,company_name
    HAVING periods>1 ORDER BY rows_count DESC LIMIT 8`,runId),
  exactDuplicates: all(`SELECT certification_type,certification_no,company_name,product_name,certification_start_date,
    certification_end_date,COUNT(*) rows_count FROM certification_records WHERE run_id=? GROUP BY certification_type,
    certification_no,company_name,product_name,certification_start_date,certification_end_date HAVING COUNT(*)>1
    ORDER BY rows_count DESC LIMIT 8`,runId),
};

const numberRows=all("SELECT certification_type,certification_no FROM certification_records WHERE run_id=?",runId) as any[];
const numberByType=new Map<string,{rows:number;missing:number;freq:Map<string,number>}>();
for(const row of numberRows){const type=String(row.certification_type),no=row.certification_no==null?"∅":String(row.certification_no);
  const state=numberByType.get(type)??{rows:0,missing:0,freq:new Map<string,number>()};state.rows+=1;
  if(row.certification_no==null||String(row.certification_no).trim()==="")state.missing+=1;
  state.freq.set(no,(state.freq.get(no)??0)+1);numberByType.set(type,state);}
out.numberUniquenessByType=[...numberByType].map(([certification_type,s])=>({certification_type,rows_count:s.rows,
  distinct_numbers:s.freq.size-(s.freq.has("∅")?1:0),missing_numbers:s.missing,
  duplicate_number_groups:[...s.freq.values()].filter(n=>n>1).length,max_number_frequency:Math.max(...s.freq.values())}))
  .sort((a,b)=>b.rows_count-a.rows_count);

const companies = all("SELECT company_name FROM certification_records WHERE run_id=?",runId).map((r:any)=>String(r.company_name));
const companyNorm=(s:string)=>s.normalize("NFKC").replace(/\(\s*주\s*\)|㈜|주식회사/gi,"").replace(/[()\s]/g,"").toLowerCase();
const companyRaw=new Set(companies), companyNormalized=new Set(companies.map(companyNorm));
out.companyNormalization={rawDistinct:companyRaw.size,normalizedDistinct:companyNormalized.size,reduction:companyRaw.size-companyNormalized.size,
  patterns:{parenJu:companies.filter(x=>/\(\s*주\s*\)/.test(x)).length,circleJu:companies.filter(x=>x.includes("㈜")).length,
  jusikhoesa:companies.filter(x=>x.includes("주식회사")).length}};
const products=all("SELECT product_name FROM certification_records WHERE run_id=? AND product_name IS NOT NULL",runId).map((r:any)=>String(r.product_name));
const productNorm=(s:string)=>s.replace(/\u00a0/g," ").replace(/\s+/g," ").trim();
out.productNormalization={rawDistinct:new Set(products).size,normalizedDistinct:new Set(products.map(productNorm)).size,
  changedRows:products.filter((x)=>x!==productNorm(x)).length};

out.lifecycle = {
  typeNumberMultiplePeriods:get(`SELECT COUNT(*) groups_count FROM (SELECT certification_type,certification_no FROM certification_records
    WHERE run_id=? AND certification_no IS NOT NULL GROUP BY certification_type,certification_no
    HAVING COUNT(DISTINCT COALESCE(certification_start_date,'∅')||'/'||COALESCE(certification_end_date,'∅'))>1)`,runId),
  sameCompanyMultiplePeriods:get(`SELECT COUNT(*) groups_count FROM (SELECT certification_type,certification_no,company_name
    FROM certification_records WHERE run_id=? AND certification_no IS NOT NULL GROUP BY certification_type,certification_no,company_name
    HAVING COUNT(DISTINCT COALESCE(certification_start_date,'∅')||'/'||COALESCE(certification_end_date,'∅'))>1)`,runId),
  typeNumberProductVariants:get(`SELECT COUNT(*) groups_count FROM (SELECT certification_type,certification_no FROM certification_records
    WHERE run_id=? AND certification_no IS NOT NULL GROUP BY certification_type,certification_no
    HAVING COUNT(DISTINCT COALESCE(product_name,'∅'))>1)`,runId),
  typeNumberCompanyVariants:get(`SELECT COUNT(*) groups_count FROM (SELECT certification_type,certification_no FROM certification_records
    WHERE run_id=? AND certification_no IS NOT NULL GROUP BY certification_type,certification_no HAVING COUNT(DISTINCT company_name)>1)`,runId),
};

console.log(JSON.stringify(out,null,2));
db.close();
