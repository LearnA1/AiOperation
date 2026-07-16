#!/usr/bin/env bash
# RentWise dashboard (frontend) -- local run script
#
# Wired to the REAL backend, not mock data. Make sure the backend is
# already running first:
#   cd ../rentwise-backend-4-2 && ./run.sh
#
# Then in a second terminal:
#   ./run.sh              # start the dashboard on http://localhost:5173
#   BACKEND_URL=http://localhost:4000 ./run.sh   # if your backend runs on a different port

set -euo pipefail
cd "$(dirname "$0")"

echo "== RentWise dashboard =="
echo "-> Installing dependencies..."
npm install --silent

BACKEND_URL="${BACKEND_URL:-http://localhost:3000}"
echo "-> Proxying /api and /dev to ${BACKEND_URL}"
echo "   (make sure the backend is already running there -- see rentwise-backend-4-2/run.sh)"
echo ""
echo "-> Starting dashboard on http://localhost:5173"
echo ""
BACKEND_URL="$BACKEND_URL" npm run dev
