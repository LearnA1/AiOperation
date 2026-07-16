# RentWise backend

The wiring behind the dashboard prototype: real connector code for Gmail, Twilio,
and a PM software, a clean internal data model, an approval engine that gates
every outbound action, and an append-only audit trail.

## Read this first — what's real vs. what's a stub

This code is written to compile and run against **real** Gmail, Twilio, and
Anthropic APIs once you supply credentials — it was not built/tested live here,
since this environment can't reach `googleapis.com`, `twilio.com`, or a PM
vendor's API. Treat it as a complete, deployable scaffold, not a demo you can
run untouched:

- **Gmail & Twilio connectors** — real, correct calls against the actual SDKs.
  Add credentials in `.env` (copy `.env.example`) and they'll work.
- **PM software connector** — `RestPmsConnector` targets a generic REST API
  shaped like AppFolio/Buildium's public APIs. If your pilot customer uses
  Yardi Voyager, **do not use this class** — see "Yardi is different" below.
- **Extraction engine** — real Anthropic API call, with policy context injected
  so the AI can't invent late fees or lease terms.
- **Database** — needs a real Postgres instance; run `npm run prisma:migrate`
  once `DATABASE_URL` is set.

## Architecture — one pipeline, two entry points

```
Twilio webhook  ─┐
                 ├─▶ find tenant (PMS) ─▶ store Message ─▶ extract (AI) ─▶
Gmail poll job  ─┘        approval engine ─▶ create Action ─▶
                              (auto)  ──────────────▶ executor ─▶ Gmail/Twilio/PMS
                              (needs approval) ─▶ manager queue (dashboard)
                                                        │
                                              approve/reject via API
                                                        ▼
                                                    executor
```

Every step writes to `AuditLogEntry`. Nothing reaches Gmail, Twilio, or the PM
software except through `executeAction()`, and that function refuses to run
unless an Action's status is `APPROVED`.

## Data model

See `prisma/schema.prisma`. The short version:

- `Tenant` / `Unit` / `Property` — mirrors what's in the PM software, linked by `pmsId`
- `Conversation` — one thread per inbound topic
- `Message` — every message, inbound and outbound, kept forever (this is what
  lets a manager view a conversation's full history in the dashboard, even
  long after an AI reply was sent)
- `Action` — every proposed outbound effect (a reply, a vendor notification, a
  service request). This is the single choke point the approval engine and
  executor both operate on.
- `AuditLogEntry` — append-only. No `update()` or `delete()` exists in `audit/log.ts` on purpose.
- `AutomationSettings` — the one row the Settings tab in the dashboard reads/writes: mode (`autonomous` / `confidence` / `manual`) and threshold. Now used only as a fallback for any `ActionType` that doesn't have a `PlaybookRule` yet (see below).
- `PlaybookRule` — one row per `ActionType`, each with a trust level: `AUTOMATE` / `ASK_FIRST` / `NEVER`. This is the actual day-to-day control surface — see "The playbook" below.

## Approval-based actions

`src/engine/approval.ts` is the only file that branches on automation
settings. Decision order, checked every time an Action is created:

1. `safetyCritical` (from the AI's own extraction) → always `PENDING_APPROVAL`, no exceptions.
2. A `PlaybookRule` exists for this action's type →
   - `NEVER` → always `PENDING_APPROVAL`, `forceManual: true` (this action never runs itself, no matter what — the same idea as Rational's "send wire transfers → Never")
   - `ASK_FIRST` → always `PENDING_APPROVAL`
   - `AUTOMATE` → auto-approved *if* the AI's confidence clears `AutomationSettings.threshold`; otherwise still `PENDING_APPROVAL` as a safety net
3. No `PlaybookRule` row yet for that type → falls back to the original global `mode`/`threshold` behavior, unchanged.

## The playbook

This is the actual thing a property manager tunes day to day — the
same shape as Rational's own playbook, applied to property management
instead of accounting. Four rules, one per `ActionType`, each a live
trust lever:

| Action type | Default | Why |
|---|---|---|
| Send a reply to a tenant | Automate | Routine, low-risk, still gated by confidence |
| Notify a manager | Automate | Purely informational |
| Create a service request in the PM software | Ask first | Opens a real work order, can trigger vendor cost |
| Notify a vendor directly | Ask first | Outbound message on the manager's behalf |

```
GET  /api/playbook                          # list all rules
PUT  /api/playbook/CREATE_SERVICE_REQUEST   # { "trustLevel": "AUTOMATE" | "ASK_FIRST" | "NEVER" }
```

A change here takes effect on the very next matching message — nothing
to redeploy, and every change is written to the audit log (`playbook.updated`)
with who made it. Seed or reset the defaults any time with `npm run prisma:seed`
(safe to re-run — it won't overwrite a rule you've already changed).

## Audit trail

`GET /api/audit` returns the full append-only log — every message received,
every action created (with the AI's reasoning attached), every manager
approval/rejection (with who and when), and every execution or failure. This
is what you'd show a skeptical operator (or their lawyer) when they ask "how
do I know what the AI actually did."

## Additions made for the real dashboard

The `rentwise-frontend` project (a separate repo/zip) is the real dashboard,
wired to this backend instead of running on mock data. Getting it fully
honest required three small additions here:

- **`GET /api/tenants`** — the dashboard's Tenants roster had nothing to
  read from before this.
- **`GET /api/policy`** — exposes `policyContext.ts`'s text over the API so
  it's visible in the dashboard instead of buried in code. Still read-only;
  editing it means editing the file directly for now.
- **`executor.ts` now persists the AI's reply as a `Message`** on a
  successful `SEND_REPLY`. Before this, a sent reply only ever existed as
  `Action.payload.body` — it never actually landed in the conversation's
  message history, so a completed conversation thread would show the
  tenant's message and then nothing.

None of these change existing behavior for anything already working —
each is a pure addition.

## Yardi is different

Per our earlier research: Yardi Voyager has no open REST API. Official access
requires SIPP (2+ years old, 3+ sponsoring clients — not viable pre-launch).
The realistic path for a pilot is **Strategy A**: the client provisions a
scoped Interface Web User inside their own Voyager instance and opens a
support case to whitelist your connection, which then talks to Yardi's
SOAP/WSDL endpoints rather than a clean REST API. If/when that's set up,
implement a `YardiPmsConnector implements PmsConnector` alongside
`RestPmsConnector` — the interface in `src/connectors/pms.ts` doesn't change,
and neither does anything else in the system.

Until then, the connector can run in read-mostly mode (tenant lookups only)
with `createServiceRequest` writing to a manager-visible queue instead of the
PM software directly, if you want to pilot the messaging half of the workflow
before Yardi access is sorted out.

## Setup

Quickest path:

```
./run.sh
```

Installs dependencies, generates the Prisma client, applies migrations
(including the new `PlaybookRule` table), seeds default playbook rules,
and starts the dev server. It'll copy `.env.example` to `.env` for you
on first run and tell you what to fill in (mainly `DATABASE_URL`).

Or by hand, same as before:

```
cp .env.example .env   # fill in real credentials
npm install
npm run prisma:migrate
npm run prisma:seed    # seed default playbook rules
npm run dev
```

Try the whole pipeline with zero external credentials via the dev route
(needs `USE_STUB_EXTRACTION=true`, the default):

```
curl -X POST http://localhost:3000/dev/simulate-message \
  -H "Content-Type: application/json" \
  -d '{"message": "my kitchen sink is leaking badly"}'
```

Point the pilot customer's Twilio number's webhook at:
`POST https://<your-deployed-url>/webhooks/twilio`
