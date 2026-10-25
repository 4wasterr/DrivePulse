# DrivePulse

A React rental website with separate authenticated **Client**, **Booking Agent**, **Fleet Mechanic**, and **Operations Manager** workspaces. Designed around lightweight, by-exception governance so normal workflows are automated and the Operations Manager only intervenes on exceptions.

## Run locally

Use Node.js 24 or later:

```sh
npm run setup
npm run dev
```

Open http://127.0.0.1:5173. The root command runs both Vite and the Express API. In Windows PowerShell with script execution disabled, use `npm.cmd` instead of `npm`.

Setup creates `backend/.env` if it does not exist. With an empty `DATABASE_URL`, development uses `backend/data/drivepulse.sqlite`. Accounts, sessions, bookings, uploaded files, support conversations, and audit records persist across restarts. Supabase is not needed for local work. The database and environment file are excluded from deployment packages.

Run `npm run check` to lint, run the SQLite and embedded PostgreSQL workflow tests, and build the frontend. The PostgreSQL tests run locally without a Supabase account. Generate a clean source archive with `npm run package:deploy`.

## Deploy with Vercel and Supabase

The application code is prepared for Vercel Services. **Production activation is pending your Supabase connection, database migration, and first manager account.** Follow [the deployment guide](docs/deployment.md) once Supabase is available.

`vercel.json` routes `/api` to Express and everything else to the Vite frontend on the same domain. Both services use Node.js 24 and their committed lockfiles. Keep Vercel Root Directory at the folder containing this file: `Documents/DrivePulse` in the existing parent repository, or `.` in a separate DrivePulse repository.

Production uses PostgreSQL through the backend-only `DATABASE_URL`. The Supabase JavaScript API keys are not required. Uploaded files are stored as private database bytes and downloaded only through authenticated API routes. The upload limit is 4 MB. Production refuses to use SQLite or an in-memory fallback. Missing database configuration produces HTTP 503.

Use `backend/.env.production.example` for the required environment variables. Run `npm run db:migrate`, then `npm run db:manager` to create the first manager with a password entered privately. The manager creates other staff accounts through User Management. Demo accounts and public staff registration are disabled in production.

Run `npm run preflight -- --connect` with the production environment loaded before deploying. See [Vercel Services](https://vercel.com/docs/services) and [Supabase connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres).

## Demo accounts

In local demo mode, sign in at `#login` using a username (or the email shown below) and its password:

| Role | Username | Email | Password |
| --- | --- | --- | --- |
| Client (End-User) | `demo` | `client@drivepulse.demo` | `demo` |
| Booking Agent (Front Desk) | `bkagent` | `agent@drivepulse.demo` | `bkagent` |
| Fleet Mechanic (Yard / Field) | `flmechanic` | `mechanic@drivepulse.demo` | `mechanic` |
| Operations Manager (Governance & Admin) | `opmanager` | `manager@drivepulse.demo` | `opmanager` |

## User Roles & System Responsibilities

### 1. Client (*End-User*) — Demand & Consumption
- Browses vehicle models, daily rates, availability, and capacity.
- Submits bookings and uploads verification IDs (Driver’s License and two valid government IDs).
- Processes payments/deposits and accesses official rental contracts, receipts, dispatch passes, and booking status.

### 2. Booking Agent (*Front Desk*) — Reservation & Intake Handling
- **Unified Reservations & Intake:** Manages walk-in and online reservations, validates customer identity, confirms schedules, collects cash payments/security deposits, and issues digital dispatch passes from one unified queue.
- **Availability Calendar:** Interactive 7-day fleet schedule with operational readiness holds.
- **Adjustments & Customer Support:** Handles booking extensions, cancellations, returns, and support conversations.
- **One-Click Soft Deletes:** Archives completed or cancelled historical bookings in one click to keep active queues clean.

### 3. Fleet Mechanic (*Yard / Field*) — Vehicle Health & Auditing
- **Digital Checklists & Photo Proof:** Executes pre-dispatch and post-return checklists (tire pressures in PSI, odometer mileage, fuel/battery percentage, exterior scratches, interior cleanliness) with mandatory exterior and interior condition photographs.
- **Automated Clean-Return Trigger:** Marking a post-return inspection *Safe*, *Clean*, with *zero damage flags* and *100% fuel* automatically triggers the 24–48 hour security deposit **Auto-Release** without requiring manager approval.
- **Work Orders & Fleet Readiness:** Logs repair work and maintenance costs, flags unsafe cars as **Out of Service**, and submits vehicle decommission requests for manager confirmation.

### 4. Operations Manager (*Governance & Admin*) — Oversight, Auditing & Control
- **Aggregated Dashboard & Fleet Oversight:** High-level operational counts (`Utilization %`, `Units Overdue`, `Critical Repairs`, `Exceptions Awaiting Review`), live deployment stages, anomaly drill-down filter, daily rate modifications, and vehicle decommissioning.
- **By-Exception Financial & Policy Controls:** Clean returns auto-release deposits automatically; the Operations Manager only reviews **disputed/withheld deposits**, **cancelled rental refunds**, **overdue rental overrides**, and **driver risk overrides**.
- **User Management & Telemetry:** Provisions staff and client accounts, manages role authority, deactivates employee/user accounts with confirmation, and tracks authentication telemetry (successful vs. failed login attempts and IP history).
- **System Audit Logs & Threshold Alerts:** Automatically flags suspicious events (**Rate change > 20%**, **Failed login attempts**, **Off-hours deletions**, **Permanent record purges**, **Policy overrides**) on a dedicated notification widget while keeping raw forensic logs searchable with **Actor IDs** and **Old vs. New Value** mutation diffs.
- **Data Archives:** Reviews, restores, or permanently purges soft-deleted bookings, deactivated users, and decommissioned vehicles.
- **Macro Dashboards:** Reviews and exports fleet utilization percentages, net rental revenue growth, driver risk summaries, and maintenance costs.
