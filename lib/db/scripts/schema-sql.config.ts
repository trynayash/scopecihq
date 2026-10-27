import { defineConfig } from "drizzle-kit";

// Only used by scripts/build-schema-sql.mjs to print the full schema as SQL.
export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./.schema-sql-tmp",
  dialect: "postgresql",
});
