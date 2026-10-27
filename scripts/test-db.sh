#!/usr/bin/env bash
# Runs every database-backed test suite, each on a freshly created database.
# Needs psql and a DATABASE_URL whose database may be dropped and recreated.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?DATABASE_URL must be set}"

DB_NAME="${DATABASE_URL##*/}"
DB_NAME="${DB_NAME%%\?*}"
ADMIN_URL="${DATABASE_URL%/*}/postgres"

fresh() {
  psql "$ADMIN_URL" -q -v ON_ERROR_STOP=1 \
    -c "drop database if exists \"$DB_NAME\" with (force)" \
    -c "create database \"$DB_NAME\""
  pnpm --filter @workspace/db run -s push-force > /dev/null
  if [ "${1:-}" = "seed" ]; then pnpm run -s db:seed > /dev/null; fi
}

failed=()
run() {
  echo "::group::$1"
  if ! pnpm run -s "$1"; then failed+=("$1"); fi
  echo "::endgroup::"
}

# The older suites expect the seeded sample organization; the product and
# demo suites build their own data from nothing.
for suite in db:test test:github test:linear test:phase4 test:security test:launch; do
  fresh seed
  run "$suite"
done
fresh
run test:demo

# The product suite runs on a database built only by what the server does on
# start (scripts db:ensure), so a deploy with no manual schema push works.
psql "$ADMIN_URL" -q -v ON_ERROR_STOP=1 \
  -c "drop database if exists \"$DB_NAME\" with (force)" \
  -c "create database \"$DB_NAME\""
pnpm run -s db:ensure > /dev/null
run test:product

if [ ${#failed[@]} -gt 0 ]; then
  echo "Failed: ${failed[*]}"
  exit 1
fi
echo "All database suites passed."
