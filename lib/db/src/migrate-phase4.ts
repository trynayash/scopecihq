import { pool } from "./index.js";

async function run() {
  console.log("Applying Phase 4 schema extensions to commercial_evaluations...");

  await pool.query(`
    ALTER TABLE commercial_evaluations 
      ADD COLUMN IF NOT EXISTS evaluation_status varchar(50) DEFAULT 'COMPLETED' NOT NULL,
      ADD COLUMN IF NOT EXISTS scope_taxonomy varchar(50) DEFAULT 'CLEARLY_IN_SCOPE',
      ADD COLUMN IF NOT EXISTS review_reason_code varchar(50),
      ADD COLUMN IF NOT EXISTS commercial_confidence numeric(5, 4),
      ADD COLUMN IF NOT EXISTS model_confidence numeric(5, 4),
      ADD COLUMN IF NOT EXISTS evaluation_identity_hash varchar(64),
      ADD COLUMN IF NOT EXISTS document_version varchar(50),
      ADD COLUMN IF NOT EXISTS issue_snapshot_hash varchar(64),
      ADD COLUMN IF NOT EXISTS model_version varchar(50),
      ADD COLUMN IF NOT EXISTS prompt_version varchar(50),
      ADD COLUMN IF NOT EXISTS evidence_bundle_json jsonb,
      ADD COLUMN IF NOT EXISTS decision_explanation_json jsonb;

    CREATE INDEX IF NOT EXISTS eval_status_idx ON commercial_evaluations(evaluation_status);
    CREATE INDEX IF NOT EXISTS eval_identity_hash_idx ON commercial_evaluations(evaluation_identity_hash);
  `);

  console.log("Phase 4 schema extensions applied successfully.");
  await pool.end();
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
