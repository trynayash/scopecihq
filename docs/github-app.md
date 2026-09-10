# ScopeCI Alpha — GitHub App Integration Guide

## 1. Overview

ScopeCI operates as a GitHub App that monitors pull request activity, correlates code changes with contracted statement of work (SOW) baselines and Linear issues, and publishes commercial review evidence directly on GitHub pull requests.

In **Phase 2 (Alpha)**, ScopeCI runs strictly in **Observe Mode**:
- GitHub Check Runs are published under `scopeci / commercial` with conclusion `neutral`.
- Pull request merges are **never blocked**.
- Non-duplicating, updateable PR review comments provide commercial evidence without asserting unauthorized legal conclusions.

---

## 2. GitHub App Setup & Configuration

### A. App Identification & Domain Architecture
- **Application URL**: Set to `https://app.scopeci.<domain>` (or `http://localhost:3000` in dev).
  - *Architectural Invariant*: ScopeCI separates public marketing/waitlist (`scopeci.<domain>`) from the authenticated product (`app.scopeci.<domain>`).
- **Webhook URL**: `https://api.scopeci.<domain>/api/webhooks/github` (or Smee.io / Ngrok URL for local development).
- **Webhook Secret**: Generate a cryptographically random secret (e.g. `openssl rand -hex 32`).

### B. Required Permissions (Least Privilege Principle)

| Permission | Access | Justification |
|---|---|---|
| **Pull requests** | `Read & Write` | `Read`: Ingest PR lifecycle events (`opened`, `synchronize`, `reopened`, `closed`), extract issue references.<br>`Write`: Post and update commercial review evidence comments via idempotent marker `<!-- scopeci-commercial-review -->`. |
| **Repository contents** | `Read-only` | Collect changed file paths, status, additions/deletions, and diff patches for commercial scope delta analysis. |
| **Checks** | `Read & Write` | Create and update GitHub Check Runs (`scopeci / commercial`) to display commercial review status to engineers and reviewers. |
| **Metadata** | `Read-only` | Required by GitHub for all GitHub Apps to resolve repository and organization metadata. |

*No administrative, repository deletion, secret, or workflow permissions are requested.*

### C. Subscribed Webhook Events
- `Pull request`
  - `opened`
  - `synchronize`
  - `reopened`
  - `closed`
- `Ping`

---

## 3. Environment Variables

Store in `.env` (never commit secrets to version control):

```bash
# ScopeCI App Base URL
APP_BASE_URL=https://app.scopeci.com

# GitHub App Integration
GITHUB_APP_ID=123456
GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxx
GITHUB_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GITHUB_WEBHOOK_SECRET=your_long_random_webhook_secret_here
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
```

---

## 4. Local Webhook Testing

To receive GitHub webhooks locally during development:

1. Use [smee.io](https://smee.io) or [ngrok](https://ngrok.com):
   ```bash
   smee --url https://smee.io/your-unique-channel --target http://localhost:8080/api/webhooks/github
   ```
2. Set your GitHub App webhook URL to your Smee channel URL.
3. Configure `GITHUB_WEBHOOK_SECRET` in `.env` matching your GitHub App settings.
4. Execute automated mocked integration tests without credentials:
   ```bash
   pnpm run test:github
   ```

---

## 5. Architectural Invariants & Data Flow

### A. Fast Acknowledgment & Asynchronous Processing
1. GitHub delivers payload $\to$ `POST /api/webhooks/github`.
2. ScopeCI computes HMAC SHA-256 over raw request bytes (`X-Hub-Signature-256`).
3. Delivery idempotency check: `webhook_deliveries` is checked by `X-GitHub-Delivery`.
   - If already `PROCESSED`, returns HTTP `200 OK` with `{ status: "already_processed" }`.
4. Webhook delivery recorded as `PENDING` with trimmed metadata and a 30-day retention expiration.
5. Asynchronous evaluation pipeline is enqueued.
6. HTTP `202 Accepted` is returned immediately.

### B. HeadSha Invariant
ScopeCI enforces strict commit SHA revision pinning:

$$\text{PR revision SHA} \longrightarrow \text{Diff analysis SHA} \longrightarrow \text{Commercial evaluation SHA} \longrightarrow \text{GitHub Check Run headSha}$$

If a pull request moves from $\text{SHA } A \to \text{SHA } B$ via `synchronize`:
- A new diff analysis is recorded for $\text{SHA } B$.
- A new commercial evaluation is computed for $\text{SHA } B$.
- The GitHub Check Run is updated with `headSha = SHA B`.
- An evaluation for an older revision $\text{SHA } A$ can **never** authorize $\text{SHA } B$.

### C. Observe Mode (Graduated Trust)
In Phase 2 Alpha, ScopeCI never blocks merges:
- Check Run name: `scopeci / commercial`.
- Conclusion: `neutral`.
- Mode displayed: `OBSERVE`.
- Output summary clearly flags `Review required` or `In scope` according to baseline deliverables, without asserting legal breach or contract nullity.

### D. Idempotent PR Review Comments
- ScopeCI PR comments contain the unique HTML comment marker:
  ```html
  <!-- scopeci-commercial-review -->
  ```
- Subsequent `synchronize` or re-delivery events inspect existing PR comments for this marker and edit the comment in-place, eliminating comment spam.
- User-controlled strings (titles, bodies, branches) are HTML/Markdown escaped to prevent injection.

---

## 6. Multi-Tenant Organization Boundary

ScopeCI is multi-tenant by design:
- `github_installations` maps `installation_id` to a single ScopeCI `organization_id`.
- Repositories are resolved against `project_links` belonging strictly to that organization.
- Unmapped repositories return a controlled `unmapped` state and do not create arbitrary database projects or leak cross-tenant data.
- All database queries are strictly scoped by `organization_id`.
