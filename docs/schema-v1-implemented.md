# Current collection schema

The collector writes certification data to `certification_records` and keeps operational history in `collection_runs`, `collection_run_pages`, and `collection_diagnostics`.

The retired full-snapshot accumulation schema is no longer created or written by the application. Existing legacy database tables and their data are intentionally left in place; this change performs no data deletion or schema drop.

Search reads the latest preferred run from `certification_records`. The source certification code mapping table remains available for validating public SMPP certification type mappings.
