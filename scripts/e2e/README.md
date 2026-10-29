# End-to-end run

Drives the real app in a browser: the built server, a fresh Postgres
database and a fake GitHub (`fake-github.mjs`) that signs people in, lists
the App's repositories, takes check runs and comments, and sends signed
webhooks the way GitHub does.

`journey.mjs` is a pilot PM's first week:

1. Sign in.
2. Create a project.
3. Read a statement of work and save the scope.
4. Connect the repository.
5. A pull request gets flagged.
6. Re-check an earlier pull request.
7. Price, edit and send the change order.
8. Record the approval, which clears the check.
9. Change the policy.
10. Invite a teammate, who joins on a phone.
11. Archive the project.
12. Sign out.

`errors.mjs` drills the ways it can go wrong:

- GitHub down
- offline
- a failed load
- a missing project
- a webhook that can't be processed
- a session that ends
- the database going away (only with `E2E_DB_STOP` and `E2E_DB_START`)

Every page error, console error, 5xx answer and server error fails the run.

```sh
pnpm run build
E2E_DATABASE_ADMIN_URL=postgresql://postgres:postgres@localhost:5432/postgres \
E2E_DB_STOP="service postgresql stop" E2E_DB_START="service postgresql start" \
node scripts/e2e/run.mjs
```

Needs Playwright with Chromium (`npx playwright install chromium`); CI installs
it outside the workspace and points `NODE_PATH` at it. The run
drops and recreates the `scopeci_e2e` database. Screenshots go to `$E2E_OUT`,
or a temporary directory it prints.
