# DrivePulse

A React rental website with separate authenticated client and booking-agent workspaces. The interface uses black, white, and neutral grays; car photographs keep their original colors.

## Run locally

Use Node.js 24 or later. Dependencies already present in `frontend/node_modules` and `backend/node_modules` can be reused. On a fresh checkout:

```sh
npm --prefix frontend install
npm --prefix backend install
npm run dev
```

Open http://127.0.0.1:5173. The root command runs both Vite and the Express API. In Windows PowerShell with script execution disabled, use `npm.cmd` instead of `npm`.

You can also run `npm run dev` separately inside `backend` and `frontend`. The API uses port 5000 by default; Vite proxies `/api` requests to it. `npm run build` builds the frontend, and `npm test` runs both test suites.

## Accounts

The landing page opens first. Client sign-in and registration are at `#login` and `#signup`; booking-agent sign-in and registration are at `#agent-login` and `#agent-signup`. Each account lands in its own workspace. Public fleet browsing remains available without signing in; reserving and saving a vehicle require a client account.

The sign-in screens offer **Try client demo** and **Try agent demo** buttons in development. Seeded credentials are:

| Account | Email | Password |
| --- | --- | --- |
| Client | client@drivepulse.demo | DrivePulse123! |
| Booking agent | agent@drivepulse.demo | DrivePulse123! |

The demo includes labeled sample reservations, PDF review documents, pending payments, an active rental, and a customer query. New accounts start with their own records. Existing browser-local records from the previous frontend preview remain untouched but are not imported into the new service.

## Booking-agent workspace

- **Reservations:** Search and filter online and walk-in bookings. Schedule walk-ins with a server-calculated quotation and exact-time availability validation. Matching client email addresses link walk-ins to the corresponding client portal.
- **Availability:** Browse a seven-day vehicle calendar, move between weeks, choose dates, open reservations, and schedule from an available cell. Partial-day bookings are checked using exact times on submission.
- **Customer verification:** Open actual uploaded PDFs/images, approve or reject each license and ID, and supply rejection notes. The three required documents must be distinct files. Replacements return verification to pending and invalidate any issued pass.
- **Payments and billing:** Confirm or reject submitted payment records; record downpayments, rental balances, deposits, and additional charges with receipt references. Amounts cannot exceed their outstanding allocation.
- **Dispatch:** Record an inspection checklist and issue a digital pass only when identity, rental payment, deposit, and inspection checks pass. Download a printable HTML pass or use Print → Save as PDF. Mark the vehicle dispatched to begin the rental.
- **Adjustments:** Extend a rental with conflict checks and recalculated charges, cancel before dispatch with preserved payment/refund accounting, or record a return with configurable fees for started late hours. Extensions invalidate an existing pass; closed rentals cannot be rescheduled.
- **Customer support:** Read client questions, open linked reservations, reply, and resolve or reopen conversations. Booking changes and staff actions are retained in the reservation activity log.

Clients can upload documents, reserve a vehicle, track staff updates, download an issued dispatch pass, and send extension/cancellation requests through Help & support. Both workspaces refresh from the service every 30 seconds and on window focus.

## Storage and security boundary

The Express API stores users, sessions, bookings, payment records, conversations, and uploaded file bytes in SQLite at `backend/data/drivepulse.sqlite`. This directory is ignored by Git. `DB_PATH` can override it. Use `HOST`, `PORT`, and comma-separated `FRONTEND_ORIGIN` values to configure the development service.

Passwords are salted and hashed with scrypt. Sessions use random tokens in HttpOnly, SameSite=Strict cookies; the database stores token hashes. All agent mutations enforce the staff role on the server. Client records and document downloads are scoped to the owner; public availability exposes only vehicle/time/status information. Server transactions protect reservations from overlaps; version checks reject stale staff updates. Uploaded files are limited to 5 MB and checked for supported signatures.

This is a development implementation, not a live rental or payment integration. Payment confirmation records a staff decision and does not charge or refund money. Dispatch exports are development copies; the current server record must be checked before release. Agent self-registration is enabled for the requested preview; `NODE_ENV=production` disables agent self-registration and demo seeding by default. Production staff provisioning, password recovery, HTTPS hosting, backups, payment providers, file scanning, and business-specific rental policies require a deployment plan.

The vehicle photos are illustrative local Unsplash assets; see `frontend/README.md` for attribution.
