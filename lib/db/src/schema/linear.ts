import { relations } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./provenance.js";

/* ==================================================================
   1. Linear Connections
   Stores workspace connection metadata with authenticated AES-256-GCM
   encrypted tokens and key-version tracking for key rotation.
   ================================================================== */

export const linearConnectionsTable = pgTable(
  "linear_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    linearWorkspaceId: varchar("linear_workspace_id", { length: 255 }).notNull(),
    linearWorkspaceName: varchar("linear_workspace_name", { length: 255 }).notNull(),
    linearUserId: varchar("linear_user_id", { length: 255 }),
    status: varchar("status", { length: 50 }).default("ACTIVE").notNull(), // ACTIVE, REVOKED, EXPIRED
    scope: varchar("scope", { length: 255 }).default("read,write").notNull(),
    
    // Authenticated encryption storage with key rotation tracking
    encryptedAccessToken: text("encrypted_access_token").notNull(),
    encryptedRefreshToken: text("encrypted_refresh_token"),
    tokenIv: varchar("token_iv", { length: 64 }).notNull(), // Nonce / IV
    tokenAuthTag: varchar("token_auth_tag", { length: 64 }).notNull(), // GCM Authentication Tag
    keyVersion: varchar("key_version", { length: 50 }).default("v1").notNull(), // Key rotation version
    
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("linear_org_workspace_uidx").on(table.organizationId, table.linearWorkspaceId),
    index("linear_conn_org_idx").on(table.organizationId),
    index("linear_conn_workspace_idx").on(table.linearWorkspaceId),
    index("linear_conn_status_idx").on(table.status),
  ]
);

export const linearConnectionsRelations = relations(linearConnectionsTable, ({ one }) => ({
  organization: one(organizationsTable, {
    fields: [linearConnectionsTable.organizationId],
    references: [organizationsTable.id],
  }),
}));

/* ==================================================================
   2. Linear Webhook Deliveries
   Ensures delivery idempotency and revision-awareness.
   Rejects stale delayed updates based on provider timestamps.
   ================================================================== */

export const linearWebhookDeliveriesTable = pgTable(
  "linear_webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deliveryId: varchar("delivery_id", { length: 255 }).notNull().unique(), // Linear-Delivery or unique webhook ID
    eventType: varchar("event_type", { length: 100 }).notNull(), // Issue, Project, Comment, etc.
    action: varchar("action", { length: 100 }), // create, update, remove
    linearWorkspaceId: varchar("linear_workspace_id", { length: 255 }),
    linearIssueId: varchar("linear_issue_id", { length: 255 }),
    providerUpdatedAt: timestamp("provider_updated_at", { withTimezone: true }), // For revision awareness
    summaryJson: jsonb("summary_json").default({}).notNull(), // Trimmed diagnostic metadata
    status: varchar("status", { length: 50 }).default("PENDING").notNull(), // PENDING, PROCESSED, FAILED, IGNORED, STALE_REJECTED
    errorMessage: text("error_message"),
    expiresAt: timestamp("expires_at", { withTimezone: true }), // 30-day retention cutoff
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("linear_delivery_uidx").on(table.deliveryId),
    index("linear_delivery_event_idx").on(table.eventType),
    index("linear_delivery_status_idx").on(table.status),
    index("linear_delivery_workspace_idx").on(table.linearWorkspaceId),
    index("linear_delivery_expires_idx").on(table.expiresAt),
  ]
);

/* ==================================================================
   3. Linear OAuth States
   Cryptographically random CSRF state bound strictly to a ScopeCI
   organization and authenticated user/session with 10-minute expiration.
   ================================================================== */

export const linearOAuthStatesTable = pgTable(
  "linear_oauth_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    state: varchar("state", { length: 255 }).notNull().unique(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    userId: varchar("user_id", { length: 255 }), // Bound to authenticated user/session
    redirectUrl: text("redirect_url"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }), // Single-use replay protection
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("linear_oauth_state_uidx").on(table.state),
    index("linear_oauth_state_org_idx").on(table.organizationId),
    index("linear_oauth_state_expires_idx").on(table.expiresAt),
  ]
);

export const linearOAuthStatesRelations = relations(linearOAuthStatesTable, ({ one }) => ({
  organization: one(organizationsTable, {
    fields: [linearOAuthStatesTable.organizationId],
    references: [organizationsTable.id],
  }),
}));
