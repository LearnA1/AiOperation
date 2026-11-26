# RentWise

An AI assistant for property managers. Tenant messages arrive by SMS (Twilio) or email (Gmail), an AI step extracts what the tenant needs, and every proposed action goes through an approval layer before anything is sent or created. A React dashboard lets a manager review, approve, or reject actions and tune how much the system is allowed to do on its own.

**Status:** working scaffold. The pipeline runs locally with a stubbed extraction step and no external credentials. The Gmail, Twilio, Anthropic, and property-management-software connectors are written against the real APIs but have not been tested live (details in the [backend README](rentwise-backend/README.md)).

## How it works

```
Twilio webhook  -+
                 +-> find tenant -> store message -> extract (AI) -> approval engine
Gmail poll job  -+                                                        |
                                              auto-approved  <------------+------> manager queue
                                                    |                                  |
                                                    +------------> executor <----------+
```

- **Approval engine.** Each proposed action (send a reply, notify a manager, create a service request, notify a vendor) is checked against a per-action "playbook" rule: `AUTOMATE`, `ASK_FIRST`, or `NEVER`. Safety-critical messages always need manual approval.
- **Single execution point.** Outbound actions only run through one executor function, and it refuses to run an action that has not been approved.
- **Audit log.** Messages, actions, approvals, and executions are written to an append-only log.
- **Stub mode.** With `USE_STUB_EXTRACTION=true`, a keyword-based stand-in replaces the Anthropic call so the whole flow can be tried without API keys.

## Tech stack

- **Backend:** Node.js, TypeScript, Express, Prisma, PostgreSQL, node-cron
- **Integrations:** Anthropic API, Twilio, Gmail API
- **Frontend:** React 18, Vite, Tailwind CSS

## Repository layout

```
rentwise-backend/    API, approval engine, connectors, Prisma schema
rentwise-frontend/   manager dashboard (proxies /api to the backend on port 3000)
```

## Running locally

Requires Node.js and a PostgreSQL database.

```bash
# backend
cd rentwise-backend
cp .env.example .env      # set DATABASE_URL; leave the other keys blank for stub mode
./run.sh                  # installs, migrates, seeds, and starts on :3000

# dashboard (new terminal)
cd rentwise-frontend
./run.sh                  # http://localhost:5173
```

Try the pipeline with no credentials:

```bash
curl -X POST http://localhost:3000/dev/simulate-message \
  -H "Content-Type: application/json" \
  -d '{"message": "my kitchen sink is leaking badly"}'
```

## Further reading

- [Backend README](rentwise-backend/README.md): data model, approval rules, audit trail, connector notes
- [Frontend README](rentwise-frontend/README.md): dashboard details
