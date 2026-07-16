# RentWise Dashboard (frontend)

The real dashboard, wired to your real backend — `rentwise-backend-4-2`.
No mock data anywhere in this project; every view fetches from your actual
API and every action (approve, reject, playbook change) calls the real
endpoint.

## Run it

**Terminal 1 — backend** (if it's not already running):
```
cd ../rentwise-backend-4-2
./run.sh
```

**Terminal 2 — this dashboard:**
```
./run.sh
```
Then open **http://localhost:5173**.

The dev server proxies `/api` and `/dev` straight to `http://localhost:3000`
(your backend), so there's no CORS setup needed. If your backend runs on a
different port: `BACKEND_URL=http://localhost:4000 ./run.sh`.

## What's real vs. what changed from the original mock

This started as `rentwise-dashboard.jsx`, a single-file mock with hardcoded
data. Wiring it to the real backend meant a few honest changes:

- **Confidence, force-manual, and the draft reply now live on the `Action`**,
  not the `Conversation` — matches your real schema. The UI reads whichever
  `Action` on a conversation is most recent.
- **A conversation's status** (`Escalated` / `Needs Review` / `Sent` /
  `Dismissed` / `Send Failed`) is now derived directly from
  `Action.status`, not recomputed client-side against local settings. The
  real decision already happened server-side, through the playbook, at the
  moment the message came in — the frontend just reflects it.
- **New "Playbook" page** — the mock never had one, but it's the actual
  primary control now (see `rentwise-backend-4-2`'s playbook feature).
  Rocker-style buttons call `PUT /api/playbook/:actionType` directly.
- **New "Audit Trail" page** — surfaces `GET /api/audit`, which existed on
  the backend but had no UI at all before this.
- **Tenants and Policies are now real reads** — this required two small
  backend additions (`GET /api/tenants`, `GET /api/policy`) that didn't
  exist before. See the backend's own notes on this.
- **Settings is simplified** to just the confidence threshold. The
  original mock's three-way "automation mode" selector doesn't cleanly
  map to the real architecture anymore now that the Playbook exists —
  keeping both would mean two different, possibly-contradictory controls.
- **Calendar only shows what's real**: rent-due days and lease
  expirations, computed from actual `Tenant` records. Vendor-visit and
  late-fee events from the original mock are gone — there's no backend
  feature tracking either of those yet. Said explicitly in the UI rather
  than left silently missing.
- **"Simulate Message" now hits the real pipeline** — it POSTs to
  `/dev/simulate-message` instead of injecting a fake conversation
  client-side, so it exercises real extraction → playbook → action
  creation, same as if a tenant had actually texted in.
- **The AI's sent reply now actually appears in the conversation thread.**
  This needed a small backend fix: `executor.ts` was sending the reply but
  never saving it as a `Message`, so a completed conversation would show
  the tenant's message and then nothing. Fixed by persisting the reply on
  successful send.

## A known rough edge

There's still no auth on the backend's API — anyone who can reach
`localhost:3000` (or wherever you deploy it) can hit every route. Fine for
local development; not fine to point a real client at yet. Worth doing
before any real onboarding.

## Project layout

```
rentwise-frontend/
├── run.sh
├── package.json
├── vite.config.js       # dev-server proxy to the backend
├── tailwind.config.js
├── index.html
└── src/
    ├── main.jsx
    ├── App.jsx           # all views live here, same as the original mock's single-file style
    ├── api.js            # every fetch call to the real backend
    └── lib.js            # shared design tokens + small data-shaping helpers
```
