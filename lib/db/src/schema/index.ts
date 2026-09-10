import { createInsertSchema } from "drizzle-zod";
import { pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";
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
});

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
});

export const insertSiteEventSchema = createInsertSchema(siteEventsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertSiteEvent = z.infer<typeof insertSiteEventSchema>;
export type SiteEvent = typeof siteEventsTable.$inferSelect;

/* ==================================================================
   ScopeCI Commercial Provenance Graph
   ================================================================== */

export * from "./provenance.js";