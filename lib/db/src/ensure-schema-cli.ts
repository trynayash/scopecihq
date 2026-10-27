import { pool } from "./index.js";
import { ensureSchema } from "./ensure-schema.js";

// `pnpm run db:ensure`: what the API server does on start, on its own.
const { warnings } = await ensureSchema(pool);
for (const warning of warnings) console.warn(`warning: ${warning}`);
console.log("Schema is up to date.");
await pool.end();
