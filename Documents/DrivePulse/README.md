# DrivePulse

A React rental website with separate authenticated **Client**, **Booking Agent**, **Fleet Mechanic**, and **Operations Manager** workspaces. Designed around lightweight, by-exception governance so normal workflows are automated and the Operations Manager only intervenes on exceptions.

## Run locally

Use Node.js 24 or later:

```sh
npm --prefix frontend install
npm --prefix backend install
npm run dev
```

Open http://127.0.0.1:5173. The root command runs both Vite and the Express API. In Windows PowerShell with script execution disabled, use `npm.cmd` instead of `npm`.

## Demo accounts

Sign in at `#login` using email and password:

| Role | Email | Password |
| --- | --- | --- |
| Client (End-User) | `client@drivepulse.demo` | `DrivePulse123!` |
| Booking Agent (Front Desk) | `agent@drivepulse.demo` | `DrivePulse123!` |
| Fleet Mechanic (Yard / Field) | `mechanic@drivepulse.demo` | `DrivePulse123!` |
| Operations Manager (Governance & Admin) | `manager@drivepulse.demo` | `DrivePulse123!` |

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
