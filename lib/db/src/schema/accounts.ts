import { relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { contractsTable, organizationsTable } from "./provenance.js";

/* ==================================================================
   Accounts: people who sign in with GitHub, their sessions, and the
   organizations they belong to.
   ================================================================== */

export const usersTable = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    githubUserId: varchar("github_user_id", { length: 64 }).notNull().unique(),
    login: varchar("login", { length: 100 }).notNull(),
    name: varchar("name", { length: 255 }),
    email: varchar("email", { length: 320 }),
    avatarUrl: text("avatar_url"),
    // AES-256-GCM payloads (see api-server linear/crypto.ts); never plain tokens.
    githubTokenJson: jsonb("github_token_json"),
    githubRefreshTokenJson: jsonb("github_refresh_token_json"),
    githubTokenExpiresAt: timestamp("github_token_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("users_github_uidx").on(table.githubUserId)],
).enableRLS();

export const userSessionsTable = pgTable(
  "user_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // SHA-256 of the cookie value; the cookie itself is never stored.
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    // The workspace this session is working in; null means the first one joined.
    organizationId: uuid("organization_id").references(() => organizationsTable.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("user_sessions_user_idx").on(table.userId)],
).enableRLS();

export const organizationMembersTable = pgTable(
  "organization_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).default("OWNER").notNull(), // OWNER, MEMBER
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("org_member_uidx").on(table.organizationId, table.userId),
    index("org_member_user_idx").on(table.userId),
  ],
).enableRLS();

/* ==================================================================
   Invites: a single-use link an owner shares to add someone to a
   workspace. Only the SHA-256 of the link's token is stored.
   ================================================================== */

export const organizationInvitesTable = pgTable(
  "organization_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    role: varchar("role", { length: 20 }).default("MEMBER").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("org_invite_org_idx").on(table.organizationId)],
).enableRLS();

/* ==================================================================
   Projects: one client engagement. Holds the contract whose active
   baseline pull requests are checked against, the GitHub repository
   they come from, and how results are priced and reported.
   ================================================================== */

export const projectsTable = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 160 }).notNull(),
    clientName: varchar("client_name", { length: 160 }),
    hourlyRate: integer("hourly_rate"), // whole currency units; null = don't price work
    currency: varchar("currency", { length: 10 }).default("USD").notNull(),
    policyMode: varchar("policy_mode", { length: 20 }).default("OBSERVE").notNull(), // OBSERVE, REVIEW, ENFORCE
    contractId: uuid("contract_id").references(() => contractsTable.id, { onDelete: "set null" }),
    githubInstallationId: varchar("github_installation_id", { length: 255 }),
    repositoryExternalId: varchar("repository_external_id", { length: 255 }),
    repositoryFullName: varchar("repository_full_name", { length: 255 }),
    createdByUserId: uuid("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("project_org_idx").on(table.organizationId),
    // A repository feeds one project; Postgres lets any number of rows have none.
    uniqueIndex("project_repo_uidx").on(table.repositoryExternalId),
  ],
).enableRLS();

export const usersRelations = relations(usersTable, ({ many }) => ({
  sessions: many(userSessionsTable),
  memberships: many(organizationMembersTable),
}));

export const userSessionsRelations = relations(userSessionsTable, ({ one }) => ({
  user: one(usersTable, { fields: [userSessionsTable.userId], references: [usersTable.id] }),
}));

export const organizationMembersRelations = relations(organizationMembersTable, ({ one }) => ({
  organization: one(organizationsTable, {
    fields: [organizationMembersTable.organizationId],
    references: [organizationsTable.id],
  }),
  user: one(usersTable, { fields: [organizationMembersTable.userId], references: [usersTable.id] }),
}));

export const projectsRelations = relations(projectsTable, ({ one }) => ({
  organization: one(organizationsTable, {
    fields: [projectsTable.organizationId],
    references: [organizationsTable.id],
  }),
  contract: one(contractsTable, { fields: [projectsTable.contractId], references: [contractsTable.id] }),
}));
