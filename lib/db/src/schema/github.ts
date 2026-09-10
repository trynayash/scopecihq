import { relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import {
  organizationsTable,
  pullRequestsTable,
  commercialEvaluationsTable,
} from "./provenance.js";

/* ==================================================================
   1. GitHub Installations
   Maps GitHub App installation ID to a ScopeCI Organization
   ================================================================== */

export const githubInstallationsTable = pgTable(
  "github_installations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    installationId: varchar("installation_id", { length: 255 }).notNull().unique(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    githubAccountId: varchar("github_account_id", { length: 255 }).notNull(),
    githubAccountLogin: varchar("github_account_login", { length: 255 }).notNull(),
    githubAccountType: varchar("github_account_type", { length: 50 }).notNull(), // Organization, User
    permissionsJson: jsonb("permissions_json").default({}).notNull(),
    repositorySelection: varchar("repository_selection", { length: 50 }).default("selected").notNull(), // all, selected
    installedBy: varchar("installed_by", { length: 255 }),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("gh_install_external_uidx").on(table.installationId),
    index("gh_install_org_idx").on(table.organizationId),
    index("gh_install_account_idx").on(table.githubAccountLogin),
  ]
);

export const githubInstallationsRelations = relations(githubInstallationsTable, ({ one }) => ({
  organization: one(organizationsTable, {
    fields: [githubInstallationsTable.organizationId],
    references: [organizationsTable.id],
  }),
}));

/* ==================================================================
   2. Webhook Deliveries
   Ensures delivery idempotency via X-GitHub-Delivery.
   Stores essential audit metadata with an expiration retention policy.
   ================================================================== */

export const webhookDeliveriesTable = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deliveryId: varchar("delivery_id", { length: 255 }).notNull().unique(), // X-GitHub-Delivery
    eventType: varchar("event_type", { length: 100 }).notNull(), // pull_request, ping, etc.
    action: varchar("action", { length: 100 }), // opened, synchronize, reopened, closed
    installationId: varchar("installation_id", { length: 255 }),
    repositoryFullName: varchar("repository_full_name", { length: 255 }),
    headSha: varchar("head_sha", { length: 64 }),
    prNumber: integer("pr_number"),
    senderLogin: varchar("sender_login", { length: 255 }),
    summaryJson: jsonb("summary_json").default({}).notNull(), // Essential debug metadata only, never unbounded raw blobs
    status: varchar("status", { length: 50 }).default("PENDING").notNull(), // PENDING, PROCESSED, FAILED, IGNORED
    errorMessage: text("error_message"),
    expiresAt: timestamp("expires_at", { withTimezone: true }), // Retention policy cutoff
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("webhook_delivery_uidx").on(table.deliveryId),
    index("webhook_delivery_event_idx").on(table.eventType),
    index("webhook_delivery_status_idx").on(table.status),
    index("webhook_delivery_repo_idx").on(table.repositoryFullName),
    index("webhook_delivery_expires_idx").on(table.expiresAt),
  ]
);

/* ==================================================================
   3. GitHub Check Runs
   Tracks ScopeCI check runs per PR & headSha for check-run idempotency.
   Guarantees: PR revision SHA -> Diff SHA -> Evaluation -> Check Run
   ================================================================== */

export const githubCheckRunsTable = pgTable(
  "github_check_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pullRequestId: uuid("pull_request_id")
      .notNull()
      .references(() => pullRequestsTable.id, { onDelete: "restrict" }),
    githubCheckRunId: varchar("github_check_run_id", { length: 255 }).notNull().unique(),
    checkName: varchar("check_name", { length: 255 }).default("scopeci / commercial").notNull(),
    headSha: varchar("head_sha", { length: 64 }).notNull(),
    status: varchar("status", { length: 50 }).default("completed").notNull(), // queued, in_progress, completed
    conclusion: varchar("conclusion", { length: 50 }).default("neutral").notNull(), // neutral, success, failure, action_required
    title: varchar("title", { length: 255 }).notNull(),
    summary: text("summary").notNull(),
    detailsUrl: text("details_url"),
    externalId: text("external_id"),
    latestEvaluationId: uuid("latest_evaluation_id").references(() => commercialEvaluationsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("gh_check_run_external_uidx").on(table.githubCheckRunId),
    index("gh_check_run_pr_idx").on(table.pullRequestId),
    index("gh_check_run_sha_idx").on(table.headSha),
    index("gh_check_run_conclusion_idx").on(table.conclusion),
  ]
);

export const githubCheckRunsRelations = relations(githubCheckRunsTable, ({ one }) => ({
  pullRequest: one(pullRequestsTable, {
    fields: [githubCheckRunsTable.pullRequestId],
    references: [pullRequestsTable.id],
  }),
  latestEvaluation: one(commercialEvaluationsTable, {
    fields: [githubCheckRunsTable.latestEvaluationId],
    references: [commercialEvaluationsTable.id],
  }),
}));
