CREATE TABLE "github_check_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pull_request_id" uuid NOT NULL,
	"github_check_run_id" varchar(255) NOT NULL,
	"check_name" varchar(255) DEFAULT 'scopeci / commercial' NOT NULL,
	"head_sha" varchar(64) NOT NULL,
	"status" varchar(50) DEFAULT 'completed' NOT NULL,
	"conclusion" varchar(50) DEFAULT 'neutral' NOT NULL,
	"title" varchar(255) NOT NULL,
	"summary" text NOT NULL,
	"details_url" text,
	"external_id" text,
	"latest_evaluation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_check_runs_github_check_run_id_unique" UNIQUE("github_check_run_id")
);
--> statement-breakpoint
CREATE TABLE "github_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"installation_id" varchar(255) NOT NULL,
	"organization_id" uuid NOT NULL,
	"github_account_id" varchar(255) NOT NULL,
	"github_account_login" varchar(255) NOT NULL,
	"github_account_type" varchar(50) NOT NULL,
	"permissions_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"repository_selection" varchar(50) DEFAULT 'selected' NOT NULL,
	"installed_by" varchar(255),
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_installations_installation_id_unique" UNIQUE("installation_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" varchar(255) NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"action" varchar(100),
	"installation_id" varchar(255),
	"repository_full_name" varchar(255),
	"head_sha" varchar(64),
	"pr_number" integer,
	"sender_login" varchar(255),
	"summary_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(50) DEFAULT 'PENDING' NOT NULL,
	"error_message" text,
	"expires_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_deliveries_delivery_id_unique" UNIQUE("delivery_id")
);
--> statement-breakpoint
ALTER TABLE "commercial_evaluations" ADD COLUMN "head_sha" varchar(64);--> statement-breakpoint
ALTER TABLE "pr_diff_analyses" ADD COLUMN "head_sha" varchar(64);--> statement-breakpoint
ALTER TABLE "github_check_runs" ADD CONSTRAINT "github_check_runs_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_check_runs" ADD CONSTRAINT "github_check_runs_latest_evaluation_id_commercial_evaluations_id_fk" FOREIGN KEY ("latest_evaluation_id") REFERENCES "public"."commercial_evaluations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gh_check_run_external_uidx" ON "github_check_runs" USING btree ("github_check_run_id");--> statement-breakpoint
CREATE INDEX "gh_check_run_pr_idx" ON "github_check_runs" USING btree ("pull_request_id");--> statement-breakpoint
CREATE INDEX "gh_check_run_sha_idx" ON "github_check_runs" USING btree ("head_sha");--> statement-breakpoint
CREATE INDEX "gh_check_run_conclusion_idx" ON "github_check_runs" USING btree ("conclusion");--> statement-breakpoint
CREATE UNIQUE INDEX "gh_install_external_uidx" ON "github_installations" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "gh_install_org_idx" ON "github_installations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "gh_install_account_idx" ON "github_installations" USING btree ("github_account_login");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_delivery_uidx" ON "webhook_deliveries" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "webhook_delivery_event_idx" ON "webhook_deliveries" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "webhook_delivery_status_idx" ON "webhook_deliveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "webhook_delivery_repo_idx" ON "webhook_deliveries" USING btree ("repository_full_name");--> statement-breakpoint
CREATE INDEX "webhook_delivery_expires_idx" ON "webhook_deliveries" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "eval_head_sha_idx" ON "commercial_evaluations" USING btree ("head_sha");--> statement-breakpoint
CREATE INDEX "diff_analysis_head_sha_idx" ON "pr_diff_analyses" USING btree ("head_sha");