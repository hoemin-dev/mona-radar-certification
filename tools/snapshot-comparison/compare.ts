import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const arg = (name: string, fallback?: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.split("=", 2)[1] ?? fallback;
const baselineRunId = Number(arg("baseline-run", "8"));
const currentRunId = Number(arg("current-run"));
if (!Number.isInteger(baselineRunId) || !Number.isInteger(currentRunId)) throw new Error("--baseline-run and --current-run are required integers");
const outputPath = resolve(arg("output", `tools/snapshot-comparison/run-${baselineRunId}-vs-${currentRunId}.json`)!);
const db = new DatabaseSync(resolve("collector/data/mona-radar-certification.sqlite"), { readOnly: true });
type Row = Record<string, unknown>;
const all = (sql: string, ...params: unknown[]) => db.prepare(sql).all(...params) as Row[];
const get = (sql: string, ...params: unknown[]) => db.prepare(sql).get(...params) as Row;
const key = (...values: unknown[]) => JSON.stringify(values.map((value) => value ?? null));
const equalMap = (a: Map<string, number>, b: Map<string, number>) => a.size === b.size && [...a].every(([k,v]) => b.get(k) === v);
const setEqual = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((v) => b.has(v));

function profile(runId: number) {
  return {
    run: get(`SELECT id,source_mode,collector_schema_version,status,search_total,page_unit,started_at,completed_at
      FROM collection_runs WHERE id=?`, runId),
    totals: get(`SELECT COUNT(*) total_rows,COUNT(DISTINCT company_name_raw) companies,COUNT(DISTINCT certification_no) certification_numbers,
      COUNT(DISTINCT certification_subject_name) subjects,SUM(is_unlimited=1) unlimited,SUM(status_unknown=1) unknown,
      SUM(status_class='current') current_rows,SUM(status_class='historical') historical_rows,
      SUM(certification_subject_name IS NULL) subject_null,SUM(representative_name_raw IS NULL) representative_null,
      SUM(address_raw IS NULL) address_null,SUM(certification_start_date IS NULL) start_date_null,
      SUM(certification_end_date IS NULL) end_date_null,SUM(candidate_fingerprint IS NULL) fingerprint_null,
      SUM(source_certification_code IS NULL) unmapped_code,SUM(raw_json IS NULL OR raw_json='') raw_json_missing
      FROM certification_snapshot_occurrences WHERE run_id=?`, runId),
    typeCounts: all(`SELECT certification_type,count(*) count FROM certification_snapshot_occurrences WHERE run_id=? GROUP BY certification_type ORDER BY certification_type`,runId),
    codeCounts: all(`SELECT source_certification_code,count(*) count FROM certification_snapshot_occurrences WHERE run_id=? GROUP BY source_certification_code ORDER BY source_certification_code`,runId),
  };
}

function exactMultiset(runId: number): Map<string, number> {
  const rows = all(`SELECT certification_type,certification_no,company_name_raw,certification_subject_name,
    certification_start_date_raw,certification_end_date_raw,COUNT(*) count
    FROM certification_snapshot_occurrences WHERE run_id=?
    GROUP BY certification_type,certification_no,company_name_raw,certification_subject_name,certification_start_date_raw,certification_end_date_raw`,runId);
  return new Map(rows.map((row) => [key(row.certification_type,row.certification_no,row.company_name_raw,row.certification_subject_name,row.certification_start_date_raw,row.certification_end_date_raw),Number(row.count)]));
}

interface CandidateCluster { count: number; signatures: Map<string,number>; periods: Set<string>; }
function candidateClusters(runId: number): Map<string, CandidateCluster> {
  const rows = all(`SELECT candidate_fingerprint,certification_type,certification_no,company_name_raw,certification_subject_name,
    certification_start_date_raw,certification_end_date_raw,COUNT(*) count
    FROM certification_snapshot_occurrences WHERE run_id=? AND candidate_fingerprint IS NOT NULL
    GROUP BY candidate_fingerprint,certification_type,certification_no,company_name_raw,certification_subject_name,certification_start_date_raw,certification_end_date_raw`,runId);
  const result = new Map<string, CandidateCluster>();
  for (const row of rows) {
    const fingerprint = String(row.candidate_fingerprint);
    const current = result.get(fingerprint) ?? { count: 0, signatures: new Map(), periods: new Set() };
    const count = Number(row.count);
    const signature = key(row.certification_type,row.certification_no,row.company_name_raw,row.certification_subject_name,row.certification_start_date_raw,row.certification_end_date_raw);
    current.count += count;
    current.signatures.set(signature,count);
    current.periods.add(key(row.certification_start_date_raw,row.certification_end_date_raw));
    result.set(fingerprint,current);
  }
  return result;
}

function subjectGroups(runId: number): Map<string, Set<string>> {
  const rows = all(`SELECT certification_type,certification_no,company_name_raw,certification_subject_name
    FROM certification_snapshot_occurrences WHERE run_id=? GROUP BY certification_type,certification_no,company_name_raw,certification_subject_name`,runId);
  const result = new Map<string, Set<string>>();
  for (const row of rows) {
    const group = key(row.certification_type,row.certification_no,row.company_name_raw);
    const subjects = result.get(group) ?? new Set<string>();
    subjects.add(String(row.certification_subject_name ?? "∅"));
    result.set(group,subjects);
  }
  return result;
}

const baselineProfile = profile(baselineRunId);
const currentProfile = profile(currentRunId);
const baselineExact = exactMultiset(baselineRunId);
const currentExact = exactMultiset(currentRunId);
let exactSame = 0, exactAddedOccurrences = 0, exactRemovedOccurrences = 0, exactCountChanged = 0;
const exactCountChangeSamples: Row[] = [];
for (const signature of new Set([...baselineExact.keys(),...currentExact.keys()])) {
  const before = baselineExact.get(signature) ?? 0, after = currentExact.get(signature) ?? 0;
  if (before === after) { exactSame += before; continue; }
  if (after > before) exactAddedOccurrences += after - before; else exactRemovedOccurrences += before - after;
  if (before > 0 && after > 0) exactCountChanged += 1;
  if (exactCountChangeSamples.length < 10) exactCountChangeSamples.push({ signature: JSON.parse(signature), baseline_count: before, current_count: after });
}

const baselineCandidates = candidateClusters(baselineRunId);
const currentCandidates = candidateClusters(currentRunId);
const added: string[] = [], removed: string[] = [], unchanged: string[] = [], changedLike: string[] = [], ambiguous: string[] = [], periodChanged: string[] = [], occurrenceCountChanged: string[] = [];
for (const fingerprint of new Set([...baselineCandidates.keys(),...currentCandidates.keys()])) {
  const before = baselineCandidates.get(fingerprint), after = currentCandidates.get(fingerprint);
  if (!before) { added.push(fingerprint); continue; }
  if (!after) { removed.push(fingerprint); continue; }
  if (equalMap(before.signatures, after.signatures)) unchanged.push(fingerprint); else changedLike.push(fingerprint);
  if (!setEqual(before.periods, after.periods)) periodChanged.push(fingerprint);
  if (before.count !== after.count) occurrenceCountChanged.push(fingerprint);
  if (Math.max(...before.signatures.values(),...after.signatures.values()) > 1) ambiguous.push(fingerprint);
}
const baselineSubjects = subjectGroups(baselineRunId), currentSubjects = subjectGroups(currentRunId);
const subjectChanged = [...baselineSubjects.keys()].filter((group) => currentSubjects.has(group) && !setEqual(baselineSubjects.get(group)!,currentSubjects.get(group)!));
const sample = (fingerprints: string[]) => fingerprints.slice(0,10).map((fingerprint) => ({
  fingerprint,
  baseline: baselineCandidates.get(fingerprint) ? { count: baselineCandidates.get(fingerprint)!.count, periods:[...baselineCandidates.get(fingerprint)!.periods] } : null,
  current: currentCandidates.get(fingerprint) ? { count: currentCandidates.get(fingerprint)!.count, periods:[...currentCandidates.get(fingerprint)!.periods] } : null,
}));

const result = {
  baselineRunId,currentRunId,generatedAt:new Date().toISOString(),
  profiles:{baseline:baselineProfile,current:currentProfile},
  exactVisibleMultiset:{baseline_signature_groups:baselineExact.size,current_signature_groups:currentExact.size,unchanged_occurrences:exactSame,added_occurrences:exactAddedOccurrences,removed_occurrences:exactRemovedOccurrences,count_changed_signature_groups:exactCountChanged,samples:exactCountChangeSamples},
  candidateComparison:{unchanged_candidate_count:unchanged.length,added_candidate_count:added.length,removed_candidate_count:removed.length,changed_like_candidate_count:changedLike.length,ambiguous_multiplicity_candidate_count:ambiguous.length,occurrence_count_changed_candidate_count:occurrenceCountChanged.length,period_changed_candidate_count:periodChanged.length,subject_changed_candidate_count:subjectChanged.length,no_candidate_fingerprint:{baseline:Number(baselineProfile.totals.fingerprint_null),current:Number(currentProfile.totals.fingerprint_null)},samples:{added:sample(added),removed:sample(removed),changed_like:sample(changedLike),ambiguous_multiplicity:sample(ambiguous),occurrence_count_changed:sample(occurrenceCountChanged),period_changed:sample(periodChanged),subject_changed:subjectChanged.slice(0,10).map((group)=>({group:JSON.parse(group),baseline_subjects:[...baselineSubjects.get(group)!],current_subjects:[...currentSubjects.get(group)!]}))}},
  interpretation:"Observation-only comparison. No entity, renewal, dedupe, company, or detailed-item decision is created from these categories.",
};
mkdirSync(dirname(outputPath),{recursive:true});
writeFileSync(outputPath,JSON.stringify(result,null,2),"utf8");
console.log(JSON.stringify({outputPath,exact:result.exactVisibleMultiset,candidates:result.candidateComparison},null,2));
db.close();
