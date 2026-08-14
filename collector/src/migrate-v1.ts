import { openDatabase, backfillOccurrenceRun, verifyOccurrenceBackfill } from "./sink.ts";

const runId = Number(process.argv.find((arg) => arg.startsWith("--run-id="))?.split("=", 2)[1] ?? "8");
if (!Number.isInteger(runId) || runId < 1) throw new Error("--run-id must be a positive integer");

const db = openDatabase();
try {
  console.log(`migration_start run_id=${runId}`);
  const inserted = backfillOccurrenceRun(db, runId);
  const verification = verifyOccurrenceBackfill(db, runId);
  console.log(`migration_backfill_inserted=${inserted}`);
  console.log(`migration_verification=${JSON.stringify(verification)}`);
  console.log("migration_complete");
} finally {
  db.close();
}
