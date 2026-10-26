# Booking and inspection guardrails

- The client booking calendar refreshes fleet availability on open and every 30 seconds. Reserved days and return ranges that span another booking are disabled. Exact timed handovers remain valid. The API checks overlaps in the booking transaction, including simultaneous submissions.
- Renter extensions create `extensionRequests` with `status: pending`. Dates, prices and the issued contract remain unchanged. Both the Booking Agent and Operations Manager see the review queue. Approval requires a note, the current booking version, and a fresh transactional availability check; rejection retains the contract. Approved extensions use the booking's contracted daily rate.
- Inspections start with individual / driver verification. Condition checkpoints use Good, Fair, Damaged, Needs Repair and N/A. Safety checkpoints cannot be N/A on an approved inspection, and damaged checkpoints require an unsafe outcome. Photo uploads finish before Save becomes available, and uploaded references survive validation retries. Earlier boolean inspection payloads remain accepted for compatibility and normalize to Good.
- Managers retain Add Vehicle and confirmed decommission / archive actions. Profile editing includes vehicle specifications, rate, plate, renewals, image and operational holds. A mechanic inspection is required to clear a hold. New issued rental documents include the edited vehicle specifications.
- Shared pagination uses ten records per page without a size selector. The audit log retains its server pagination and stable snapshot.

## SQL injection protection

Request values use bound parameters in SQLite and PostgreSQL. Database adapters reject stacked prepared statements, incorrect binding counts and structured/non-finite parameter values. PostgreSQL placeholder conversion skips quoted strings, identifiers and comments. Dynamic audit filters use fixed application clauses and bound search values; roles and pagination inputs are validated. Raw SQL execution is reserved for application-owned schema and transaction statements. SQL-looking customer text is stored as data rather than blocked by a keyword blacklist.

Regression tests exercise malicious IDs and searches, pagination and role payloads, literal SQL text storage, inspection persistence, extension authorization and approval-time conflicts against SQLite and embedded PostgreSQL.
