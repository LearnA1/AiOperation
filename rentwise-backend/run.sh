#!/usr/bin/env bash
# RentWise backend -- local run script
#
# Installs dependencies, generates the Prisma client, applies migrations
# (including the new PlaybookRule table), seeds default playbook rules,
# and starts the dev server.
#
# Usage:
#   ./run.sh              # install, migrate, seed, and start
#   SKIP_SEED=1 ./run.sh  # skip the playbook seed step
#   SKIP_DEV=1 ./run.sh   # do everything except start the server
#     (useful if you just want the DB set up and will run `npm run dev` yourself)

set -euo pipefail
cd "$(dirname "$0")"

echo "== RentWise backend =="

if [ ! -f ".env" ]; then
  echo "!! No .env found. Copying .env.example -- you MUST edit it before this will work:"
  echo "   - DATABASE_URL (a real Postgres instance, e.g. Neon)"
  echo "   - leave USE_STUB_EXTRACTION=true to run without an Anthropic key"
  cp .env.example .env
  echo ""
fi

if grep -q 'DATABASE_URL="postgresql://user:password@localhost' .env 2>/dev/null; then
  echo "!! .env still has the placeholder DATABASE_URL. Set it to a real Postgres"
  echo "   connection string (Neon is fastest: https://neon.tech) and re-run."
  exit 1
fi

echo "-> Installing dependencies..."
npm install --silent

echo "-> Generating Prisma client..."
npx prisma generate

echo "-> Applying migrations (this includes the new PlaybookRule table)..."
echo "   NOTE: if Prisma ever asks to 'reset the schema' or says data will be"
echo "   lost, answer NO and stop -- that means something is wrong with the"
echo "   migration history, not with your data. Don't blow away a real DB."
npx prisma migrate dev --name add_playbook_rules

if [ "${SKIP_SEED:-0}" != "1" ]; then
  echo "-> Seeding default playbook rules (safe to re-run; won't overwrite rules you've already changed)..."
  npm run prisma:seed
fi

if [ "${SKIP_DEV:-0}" = "1" ]; then
  echo "-> SKIP_DEV=1 set, not starting the server. Run 'npm run dev' when ready."
  exit 0
fi

echo "-> Starting server..."
echo "   Try it with zero external credentials via:"
echo "     curl -X POST http://localhost:3000/dev/simulate-message \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -d '{\"message\": \"my kitchen sink is leaking badly\"}'"
echo "   GET  http://localhost:3000/api/playbook       -- see the current rules"
echo "   PUT  http://localhost:3000/api/playbook/CREATE_SERVICE_REQUEST  -- change one"
echo "        body: {\"trustLevel\": \"AUTOMATE\"}"
echo ""
npm run dev
