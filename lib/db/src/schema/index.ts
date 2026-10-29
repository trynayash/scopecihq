import { createInsertSchema } from "drizzle-zod";
import { index, pgTable, serial, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

/* ==================================================================
   Existing Landing Page Tables (Preserved)
   ================================================================== */

export const waitlistSignupsTable = pgTable("waitlist_signups", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  agency: varchar("agency", { length: 160 }),
  utmSource: varchar("utm_source", { length: 100 }),
  utmMedium: varchar("utm_medium", { length: 100 }),
  utmCampaign: varchar("utm_campaign", { length: 200 }),
  utmContent: varchar("utm_content", { length: 200 }),
  utmTerm: varchar("utm_term", { length: 200 }),
  referrer: varchar("referrer", { length: 2000 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();

export const insertWaitlistSignupSchema = createInsertSchema(waitlistSignupsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertWaitlistSignup = z.infer<typeof insertWaitlistSignupSchema>;
export type WaitlistSignup = typeof waitlistSignupsTable.$inferSelect;

export const siteEventsTable = pgTable("site_events", {
  id: serial("id").primaryKey(),
  event: varchar("event", { length: 80 }).notNull(),
  source: varchar("source", { length: 100 }),
  medium: varchar("medium", { length: 100 }),
  campaign: varchar("campaign", { length: 200 }),
  referrer: varchar("referrer", { length: 2000 }),
  landingPage: varchar("landing_page", { length: 2000 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();

export const insertSiteEventSchema = createInsertSchema(siteEventsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertSiteEvent = z.infer<typeof insertSiteEventSchema>;
export type SiteEvent = typeof siteEventsTable.$inferSelect;

/**
 * Messages sent through the site's contact form, read on the admin page and
 * answered by email. ScopeCI publishes no address, so this is how people
 * reach it. Only what the form asks for is kept: no IP address, user agent
 * or cookie. Rows older than 365 days are deleted by the API's hourly purge.
 */
export const contactMessagesTable = pgTable(
  "contact_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 120 }).notNull(),
    email: varchar("email", { length: 254 }).notNull(),
    company: varchar("company", { length: 200 }),
    // general, pilot, privacy, security, grievance or legal; the API checks it.
    topic: varchar("topic", { length: 20 }).notNull(),
    message: varchar("message", { length: 5000 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  // Newest first on the admin page, today's count for the daily cap, and
  // the retention purge all read by date.
  (table) => [index("contact_messages_created_at_idx").on(table.createdAt)],
).enableRLS();

export type ContactMessageRow = typeof contactMessagesTable.$inferSelect;

/* ==================================================================
   ScopeCI Commercial Provenance Graph
   ================================================================== */

export * from "./provenance.js";
export * from "./github.js";
export * from "./linear.js";
export * from "./accounts.js";
export * from "./settings.js";
