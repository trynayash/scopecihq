import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/* ==================================================================
   1. Organizations
   ================================================================== */

export const organizationsTable = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("org_slug_idx").on(table.slug),
    index("org_created_at_idx").on(table.createdAt),
  ]
);

export const organizationsRelations = relations(organizationsTable, ({ many }) => ({
  contracts: many(contractsTable),
  projectLinks: many(projectLinksTable),
  issues: many(issuesTable),
  pullRequests: many(pullRequestsTable),
  changeOrders: many(changeOrdersTable),
  events: many(commercialEventsTable),
}));

/* ==================================================================
   2. Contracts
   ================================================================== */

export const contractsTable = pgTable(
  "contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 255 }).notNull(),
    sourceFilename: text("source_filename").notNull(),
    sourceType: varchar("source_type", { length: 50 }).default("PDF").notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    currency: varchar("currency", { length: 10 }).default("USD").notNull(),
    status: varchar("status", { length: 50 }).default("ACTIVE").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("contract_org_idx").on(table.organizationId),
    index("contract_status_idx").on(table.status),
    index("contract_created_at_idx").on(table.createdAt),
  ]
);

export const contractsRelations = relations(contractsTable, ({ one, many }) => ({
  organization: one(organizationsTable, {
    fields: [contractsTable.organizationId],
    references: [organizationsTable.id],
  }),
  scopeBaselines: many(scopeBaselinesTable),
  changeOrders: many(changeOrdersTable),
}));

/* ==================================================================
   3. Scope Baselines
   ================================================================== */

export const scopeBaselinesTable = pgTable(
  "scope_baselines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contractsTable.id, { onDelete: "restrict" }),
    versionNumber: varchar("version_number", { length: 50 }).notNull(), // e.g. "v1", "v2"
    status: varchar("status", { length: 50 }).default("ACTIVE").notNull(), // ACTIVE, SUPERSEDED, ARCHIVED
    createdBy: varchar("created_by", { length: 255 }).notNull(),
    sourceChangeOrderId: uuid("source_change_order_id"),
    supersedesBaselineId: uuid("supersedes_baseline_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("contract_version_uidx").on(table.contractId, table.versionNumber),
    index("baseline_contract_idx").on(table.contractId),
    index("baseline_status_idx").on(table.status),
  ]
);

export const scopeBaselinesRelations = relations(scopeBaselinesTable, ({ one, many }) => ({
  contract: one(contractsTable, {
    fields: [scopeBaselinesTable.contractId],
    references: [contractsTable.id],
  }),
  supersededBy: one(scopeBaselinesTable, {
    fields: [scopeBaselinesTable.supersedesBaselineId],
    references: [scopeBaselinesTable.id],
  }),
  clauses: many(contractClausesTable),
  deliverables: many(deliverablesTable),
  evaluations: many(commercialEvaluationsTable),
}));

/* ==================================================================
   4. Change Orders
   ================================================================== */

export const changeOrdersTable = pgTable(
  "change_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contractsTable.id, { onDelete: "restrict" }),
    sourceBaselineId: uuid("source_baseline_id")
      .notNull()
      .references(() => scopeBaselinesTable.id, { onDelete: "restrict" }),
    resultingBaselineId: uuid("resulting_baseline_id").references(() => scopeBaselinesTable.id, {
      onDelete: "restrict",
    }),
    reference: varchar("reference", { length: 50 }).notNull(), // e.g. "CO-12"
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description").notNull(),
    estimatedHoursMin: integer("estimated_hours_min").notNull(),
    estimatedHoursMax: integer("estimated_hours_max").notNull(),
    estimatedValueMin: integer("estimated_value_min").notNull(),
    estimatedValueMax: integer("estimated_value_max").notNull(),
    currency: varchar("currency", { length: 10 }).default("USD").notNull(),
    status: varchar("status", { length: 50 }).default("PENDING").notNull(), // PENDING, APPROVED, REJECTED
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("co_org_idx").on(table.organizationId),
    index("co_contract_idx").on(table.contractId),
    index("co_reference_idx").on(table.reference),
    index("co_status_idx").on(table.status),
  ]
);

export const changeOrdersRelations = relations(changeOrdersTable, ({ one }) => ({
  organization: one(organizationsTable, {
    fields: [changeOrdersTable.organizationId],
    references: [organizationsTable.id],
  }),
  contract: one(contractsTable, {
    fields: [changeOrdersTable.contractId],
    references: [contractsTable.id],
  }),
  sourceBaseline: one(scopeBaselinesTable, {
    fields: [changeOrdersTable.sourceBaselineId],
    references: [scopeBaselinesTable.id],
  }),
  resultingBaseline: one(scopeBaselinesTable, {
    fields: [changeOrdersTable.resultingBaselineId],
    references: [scopeBaselinesTable.id],
  }),
}));

/* ==================================================================
   5. Contract Clauses
   ================================================================== */

export const contractClausesTable = pgTable(
  "contract_clauses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scopeBaselineId: uuid("scope_baseline_id")
      .notNull()
      .references(() => scopeBaselinesTable.id, { onDelete: "restrict" }),
    clauseNumber: varchar("clause_number", { length: 50 }).notNull(), // e.g. "§4.2"
    title: varchar("title", { length: 255 }).notNull(),
    legalText: text("legal_text").notNull(),
    boundaryType: varchar("boundary_type", { length: 50 }).notNull(), // INCLUSION, EXCLUSION, ASSUMPTION, LIMITATION, OTHER
    sourcePage: integer("source_page"),
    sourceLocation: varchar("source_location", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("clause_baseline_idx").on(table.scopeBaselineId),
    index("clause_number_idx").on(table.clauseNumber),
    index("clause_boundary_idx").on(table.boundaryType),
  ]
);

export const contractClausesRelations = relations(contractClausesTable, ({ one, many }) => ({
  scopeBaseline: one(scopeBaselinesTable, {
    fields: [contractClausesTable.scopeBaselineId],
    references: [scopeBaselinesTable.id],
  }),
  deliverables: many(deliverablesTable),
}));

/* ==================================================================
   6. Deliverables
   ================================================================== */

export const deliverablesTable = pgTable(
  "deliverables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scopeBaselineId: uuid("scope_baseline_id")
      .notNull()
      .references(() => scopeBaselinesTable.id, { onDelete: "restrict" }),
    clauseId: uuid("clause_id").references(() => contractClausesTable.id, { onDelete: "set null" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description").notNull(),
    acceptanceCriteria: text("acceptance_criteria").notNull(),
    boundarySummary: text("boundary_summary").notNull(),
    allocatedHours: integer("allocated_hours"),
    allocatedBudget: integer("allocated_budget"),
    currency: varchar("currency", { length: 10 }).default("USD"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("deliv_baseline_idx").on(table.scopeBaselineId),
    index("deliv_clause_idx").on(table.clauseId),
  ]
);

export const deliverablesRelations = relations(deliverablesTable, ({ one, many }) => ({
  scopeBaseline: one(scopeBaselinesTable, {
    fields: [deliverablesTable.scopeBaselineId],
    references: [scopeBaselinesTable.id],
  }),
  clause: one(contractClausesTable, {
    fields: [deliverablesTable.clauseId],
    references: [contractClausesTable.id],
  }),
  issueLinks: many(issueDeliverableLinksTable),
}));

/* ==================================================================
   7. Project Links
   ================================================================== */

export const projectLinksTable = pgTable(
  "project_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    provider: varchar("provider", { length: 50 }).notNull(), // LINEAR, JIRA
    externalProjectId: varchar("external_project_id", { length: 255 }).notNull(),
    externalProjectName: varchar("external_project_name", { length: 255 }).notNull(),
    externalTeamId: varchar("external_team_id", { length: 255 }),
    repositoryProvider: varchar("repository_provider", { length: 50 }).default("GITHUB").notNull(),
    repositoryExternalId: varchar("repository_external_id", { length: 255 }).notNull(),
    repositoryFullName: varchar("repository_full_name", { length: 255 }).notNull(), // e.g. "northstar/api"
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("projlink_org_idx").on(table.organizationId),
    index("projlink_repo_idx").on(table.repositoryFullName),
  ]
);

export const projectLinksRelations = relations(projectLinksTable, ({ one, many }) => ({
  organization: one(organizationsTable, {
    fields: [projectLinksTable.organizationId],
    references: [organizationsTable.id],
  }),
  pullRequests: many(pullRequestsTable),
}));

/* ==================================================================
   8. Issues (Linear / Jira)
   ================================================================== */

export const issuesTable = pgTable(
  "issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    externalProvider: varchar("external_provider", { length: 50 }).notNull(), // LINEAR, JIRA
    externalId: varchar("external_id", { length: 255 }).notNull(),
    identifier: varchar("identifier", { length: 100 }).notNull(), // e.g. "ENG-184"
    title: text("title").notNull(),
    description: text("description").notNull(),
    status: varchar("status", { length: 50 }).notNull(),
    estimate: integer("estimate"),
    url: text("url"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("issue_provider_external_uidx").on(table.externalProvider, table.externalId),
    index("issue_org_idx").on(table.organizationId),
    index("issue_identifier_idx").on(table.identifier),
  ]
);

export const issuesRelations = relations(issuesTable, ({ one, many }) => ({
  organization: one(organizationsTable, {
    fields: [issuesTable.organizationId],
    references: [organizationsTable.id],
  }),
  deliverableLinks: many(issueDeliverableLinksTable),
  prLinks: many(prIssueLinksTable),
}));

/* ==================================================================
   9. Issue → Deliverable Links
   ================================================================== */

export const issueDeliverableLinksTable = pgTable(
  "issue_deliverable_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issuesTable.id, { onDelete: "restrict" }),
    deliverableId: uuid("deliverable_id")
      .notNull()
      .references(() => deliverablesTable.id, { onDelete: "restrict" }),
    associationType: varchar("association_type", { length: 50 }).default("DIRECT").notNull(), // DIRECT, PARTIAL, INFERRED
    confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull(), // 0.0000 - 1.0000
    evidenceJson: jsonb("evidence_json").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idl_issue_idx").on(table.issueId),
    index("idl_deliverable_idx").on(table.deliverableId),
  ]
);

export const issueDeliverableLinksRelations = relations(issueDeliverableLinksTable, ({ one }) => ({
  issue: one(issuesTable, {
    fields: [issueDeliverableLinksTable.issueId],
    references: [issuesTable.id],
  }),
  deliverable: one(deliverablesTable, {
    fields: [issueDeliverableLinksTable.deliverableId],
    references: [deliverablesTable.id],
  }),
}));

/* ==================================================================
   10. Pull Requests
   ================================================================== */

export const pullRequestsTable = pgTable(
  "pull_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    projectLinkId: uuid("project_link_id").references(() => projectLinksTable.id, {
      onDelete: "set null",
    }),
    externalProvider: varchar("external_provider", { length: 50 }).default("GITHUB").notNull(),
    externalId: varchar("external_id", { length: 255 }).notNull(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    headBranch: varchar("head_branch", { length: 255 }).notNull(),
    baseBranch: varchar("base_branch", { length: 255 }).notNull(),
    authorExternalId: varchar("author_external_id", { length: 255 }).notNull(),
    url: text("url").notNull(),
    state: varchar("state", { length: 50 }).default("OPEN").notNull(), // OPEN, CLOSED, MERGED
    isDraft: boolean("is_draft").default(false).notNull(),
    additions: integer("additions").default(0).notNull(),
    deletions: integer("deletions").default(0).notNull(),
    changedFiles: integer("changed_files").default(0).notNull(),
    commitsCount: integer("commits_count").default(0).notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("pr_provider_external_uidx").on(table.externalProvider, table.externalId),
    index("pr_org_idx").on(table.organizationId),
    index("pr_number_idx").on(table.number),
    index("pr_state_idx").on(table.state),
    index("pr_head_branch_idx").on(table.headBranch),
  ]
);

export const pullRequestsRelations = relations(pullRequestsTable, ({ one, many }) => ({
  organization: one(organizationsTable, {
    fields: [pullRequestsTable.organizationId],
    references: [organizationsTable.id],
  }),
  projectLink: one(projectLinksTable, {
    fields: [pullRequestsTable.projectLinkId],
    references: [projectLinksTable.id],
  }),
  issueLinks: many(prIssueLinksTable),
  diffAnalyses: many(prDiffAnalysesTable),
  evaluations: many(commercialEvaluationsTable),
}));

/* ==================================================================
   11. PR → Issue Links
   ================================================================== */

export const prIssueLinksTable = pgTable(
  "pr_issue_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pullRequestId: uuid("pull_request_id")
      .notNull()
      .references(() => pullRequestsTable.id, { onDelete: "restrict" }),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issuesTable.id, { onDelete: "restrict" }),
    linkMethod: varchar("link_method", { length: 50 }).notNull(), // BRANCH_NAME, PR_TITLE, PR_BODY, COMMIT_MESSAGE, WEBHOOK, MANUAL
    confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull(),
    evidence: text("evidence"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("pil_pr_idx").on(table.pullRequestId),
    index("pil_issue_idx").on(table.issueId),
  ]
);

export const prIssueLinksRelations = relations(prIssueLinksTable, ({ one }) => ({
  pullRequest: one(pullRequestsTable, {
    fields: [prIssueLinksTable.pullRequestId],
    references: [pullRequestsTable.id],
  }),
  issue: one(issuesTable, {
    fields: [prIssueLinksTable.issueId],
    references: [issuesTable.id],
  }),
}));

/* ==================================================================
   12. PR Diff Analyses
   ================================================================== */

export const prDiffAnalysesTable = pgTable(
  "pr_diff_analyses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pullRequestId: uuid("pull_request_id")
      .notNull()
      .references(() => pullRequestsTable.id, { onDelete: "restrict" }),
    analysisVersion: integer("analysis_version").default(1).notNull(),
    status: varchar("status", { length: 50 }).default("COMPLETED").notNull(), // PENDING, COMPLETED, FAILED
    filesChangedJson: jsonb("files_changed_json").default([]).notNull(),
    subsystemsJson: jsonb("subsystems_json").default([]).notNull(),
    scopeDeltaJson: jsonb("scope_delta_json").default([]).notNull(),
    summary: text("summary").notNull(),
    modelProvider: varchar("model_provider", { length: 50 }),
    modelVersion: varchar("model_version", { length: 50 }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("diff_analysis_pr_idx").on(table.pullRequestId),
    index("diff_analysis_status_idx").on(table.status),
  ]
);

export const prDiffAnalysesRelations = relations(prDiffAnalysesTable, ({ one, many }) => ({
  pullRequest: one(pullRequestsTable, {
    fields: [prDiffAnalysesTable.pullRequestId],
    references: [pullRequestsTable.id],
  }),
  evaluations: many(commercialEvaluationsTable),
}));

/* ==================================================================
   13. Commercial Evaluations
   ================================================================== */

export const commercialEvaluationsTable = pgTable(
  "commercial_evaluations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pullRequestId: uuid("pull_request_id")
      .notNull()
      .references(() => pullRequestsTable.id, { onDelete: "restrict" }),
    scopeBaselineId: uuid("scope_baseline_id")
      .notNull()
      .references(() => scopeBaselinesTable.id, { onDelete: "restrict" }),
    prDiffAnalysisId: uuid("pr_diff_analysis_id").references(() => prDiffAnalysesTable.id, {
      onDelete: "set null",
    }),
    state: varchar("state", { length: 50 }).notNull(), // IN_SCOPE, REVIEW_REQUIRED, CHANGE_REQUIRED, APPROVED_CHANGE, BLOCKED, OVERRIDDEN
    policyMode: varchar("policy_mode", { length: 50 }).default("REVIEW").notNull(), // OBSERVE, REVIEW, ENFORCE
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    contractClauseIdsJson: jsonb("contract_clause_ids_json").default([]).notNull(),
    deliverableIdsJson: jsonb("deliverable_ids_json").default([]).notNull(),
    issueIdsJson: jsonb("issue_ids_json").default([]).notNull(),
    evidenceJson: jsonb("evidence_json").default([]).notNull(),
    estimatedHoursMin: integer("estimated_hours_min"),
    estimatedHoursMax: integer("estimated_hours_max"),
    estimatedValueMin: integer("estimated_value_min"),
    estimatedValueMax: integer("estimated_value_max"),
    currency: varchar("currency", { length: 10 }).default("USD"),
    reason: text("reason").notNull(),
    evaluatorVersion: varchar("evaluator_version", { length: 50 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("eval_pr_idx").on(table.pullRequestId),
    index("eval_baseline_idx").on(table.scopeBaselineId),
    index("eval_state_idx").on(table.state),
    index("eval_created_at_idx").on(table.createdAt),
  ]
);

export const commercialEvaluationsRelations = relations(commercialEvaluationsTable, ({ one, many }) => ({
  pullRequest: one(pullRequestsTable, {
    fields: [commercialEvaluationsTable.pullRequestId],
    references: [pullRequestsTable.id],
  }),
  scopeBaseline: one(scopeBaselinesTable, {
    fields: [commercialEvaluationsTable.scopeBaselineId],
    references: [scopeBaselinesTable.id],
  }),
  diffAnalysis: one(prDiffAnalysesTable, {
    fields: [commercialEvaluationsTable.prDiffAnalysisId],
    references: [prDiffAnalysesTable.id],
  }),
  approvals: many(commercialApprovalsTable),
}));

/* ==================================================================
   14. Commercial Approvals
   ================================================================== */

export const commercialApprovalsTable = pgTable(
  "commercial_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commercialEvaluationId: uuid("commercial_evaluation_id")
      .notNull()
      .references(() => commercialEvaluationsTable.id, { onDelete: "restrict" }),
    approvalType: varchar("approval_type", { length: 50 }).notNull(), // within_budget, change_order, absorb_scope, override
    approverType: varchar("approver_type", { length: 50 }).notNull(), // CLIENT, PM, AGENCY_LEAD
    approverExternalId: text("approver_external_id"),
    approverName: text("approver_name"),
    changeOrderRef: varchar("change_order_ref", { length: 50 }),
    notes: text("notes"),
    previousState: varchar("previous_state", { length: 50 }).notNull(),
    newState: varchar("new_state", { length: 50 }).notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("approval_eval_idx").on(table.commercialEvaluationId),
    index("approval_type_idx").on(table.approvalType),
  ]
);

export const commercialApprovalsRelations = relations(commercialApprovalsTable, ({ one }) => ({
  evaluation: one(commercialEvaluationsTable, {
    fields: [commercialApprovalsTable.commercialEvaluationId],
    references: [commercialEvaluationsTable.id],
  }),
}));

/* ==================================================================
   15. Commercial Events (Immutable Append-Only Audit Log)
   ================================================================== */

export const commercialEventsTable = pgTable(
  "commercial_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    entityType: varchar("entity_type", { length: 50 }).notNull(), // PULL_REQUEST, EVALUATION, APPROVAL, BASELINE
    entityId: text("entity_id").notNull(),
    eventType: varchar("event_type", { length: 100 }).notNull(), // PR_RECEIVED, EVALUATION_CREATED, COMMERCIAL_APPROVED, etc.
    actorType: varchar("actor_type", { length: 50 }).notNull(), // SYSTEM, PM, CLIENT, DEVELOPER
    actorId: text("actor_id"),
    previousState: varchar("previous_state", { length: 50 }),
    newState: varchar("new_state", { length: 50 }),
    reason: text("reason"),
    metadataJson: jsonb("metadata_json").default({}).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("cevt_org_idx").on(table.organizationId),
    index("cevt_entity_idx").on(table.entityType, table.entityId),
    index("cevt_type_idx").on(table.eventType),
    index("cevt_occurred_at_idx").on(table.occurredAt),
  ]
);

export const commercialEventsRelations = relations(commercialEventsTable, ({ one }) => ({
  organization: one(organizationsTable, {
    fields: [commercialEventsTable.organizationId],
    references: [organizationsTable.id],
  }),
}));
