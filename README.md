# ScopeCI

ScopeCI is a tool I'm building for software agencies that do fixed-price client work. It checks each pull request against what the client signed, so work outside the agreed scope is caught before it ships.

**Status: in development.** The waitlist site is live at [scopeci.onrender.com](https://scopeci.onrender.com). The evaluator, the GitHub App and the Linear integration are built and tested, but the GitHub side still runs against an in-memory client and both integrations are switched off in production. Nothing runs on real repositories yet.

## How it works

1. A statement of work written in Markdown is parsed into a scope baseline: clauses, deliverables, inclusions and exclusions.
2. When a pull request changes, ScopeCI collects the changed files and the linked Linear issue.
3. A rule-based evaluator (no AI model) compares the change with the baseline and returns one of: in scope, change required, review required, approved change, or overridden.
4. The result is reported as a GitHub check run and a pull request comment. The policy mode decides what happens next: observe (report only, never blocks a merge), review or enforce.

## What's in the repo

A pnpm workspace in TypeScript.

| Path | What it is |
| :-- | :-- |
| `artifacts/scopeci` | The waitlist site (React and Vite) |
| `artifacts/api-server` | The API (Express): waitlist signups, GitHub App webhooks, Linear OAuth |
| `lib/commercial-engine` | The scope evaluator, the statement of work parser and the scenario simulator |
| `lib/db` | PostgreSQL schema and queries (Drizzle) |
| `lib/api-spec`, `lib/api-zod`, `lib/api-client-react` | The OpenAPI spec, the Zod schemas generated from it, and a typed React Query client |
| `docs/` | Setup notes for the [GitHub App](docs/github-app.md) and the [Linear integration](docs/linear-integration.md) |

A few details worth knowing:

- GitHub webhooks are verified by signature, and every delivery is logged so a repeated delivery is handled once.
- Linear OAuth tokens are encrypted with AES-256-GCM before they are stored.
- Waitlist signups go to a `waitlist_signups` table, with a unique email, rate limiting and a honeypot field. Admins can export them as CSV.

## Running it locally

You need Node.js and pnpm 10.

```sh
pnpm install
pnpm run typecheck
pnpm run simulate   # replays six scenarios through the evaluator; no database needed
```

The API needs a PostgreSQL database. Copy `.env.example` to `.env` and fill in `DATABASE_URL`, then:

```sh
pnpm --filter @workspace/db run push                     # create the tables
pnpm run build
PORT=3000 pnpm --filter @workspace/api-server run start  # serves the API and the built site
```

Then open <http://localhost:3000>.

## CI

Every push runs `pnpm audit`, the type check, the simulator and the build in GitHub Actions.
