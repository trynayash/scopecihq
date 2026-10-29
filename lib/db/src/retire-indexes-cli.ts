import { pool } from "./index.js";
import { dropRetiredIndexes } from "./ensure-schema.js";

// `pnpm run db:retire`: drops the indexes a release retired, which the server
// does a few minutes after it starts. Only for SCOPECI_SCHEMA_SYNC=off, and
// only once the previous release has stopped: it still needs them.
await dropRetiredIndexes(pool);
console.log("Retired indexes dropped.");
await pool.end();
