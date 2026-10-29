# ScopeCI

ScopeCI is a tool I'm building for software agencies that do fixed-price client work. It checks each pull request against what the client signed, so work outside the agreed scope is caught before it ships.

**Status: pilot.** The site is live at [scopeci.onrender.com](https://scopeci.onrender.com), with a public demo at `/try` that runs the real check on a pasted statement of work. The signed-in app at `/app` (sign in with GitHub, projects, confirmed scope, connected repository, checked pull requests with change order drafts) works end to end against GitHub once a GitHub App is set up, which takes one click on the admin page; see [docs/github-app.md](docs/github-app.md). The Linear integration is built and tested with stand-ins only; in production its connect, callback and sync routes answer 503 until a real Linear token exchange is built.

## How it works

1. A statement of work is parsed into a checklist of what each clause includes and excludes. A person corrects it and saves it as the project's scope; each save is a new version.
2. When a pull request on the project's repository changes, ScopeCI collects its title, branch, description, changed files and, when there is one, the linked Linear issue.
3. A rule-based evaluator (no AI model) compares the change with the baseline and returns one of: in scope, change required, review required, approved change, or overridden. It matches the SOW's own wording against the changed file paths, the pull request title and branch, and the linked issue. Work that matches an exclusion in the code or a title needs a change order; work the SOW doesn't mention, or that only a description mentions, goes to a person for review. Hours come only from the linked issue's estimate and are reported as not estimated when it has none.
4. The result is reported as a GitHub check run and a pull request comment. The policy mode decides what happens next: observe (report only, never blocks a merge), review or enforce.

## What's in the repo

A pnpm workspace in TypeScript.

| Path | What it is |
| :-- | :-- |
| `artifacts/scopeci` | The site, the `/try` demo and the signed-in app at `/app` (React and Vite) |
| `artifacts/api-server` | The API (Express): sign-in, projects, the demo, GitHub App webhooks and client, waitlist, Linear OAuth |
| `lib/commercial-engine` | The scope evaluator, the statement of work parser and the scenario simulator |
| `lib/db` | PostgreSQL schema and queries (Drizzle) |
| `lib/api-spec`, `lib/api-zod`, `lib/api-client-react` | The OpenAPI spec, the Zod schemas generated from it, and a typed React Query client |
| `docs/` | Setup notes for the [GitHub App](docs/github-app.md) and the [Linear integration](docs/linear-integration.md) |

A few details worth knowing:

- GitHub webhooks are verified by signature, and every delivery is logged so a repeated delivery is handled once.
- Linear OAuth tokens are encrypted with AES-256-GCM before they are stored.
- Waitlist signups go to a `waitlist_signups` table, with a unique email, rate limiting and a honeypot field.
- The admin page at `/admin/waitlist` signs in with `ADMIN_SECRET` and keeps an httpOnly, SameSite=Strict session cookie for 12 hours, so the secret never sits in browser storage or a URL. From there you can filter signups, export them as CSV, and remove one when someone asks to be deleted. Scripts can still send the secret as `Authorization: Bearer <key>`.

## Running it locally

You need Node.js and pnpm 10.

```sh
pnpm install
pnpm run typecheck
pnpm run simulate   # replays six scenarios through the evaluator; no database needed
```

The API needs a PostgreSQL database. Copy `.env.example` to `.env` and fill in `DATABASE_URL`, then:

```sh
pnpm run db:ensure                                       # create the tables (the server also does this on start)
pnpm run build
PORT=3000 pnpm --filter @workspace/api-server run start  # serves the API and the built site
```

Then open <http://localhost:3000>.

## Tests

```sh
pnpm run simulate      # golden scenarios through the evaluator; no database
pnpm test:demo         # the public demo API
pnpm test:product      # sign-in, projects, scope, repository linking and a PR through a fake GitHub
pnpm run db:test && pnpm test:github && pnpm test:linear && pnpm test:phase4 && pnpm test:security && pnpm test:launch
```

Everything but `simulate` needs `DATABASE_URL`. `scripts/test-db.sh` runs every database suite, each on a freshly created database.

## CI

Every push runs `pnpm audit`, the type check, the simulator and the build, and every database suite against a Postgres service, in GitHub Actions.
