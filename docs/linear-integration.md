# ScopeCI Linear Integration Guide (Phase 3)

This document describes the production-ready Linear integration boundary for ScopeCI Alpha, connecting Linear issues into the Commercial Provenance Graph and enforcing four hard safeguards.

---

## Architecture & Surface Separation

In accordance with ScopeCI domain rules:
- Marketing / Waitlist site: `https://scopeci.<domain>`
- Authenticated ScopeCI Product: `https://app.scopeci.<domain>`
- API / Webhook Services: `https://api.scopeci.<domain>` or `/api/*`

OAuth authorization requests and webhooks are handled by the API server. After exchanging tokens and persisting the connection, all OAuth callbacks redirect to the authenticated product application at:
```text
https://app.scopeci.<domain>/settings/integrations/linear?status=connected&workspace=<workspaceName>
```
No tokens, codes, or secrets are ever exposed in query strings or frontend logs.

---

## Minimal Background Operational Flow

ScopeCI does **not** duplicate Linear project management functionality. The minimal operational workflow is:
```text
Connect Linear
      ↓
Select workspace
      ↓
Select team/project
      ↓
Map GitHub repository
      ↓
Sync issues
```
Once mapped, ScopeCI runs silently in the background powering the Commercial Provenance Graph.

---

## The Four Non-Negotiable Safeguards

### 1. Authenticated Token Encryption with Key Rotation
Linear OAuth access and refresh tokens are encrypted at rest using **AES-256-GCM** authenticated encryption:
- `encrypted_access_token`: Ciphertext (hex)
- `token_iv`: 12-byte initialization vector / nonce (24 hex characters)
- `token_auth_tag`: 16-byte GCM authentication tag (32 hex characters)
- `key_version`: Version identifier (e.g. `'v1'`, `'v2'`)

Key rotation is supported with zero downtime via `LINEAR_TOKEN_ENCRYPTION_KEY_<VERSION>` environment variables. Any tampering with ciphertext or auth tags immediately causes cryptographic decryption failure.

### 2. Strict Organization & User/Session Bound OAuth State
OAuth state parameters are cryptographically random 32-byte hex strings stored in `linear_oauth_statesTable` bound to:
- `organization_id`
- `user_id` / authenticated session
- `expires_at` (10-minute maximum lifespan)
- `used_at` (single-use replay attack protection)

A valid state belonging to Organization A can never be used to connect a workspace into Organization B.

### 3. Revision-Aware Webhook Delivery & Sync
A delayed or out-of-order `IssueUpdated` event must never overwrite a newer local representation.
- Linear webhook deliveries carry `providerUpdatedAt`.
- The synchronization service compares incoming `providerUpdatedAt` against the existing issue's `updatedAt` in `issuesTable`.
- If the incoming update is older than or equal to the local representation, the update is rejected as `STALE_REJECTED` in `linear_webhook_deliveriesTable`, and local state remains untouched.

### 4. Advisory Issue → Deliverable Linking (No Silent Commercial Authorization)
Deterministic keyword matching and manual issue $\to$ deliverable links are strictly advisory graph metadata:
- Creates `issue_deliverable_linksTable` rows with `associationType: 'INFERRED'` and `confidence: '0.8500'`.
- Carries metadata: `{ advisoryOnly: true, commercialAuthorization: false }`.
- Deterministic keyword matching **never silently creates a commercial authorization**.
- Only the authoritative `@workspace/commercial-engine` evaluation layer can determine commercial state during PR diff analysis against the active contract baseline.

---

## Head-SHA Provenance Invariant

The Commercial Provenance Graph is strictly revision- and commit-pinned:
$$\text{GitHub PR revision SHA} \longrightarrow \text{Diff analysis SHA} \longrightarrow \text{Linear Issue} \longrightarrow \text{Deliverable} \longrightarrow \text{Clause} \longrightarrow \text{Commercial Evaluation} \longrightarrow \text{Check Run headSha}$$

**No Linear synchronization event can retroactively authorize an earlier GitHub revision.**
Subsequent updates to a Linear issue or deliverable link do not alter existing evaluation records for past commits. Every new PR commit SHA requires its own diff analysis and commercial evaluation.

---

## API Endpoints Reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/integrations/linear/connect` | Initiates OAuth, generates CSRF state bound to org/user |
| `GET` | `/api/integrations/linear/callback` | Validates state, exchanges code, encrypts tokens, redirects to `app.scopeci.<domain>` |
| `POST` | `/api/webhooks/linear` | Verifies HMAC signature, ensures idempotency, and updates issues with revision checks |
| `POST` | `/api/integrations/linear/projects/map` | Links Linear project to GitHub repository in `project_links` |
| `POST` | `/api/integrations/linear/projects/:projectId/sync` | Imports and synchronizes all active project issues |
| `POST` | `/api/integrations/linear/issues/:issueId/link-deliverable` | Manually links Linear issue to Deliverable with audit event |

---

## Environment Variables

Add to your `.env`:
```env
# Linear OAuth & Webhook Configuration
LINEAR_CLIENT_ID=your_linear_client_id
LINEAR_CLIENT_SECRET=your_linear_client_secret
LINEAR_WEBHOOK_SECRET=your_linear_webhook_secret
LINEAR_REDIRECT_URI=https://api.scopeci.dev/api/integrations/linear/callback

# Token Authenticated Encryption (AES-256-GCM)
LINEAR_TOKEN_ENCRYPTION_KEY=your_32_byte_secret_passphrase_or_hex
# Key rotation support:
LINEAR_TOKEN_ENCRYPTION_KEY_V1=your_v1_key
LINEAR_TOKEN_ENCRYPTION_KEY_V2=your_v2_key
```

---

## Running Verification

Execute the deterministic Phase 3 test suite:
```bash
pnpm run test:linear
```
Runs 23 comprehensive scenarios covering OAuth, encryption, errors, normalizers, sync, webhooks, linking, head-SHA invariant, and organization isolation.
