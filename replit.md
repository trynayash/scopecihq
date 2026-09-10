# ScopeCI

ScopeCI is a premium landing and waitlist site for commercial CI/CD built for software agencies.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string (see `.env.example`)

## Database (Supabase)

Supabase is plain Postgres, so it is used through the existing `pg` + Drizzle
setup rather than `@supabase/supabase-js`. One-time setup:

1. Supabase → Project → **Connect** → **ORMs** (or Session pooler). Copy the URI
   and replace `[YOUR-PASSWORD]`. Put it in `.env` as `DATABASE_URL`.
   Use the **session pooler (5432)** or the direct connection — the transaction
   pooler (6543) drops prepared statements between queries, which breaks the
   node-postgres driver.
2. `pnpm --filter @workspace/db run push` — creates `waitlist_signups`.
3. Run `lib/db/sql/001_waitlist_rls.sql` in the Supabase SQL editor. This is not
   optional: `drizzle-kit push` creates tables with row level security **off**,
   and Supabase serves every `public` table through PostgREST using the anon key
   that ships in client code. Without it the whole waitlist is world-readable.

Reading the signups: Supabase → Table Editor → `waitlist_signups`, or SQL editor:

```sql
select email, agency, created_at
from public.waitlist_signups
order by created_at desc;
```

## Deployment (Render)

One Render Web Service builds the frontend and serves it from the same Express
process as the API — `app.ts` serves `artifacts/scopeci/dist/public` as static
files with an SPA fallback, and mounts the API under `/api`. Same origin, so
the site's relative `fetch("/api/...")` calls need no CORS or proxy setup.

`render.yaml` at the repo root defines the service (Render Blueprint). To
deploy:

1. Render → **New** → **Blueprint** → connect the `scopecihq` GitHub repo.
   Render reads `render.yaml` and pre-fills the service.
2. Before the first deploy, add the one secret it doesn't commit: this
   service's **Environment** tab → `DATABASE_URL` → the Supabase connection
   string (see `.env.example`).
3. Deploy. Render assigns `PORT` itself; `index.ts` already reads it.

`healthCheckPath: /api/healthz` is set, so Render only swaps traffic to a new
deploy once the server actually responds.

The free plan spins the service down after inactivity — the next request pays
a cold-start (tens of seconds), same as Supabase's own free-tier pausing.
Fine for a waitlist; worth a paid plan before real launch traffic.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/scopeci/src/App.tsx` — the landing experience, the `/privacy` page, and the interactive product surfaces
- `artifacts/scopeci/src/index.css` — ScopeCI visual tokens, responsive layout, and motion rules
- `artifacts/api-server/src/routes/waitlist.ts` — waitlist endpoint (`POST /api/waitlist`)
- `artifacts/api-server/src/app.ts` — mounts `/api`, then serves the built frontend with an SPA fallback
- `render.yaml` — Render Blueprint: build/start commands, health check
- `lib/db/src/index.ts` — pool and TLS resolution
- `lib/db/src/schema/index.ts` — `waitlist_signups` table
- `lib/db/sql/001_waitlist_rls.sql` — Supabase row level security, run once
- `artifacts/scopeci/brand/` — the supplied logo files at original resolution (source of truth, not served)
- `artifacts/scopeci/public/assets/` — the same marks resized for the web; regenerate from `brand/`, never redraw
- `artifacts/scopeci/public/favicons/` — supplied favicon set, wired up in `index.html`

## Architecture decisions

- The waitlist is real end to end: `useCreateWaitlistSignup` (generated from the OpenAPI spec) posts to `POST /api/waitlist`, which persists to Postgres. The UI distinguishes idle / submitting / success / duplicate (409) / validation (400) / server error (500); email is validated on both sides and the unique index on `waitlist_signups.email` is what produces the duplicate state.
- Product visuals are built from HTML/CSS so they stay crisp, fast, and believable at all viewport sizes.
- Motion explains system activity only. Every animated sequence resolves to its final state immediately under `prefers-reduced-motion`, so no information depends on animation. The hero review sequence completes in ~1.4s and then holds — it never loops.
- The page runs message → proof: the hero's left column carries the claim, the right column carries the product surface that proves it, and one full-width hairline (`.hero-foot`) binds the two. Keep that rule if the hero is edited.
- Section grounds alternate ivory / paper with two dark anchors (hero, commercial state) and a dark close. Sections adjacent to a dark neighbour drop their top hairline, so the colour change is the transition.
- GitHub, Linear and Jira are shown with their official marks (Simple Icons via `react-icons/si`) drawn in `currentColor`. They state compatibility only — no partnership is implied.
- `/privacy` describes only what the site actually does today (one waitlist form, no accounts, no analytics). It deliberately asserts no company entity, address, jurisdiction or DPO, because none is established yet. Revisit it when the product launches.
- No mailbox is configured for this project, so there is no contact email to publish. The footer's "Contact" link points at the waitlist form — the one channel that actually reaches us. Do not substitute an invented address; wire in a real one when it exists.

## Product

The site explains how ScopeCI connects signed scope, project issues, and GitHub pull requests to commercial authorization, then captures early-access interest through a waitlist form.

## User preferences

- Keep the brand technical, restrained, and credible; do not introduce generic AI-startup visual language or fabricated proof.

## Gotchas

- Use the supplied logo files directly and preserve their proportions. Never redraw the mark in CSS/SVG; resize from `artifacts/scopeci/brand/` instead.
- The supplied wordmark is dark-on-transparent, so it only goes on light surfaces — this is why the masthead and footer are light.
- Verify the page through the managed `artifacts/scopeci: web` workflow rather than a root-level dev command.
- `vite.config.ts` requires `PORT` and `BASE_PATH`; running vite directly without them fails.
- TLS is enabled automatically for any non-local `DATABASE_URL` host, because a
  pasted Supabase URI carries no TLS settings and managed Postgres refuses
  unencrypted connections. `sslmode` in the URL always wins; `verify-full` (with
  `DATABASE_CA_CERT`) additionally verifies the chain.
- `.env` is gitignored and the repo is public — keep the connection string out of
  committed files.
- In-page links use absolute hrefs (`/#waitlist`, built from `BASE_URL`) so they also work from `/privacy`. `Home` re-runs the hash jump on mount, because the browser resolves the hash before React has rendered those sections.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
