# ScopeCI

ScopeCI is a premium landing and waitlist site for commercial CI/CD built for software agencies.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/scopeci/src/App.tsx` — single-page landing experience and interactive product surfaces
- `artifacts/scopeci/src/index.css` — ScopeCI visual tokens, responsive layout, and motion rules
- `attached_assets/logo-without-bg_1788955275556.png` — supplied icon-only logo asset
- `attached_assets/logo-without-bg-and-wordmark_1788955275557.png` — supplied transparent full logo asset

## Architecture decisions

- The landing page is frontend-only; waitlist submission is intentionally represented with a polished local success state until a real endpoint is connected.
- Product visuals are built from HTML/CSS so they stay crisp, fast, and believable at all viewport sizes.
- Motion is used to explain system activity and respects reduced-motion preferences.

## Product

The site explains how ScopeCI connects signed scope, project issues, and GitHub pull requests to commercial authorization, then captures early-access interest through a waitlist form.

## User preferences

- Keep the brand technical, restrained, and credible; do not introduce generic AI-startup visual language or fabricated proof.

## Gotchas

- Use the supplied logo files directly and preserve their proportions.
- Verify the page through the managed `artifacts/scopeci: web` workflow rather than a root-level dev command.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
