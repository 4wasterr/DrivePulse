# Workflow update verification — 27 October 2026

The updated flow runs from trip parameters to available vehicle selection, document checks, agreement confirmation, reservation creation, cash collection and return scheduling.

## Implemented

- Sessions expire after 15 minutes without clicks, keypresses or route navigation. The server independently checks inactivity, deletes expired tokens and clears the HTTP-only cookie. Background refreshes do not renew inactivity. Browser tabs share activity/logout notifications, and an expired session returns to sign-in with an alert.
- Required booking inputs and customer confirmation gate the walk-in action in both the UI and API. Booking steps retain schedule, document, availability and agreement checks.
- Booking transaction references are generated on the server as `DP-TXN-` plus 16 hexadecimal characters. Reference displays are read-only. Cash receipt numbers are also assigned automatically.
- The Security Deposit action collects cash, verifies the remaining allocation, creates a receipt and updates the financial summary and ledger. Expected online cash entries are reconciled with full or partial collections.
- Pick-up and return selectors fetch active branch records from `/api/locations`. Records live in `fleet_records` with kind `location`; there are no frontend location constants. API validation uses the same active records.
- Shared dialog drafts restore text, selections and controlled form state after close/reopen or navigation. Drafts are scoped by account, dialog and record, and cleared on successful saves and logout. Passwords are excluded from web storage; staged photo files survive dialog closes in memory.
- Returns Schedule is available to agents and managers. It displays scheduled return time, vehicle identity/model, client, drop-off status and mechanic condition sign-off. The return details dialog shows each item once.
- Removed QR displays and the unused QR generator, ratings, the maximum daily rate filter, the availability helper subtitle, records-per-page text and validation summary banners. Validation appears beside individual fields. Forgot-password spacing is increased.
- Added ten vehicle models with variant-specific seating, fuel and capacity data. Shared definitions include manufacturer specification links in `shared/fleetExpansion.json`. Rental rates are testing defaults.
- All sixteen preconfigured cars have unique sample Philippine-format plates. Missing plates are assigned once and persisted, with collision checks; saved plate numbers remain unchanged. Plates appear in fleet cards, vehicle details, booking summaries, return details and newly issued rental documents.
- Transactional email headers embed the official DrivePulse mark as an inline PNG and use the DrivePulse sender name.

## Verification

| Check | Result |
| --- | --- |
| Full backend suite | 110 tests passed, covering SQLite and embedded PostgreSQL |
| Frontend suite | 32 tests passed, including inactivity timers and multi-step gates |
| Final fleet/booking regression | 37 SQLite workflow tests passed after plate assignment |
| New security/data workflow tests | Passed on SQLite and PostgreSQL, including legacy immutable triggers, partial deposit collection, plate uniqueness and preservation |
| ESLint / production build | Passed; Vite reports a bundle-size advisory |
| Browser walk-in | Required checks gated creation; generated reference and confirmation displayed |
| Browser drafts | Customer details/note restored after close; client trip step restored after page reload and reopen |
| Browser cash collection | PHP 5,000 deposit generated a receipt; verified balance became PHP 5,000 and outstanding rental became PHP 12,600 |
| Browser client trip | Parameters → fleet → documents → agreement → reservation confirmation completed |
| Browser returns / validation | Layout inspected; empty login fields produced inline messages without a summary banner |

Browser verification used an isolated in-memory API with demo accounts. Labeled test PDFs were supplied through that isolated API; native file-chooser automation was unavailable. No real identity documents were used.

![Return details](../artifacts/return-details.png)

![Vehicle plate](../artifacts/vehicle-license-plate.png)

## Database cleanup

Removed five marked demo bookings, ten simulated transactions, one linked financial exception, one linked support ticket, seven sample rental documents, three unshared sample uploads and twenty-six associated sample log entries. A JSON backup was written under `backend/data/backups/` before deletion. Immutable log/receipt guards were restored transactionally, including guards from the earlier database schema.

All login accounts and fleet records were preserved. DP-12485EBA and other unmarked bookings were retained as requested. An unmarked maintenance request was also retained. No marked demo/test records remain in the cleanup preview. Account and unmarked-booking counts changed during the work as new records arrived; those records were preserved.

Automatic demo reservation/support seeding has been removed. Demo mode now seeds login accounts only. `npm.cmd run db:clean-demo` previews marked-record cleanup; add `-- --apply` to perform it with a backup. The cleanup does not run on application startup.

Fleet state was separately backed up before adding plate assignments to the connected database.

## Activation and email profile

Source changes are in this workspace. Restart or redeploy the application to activate the updated API/UI. Database cleanup and plate assignments have already been applied to the configured database.

The Gmail inbox avatar requires updating the **sending Google account's profile picture**; SMTP cannot change it. Use `backend/assets/drivepulse-logo.png` and follow [Google's profile-picture instructions](https://support.google.com/accounts/answer/27442). See [email setup](email-setup.md). Email tests use a mocked SMTP transport; no live email was sent during verification.
