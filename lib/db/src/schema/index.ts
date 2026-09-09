import { createInsertSchema } from "drizzle-zod";
import { pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const waitlistSignupsTable = pgTable("waitlist_signups", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  agency: varchar("agency", { length: 160 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertWaitlistSignupSchema = createInsertSchema(waitlistSignupsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertWaitlistSignup = z.infer<typeof insertWaitlistSignupSchema>;
export type WaitlistSignup = typeof waitlistSignupsTable.$inferSelect;