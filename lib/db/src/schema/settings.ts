import { jsonb, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * Server-wide settings made from the admin page rather than the environment,
 * such as the GitHub App created there. The API encrypts secret values before
 * they reach this table.
 */
export const appSettingsTable = pgTable("app_settings", {
  key: varchar("key", { length: 100 }).primaryKey(),
  valueJson: jsonb("value_json").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();
