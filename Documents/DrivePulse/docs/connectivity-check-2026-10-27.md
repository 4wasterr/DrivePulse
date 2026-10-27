# Vercel connectivity check — 27 October 2026

The production site at https://drivepulse-zeta.vercel.app is reachable, but it is **not error-free**. Vercel recorded four intermittent database connection timeouts on browser requests at approximately 14:54 PHT: two `GET /api/sync` requests and two `POST /api/session/activity` requests returned HTTP 500. The runtime message was `timeout exceeded when trying to connect`.

The audited deployment was `dpl_5xKntWuXfmuKGkgKgYcw5rC33d5P`, commit `de5a8c0b414f23529dfa76d73114e679bb6a1a61`, marked Ready. Its JavaScript and CSS asset names matched the local build before this check's changes.

## Live results

| Check | Result |
| --- | --- |
| Site HTML, JavaScript and CSS | HTTP 200; expected content types |
| Database health | HTTP 200 |
| Login, data sync and logout | HTTP 200 for Client, Booking Agent, Fleet Mechanic and Operations Manager demo accounts |
| Manager user directory | HTTP 200; contents excluded from diagnostic output |
| API caching | Tested API responses use `Cache-Control: no-store` |
| Branch list | HTTP 200; four branches |
| Cascading address reference | 18 regions; NCR returned 17 cities; the sampled city returned 193 barangays and ZIP suggestions |
| Login CORS preflight | HTTP 204; production origin and credentials allowed |
| Private documents without a session | HTTP 401, as expected |

Authenticated sync requests took approximately 7.3–8.5 seconds during successful probes. A separate outbound probe encountered a network connection timeout; its retry succeeded. These results establish intermittent connectivity problems, despite successful deployment and individual requests.

Live checks created temporary sign-in sessions and logged them out. They did not create customers, reservations, payments or uploaded documents.

## Local changes prepared

- PostgreSQL dashboard sync uses a repeatable-read, read-only transaction. It keeps fleet, booking and billing reads consistent without taking the global booking mutation lock. Booking updates retain that lock.
- Fleet snapshots load saved vehicle states in bulk, replacing a separate state query for each vehicle while preserving availability, rates, odometers and archive behavior.
- Concurrent focus, visibility, reconnect and polling events share an in-flight sync. A successful mutation still requests fresh data; stale responses cannot replace it.
- Temporary database connection failures return HTTP 503 with `Retry-After: 1`, a safe public message and credential-free database diagnostics. Financial writes are not retried automatically.
- Regression coverage exercises credential editing, show/hide password, connection-error recovery, registration fields, cascading addresses, required email, branch selections, failed reservation saves, vehicle fields, sync coalescing and database connection cleanup.

## Verification and limits

All 177 tests passed: 57 frontend and 120 backend, including PostgreSQL workflow checks. ESLint, the production frontend build and whitespace checks passed. The final test results are recorded in `artifacts/connectivity-final-tests.log`. Sanitized successful live API results are in `artifacts/live-connectivity.json`.

Browser use is disabled in Work settings. Click-and-type behavior was tested against the actual React components in a local DOM with mocked API responses; it was not tested interactively in the deployed browser.

The fixes are local and have not been deployed. Production must be redeployed and its sync latency and error logs rechecked before the live database timeout can be considered resolved. No production schema change is required.

Implementation references: [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/sql-set-transaction.html) and [node-postgres pooling](https://node-postgres.com/apis/pool).
