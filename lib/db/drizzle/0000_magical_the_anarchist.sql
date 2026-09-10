CREATE TABLE "site_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event" varchar(80) NOT NULL,
	"source" varchar(100),
	"medium" varchar(100),
	"campaign" varchar(200),
	"referrer" varchar(2000),
	"landing_page" varchar(2000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waitlist_signups" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(320) NOT NULL,
	"agency" varchar(160),
	"utm_source" varchar(100),
	"utm_medium" varchar(100),
	"utm_campaign" varchar(200),
	"utm_content" varchar(200),
	"utm_term" varchar(200),
	"referrer" varchar(2000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_signups_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "change_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"source_baseline_id" uuid NOT NULL,
	"resulting_baseline_id" uuid,
	"reference" varchar(50) NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text NOT NULL,
	"estimated_hours_min" integer NOT NULL,
	"estimated_hours_max" integer NOT NULL,
	"estimated_value_min" integer NOT NULL,
	"estimated_value_max" integer NOT NULL,
	"currency" varchar(10) DEFAULT 'USD' NOT NULL,
	"status" varchar(50) DEFAULT 'PENDING' NOT NULL,
	"approved_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commercial_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commercial_evaluation_id" uuid NOT NULL,
	"approval_type" varchar(50) NOT NULL,
	"approver_type" varchar(50) NOT NULL,
	"approver_external_id" text,
	"approver_name" text,
	"change_order_ref" varchar(50),
	"notes" text,
	"previous_state" varchar(50) NOT NULL,
	"new_state" varchar(50) NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commercial_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pull_request_id" uuid NOT NULL,
	"scope_baseline_id" uuid NOT NULL,
	"pr_diff_analysis_id" uuid,
	"state" varchar(50) NOT NULL,
	"policy_mode" varchar(50) DEFAULT 'REVIEW' NOT NULL,
	"confidence" numeric(5, 4),
	"contract_clause_ids_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deliverable_ids_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"issue_ids_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estimated_hours_min" integer,
	"estimated_hours_max" integer,
	"estimated_value_min" integer,
	"estimated_value_max" integer,
	"currency" varchar(10) DEFAULT 'USD',
	"reason" text NOT NULL,
	"evaluator_version" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commercial_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" text NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"actor_type" varchar(50) NOT NULL,
	"actor_id" text,
	"previous_state" varchar(50),
	"new_state" varchar(50),
	"reason" text,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_clauses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_baseline_id" uuid NOT NULL,
	"clause_number" varchar(50) NOT NULL,
	"title" varchar(255) NOT NULL,
	"legal_text" text NOT NULL,
	"boundary_type" varchar(50) NOT NULL,
	"source_page" integer,
	"source_location" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"source_filename" text NOT NULL,
	"source_type" varchar(50) DEFAULT 'PDF' NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"currency" varchar(10) DEFAULT 'USD' NOT NULL,
	"status" varchar(50) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliverables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_baseline_id" uuid NOT NULL,
	"clause_id" uuid,
	"name" varchar(255) NOT NULL,
	"description" text NOT NULL,
	"acceptance_criteria" text NOT NULL,
	"boundary_summary" text NOT NULL,
	"allocated_hours" integer,
	"allocated_budget" integer,
	"currency" varchar(10) DEFAULT 'USD',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_deliverable_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"deliverable_id" uuid NOT NULL,
	"association_type" varchar(50) DEFAULT 'DIRECT' NOT NULL,
	"confidence" numeric(5, 4) NOT NULL,
	"evidence_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"external_provider" varchar(50) NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"identifier" varchar(100) NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"status" varchar(50) NOT NULL,
	"estimate" integer,
	"url" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "pr_diff_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pull_request_id" uuid NOT NULL,
	"analysis_version" integer DEFAULT 1 NOT NULL,
	"status" varchar(50) DEFAULT 'COMPLETED' NOT NULL,
	"files_changed_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subsystems_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scope_delta_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text NOT NULL,
	"model_provider" varchar(50),
	"model_version" varchar(50),
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pr_issue_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pull_request_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"link_method" varchar(50) NOT NULL,
	"confidence" numeric(5, 4) NOT NULL,
	"evidence" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" varchar(50) NOT NULL,
	"external_project_id" varchar(255) NOT NULL,
	"external_project_name" varchar(255) NOT NULL,
	"external_team_id" varchar(255),
	"repository_provider" varchar(50) DEFAULT 'GITHUB' NOT NULL,
	"repository_external_id" varchar(255) NOT NULL,
	"repository_full_name" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pull_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_link_id" uuid,
	"external_provider" varchar(50) DEFAULT 'GITHUB' NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"head_branch" varchar(255) NOT NULL,
	"base_branch" varchar(255) NOT NULL,
	"author_external_id" varchar(255) NOT NULL,
	"url" text NOT NULL,
	"state" varchar(50) DEFAULT 'OPEN' NOT NULL,
	"is_draft" boolean DEFAULT false NOT NULL,
	"additions" integer DEFAULT 0 NOT NULL,
	"deletions" integer DEFAULT 0 NOT NULL,
	"changed_files" integer DEFAULT 0 NOT NULL,
	"commits_count" integer DEFAULT 0 NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"merged_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scope_baselines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"version_number" varchar(50) NOT NULL,
	"status" varchar(50) DEFAULT 'ACTIVE' NOT NULL,
	"created_by" varchar(255) NOT NULL,
	"source_change_order_id" uuid,
	"supersedes_baseline_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_source_baseline_id_scope_baselines_id_fk" FOREIGN KEY ("source_baseline_id") REFERENCES "public"."scope_baselines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_resulting_baseline_id_scope_baselines_id_fk" FOREIGN KEY ("resulting_baseline_id") REFERENCES "public"."scope_baselines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_approvals" ADD CONSTRAINT "commercial_approvals_commercial_evaluation_id_commercial_evaluations_id_fk" FOREIGN KEY ("commercial_evaluation_id") REFERENCES "public"."commercial_evaluations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_evaluations" ADD CONSTRAINT "commercial_evaluations_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_evaluations" ADD CONSTRAINT "commercial_evaluations_scope_baseline_id_scope_baselines_id_fk" FOREIGN KEY ("scope_baseline_id") REFERENCES "public"."scope_baselines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_evaluations" ADD CONSTRAINT "commercial_evaluations_pr_diff_analysis_id_pr_diff_analyses_id_fk" FOREIGN KEY ("pr_diff_analysis_id") REFERENCES "public"."pr_diff_analyses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_events" ADD CONSTRAINT "commercial_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_clauses" ADD CONSTRAINT "contract_clauses_scope_baseline_id_scope_baselines_id_fk" FOREIGN KEY ("scope_baseline_id") REFERENCES "public"."scope_baselines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_scope_baseline_id_scope_baselines_id_fk" FOREIGN KEY ("scope_baseline_id") REFERENCES "public"."scope_baselines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_clause_id_contract_clauses_id_fk" FOREIGN KEY ("clause_id") REFERENCES "public"."contract_clauses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_deliverable_links" ADD CONSTRAINT "issue_deliverable_links_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_deliverable_links" ADD CONSTRAINT "issue_deliverable_links_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_diff_analyses" ADD CONSTRAINT "pr_diff_analyses_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_issue_links" ADD CONSTRAINT "pr_issue_links_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_issue_links" ADD CONSTRAINT "pr_issue_links_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_links" ADD CONSTRAINT "project_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_project_link_id_project_links_id_fk" FOREIGN KEY ("project_link_id") REFERENCES "public"."project_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_baselines" ADD CONSTRAINT "scope_baselines_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "co_org_idx" ON "change_orders" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "co_contract_idx" ON "change_orders" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "co_reference_idx" ON "change_orders" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "co_status_idx" ON "change_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "approval_eval_idx" ON "commercial_approvals" USING btree ("commercial_evaluation_id");--> statement-breakpoint
CREATE INDEX "approval_type_idx" ON "commercial_approvals" USING btree ("approval_type");--> statement-breakpoint
CREATE INDEX "eval_pr_idx" ON "commercial_evaluations" USING btree ("pull_request_id");--> statement-breakpoint
CREATE INDEX "eval_baseline_idx" ON "commercial_evaluations" USING btree ("scope_baseline_id");--> statement-breakpoint
CREATE INDEX "eval_state_idx" ON "commercial_evaluations" USING btree ("state");--> statement-breakpoint
CREATE INDEX "eval_created_at_idx" ON "commercial_evaluations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "cevt_org_idx" ON "commercial_events" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "cevt_entity_idx" ON "commercial_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "cevt_type_idx" ON "commercial_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "cevt_occurred_at_idx" ON "commercial_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "clause_baseline_idx" ON "contract_clauses" USING btree ("scope_baseline_id");--> statement-breakpoint
CREATE INDEX "clause_number_idx" ON "contract_clauses" USING btree ("clause_number");--> statement-breakpoint
CREATE INDEX "clause_boundary_idx" ON "contract_clauses" USING btree ("boundary_type");--> statement-breakpoint
CREATE INDEX "contract_org_idx" ON "contracts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "contract_status_idx" ON "contracts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "contract_created_at_idx" ON "contracts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "deliv_baseline_idx" ON "deliverables" USING btree ("scope_baseline_id");--> statement-breakpoint
CREATE INDEX "deliv_clause_idx" ON "deliverables" USING btree ("clause_id");--> statement-breakpoint
CREATE INDEX "idl_issue_idx" ON "issue_deliverable_links" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "idl_deliverable_idx" ON "issue_deliverable_links" USING btree ("deliverable_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_provider_external_uidx" ON "issues" USING btree ("external_provider","external_id");--> statement-breakpoint
CREATE INDEX "issue_org_idx" ON "issues" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "issue_identifier_idx" ON "issues" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "org_slug_idx" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "org_created_at_idx" ON "organizations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "diff_analysis_pr_idx" ON "pr_diff_analyses" USING btree ("pull_request_id");--> statement-breakpoint
CREATE INDEX "diff_analysis_status_idx" ON "pr_diff_analyses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pil_pr_idx" ON "pr_issue_links" USING btree ("pull_request_id");--> statement-breakpoint
CREATE INDEX "pil_issue_idx" ON "pr_issue_links" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "projlink_org_idx" ON "project_links" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "projlink_repo_idx" ON "project_links" USING btree ("repository_full_name");--> statement-breakpoint
CREATE UNIQUE INDEX "pr_provider_external_uidx" ON "pull_requests" USING btree ("external_provider","external_id");--> statement-breakpoint
CREATE INDEX "pr_org_idx" ON "pull_requests" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "pr_number_idx" ON "pull_requests" USING btree ("number");--> statement-breakpoint
CREATE INDEX "pr_state_idx" ON "pull_requests" USING btree ("state");--> statement-breakpoint
CREATE INDEX "pr_head_branch_idx" ON "pull_requests" USING btree ("head_branch");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_version_uidx" ON "scope_baselines" USING btree ("contract_id","version_number");--> statement-breakpoint
CREATE INDEX "baseline_contract_idx" ON "scope_baselines" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "baseline_status_idx" ON "scope_baselines" USING btree ("status");