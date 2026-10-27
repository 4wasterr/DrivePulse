# Booking, verification and return updates

## Pre-dispatch cancellation

The Booking Agent opens **Adjustments & return → Cancel Booking**, reviews the settlement, enters a reason and confirms. The server calculates a fee of **20% of confirmed rental/downpayment receipts**, rounded to centavos. Pending payments and the security deposit are excluded from the fee base. No verified downpayment means no cancellation fee.

For PHP 3,000 received toward rental and PHP 5,000 received as a deposit, the fee is PHP 600, the rental refund is PHP 2,400, and the deposit refund is PHP 5,000. The cancelled invoice has no outstanding rental/deposit charge. Original cash receipts remain intact. Separate rental and deposit refund requests enter the existing manager approval ledger automatically; the UI shows **Pending cash release** until those releases are recorded. Cancelling immediately removes the booking's reservation interval and revokes its dispatch pass. A version check prevents duplicate settlement. Earlier cancellations retain their original fee policy.

An immutable cancellation statement records the reason and settlement. The original issued contract remains available; new contracts include the cancellation policy.

## Mileage before re-acceptance

Dispatch captures the mechanic's pre-dispatch odometer. The post-return form shows the starting reading, entered return reading, and total distance used. A dispatch reading of 1,500 km and return reading of 2,500 km records **1,000 km**. Missing baselines and decreasing readings are rejected; safety clearance cannot bypass a pending post-return inspection. The calculation persists with the booking, mechanic inspection, audit record and return receipt.

Mechanic inspections follow four required stages: **Vehicle details → Vehicle condition → Damage status → Dispatch decision**. Vehicle details include driver verification and measured readings. The mechanic individually assigns each checkpoint a rating: **1 – Good, 2 – Fair, 3 – Damaged, 4 – Needs Repair**. Damage status and fresh photos follow the ratings. The last stage reviews the complete inspection and requires an explicit readiness / dispatch decision; it has no default approval. Ratings 3–4 prevent dispatch approval until repaired. The server records the signed-in mechanic's identity and numeric ratings in the report and audit; issued release/return receipts include the ratings. Earlier text/checkbox inspection records remain readable. Mechanic approval does not dispatch a booking; Booking Agent release checks remain mandatory.

The inspection form has no reservation dropdown. Queue actions preserve their trip automatically; fleet actions choose the earliest outstanding inspection for that vehicle, with pending post-return work taking priority. Previously approved returns and archived trips are excluded from automatic selection. The linked trip appears as context text, and its ID/version and dispatch odometer remain attached when saving. When no trip is awaiting the selected inspection, the form shows that state instead of an empty required selector or driver fields; safety / maintenance clearance is available for service work. An active rental still requires its actual return to be recorded before post-return inspection.

## Availability and branches

Reservations use half-open intervals in Philippine time: an exact timed handover is allowed. New reservations, date pickers and the fleet calendar check the same overlap function. Maintenance requests can carry a complete start/end window; bookings and extensions cannot overlap that window. Completed/archived maintenance and cancelled/completed bookings release their intervals.

Undated repair or safety holds and overdue rentals remain blocked until staff resolve them, because their actual release time is unknown. A work order that exceeds its planned end also requires clearance. The calendar no longer invents a two-day maintenance duration.

Pick-up and return selectors show active branches, including the default Makati, BGC, NAIA Terminal 3 and Quezon City branches. Existing location values remain stored for compatibility with earlier contracts; branch labels are separate. Deactivated branch records are excluded. Walk-in bookings require a valid non-empty email and silently look up an existing client account.

## PSGC addresses

Region → city/municipality → barangay selectors use first-party `/api/geography` routes and a bundled reference containing 18 regions, 1,642 cities/municipalities and 42,011 barangays. Changing a parent clears its dependent fields. The backend validates each parent/child relationship and saves canonical names and codes. Existing account addresses are preserved by an additive SQLite/PostgreSQL migration.

ZIP suggestions populate from the selected city and, where an exact delivery-area match exists, the barangay. The postal selector supports a different four-digit delivery ZIP when the reference is incomplete. PSGC boundaries and postal delivery zones are separate systems; city-level suggestions are not treated as definitive barangay assignments.

Sources: [PSGC data platform](https://barangays.sanchez.ph/), [PSGC Cloud API](https://psgc.cloud/api-docs/v2), [Philippine postal reference](https://zip.ph.neps.dev/). Source URLs and retrieval timestamp are in `backend/reference/geography.json`. Refresh intentionally with `node backend/scripts/refresh-geography.js`; invalid/incomplete downloads preserve the existing reference. Production forms do not make third-party requests.

## Private documents and consistent refreshes

Documents use private database bytes, not a Supabase Storage bucket or expiring signed URLs. Downloads use the same-origin authenticated `/api/documents/:id` route, no-store responses, bounded requests, cancellation on dialog close, MIME checks and useful retry errors. Booking Agents can read customer documents and clients can read their own; mechanics and managers retain access to condition photos rather than private client IDs. Approval requires the original stored document to exist and match its fingerprint.

When a download is unavailable, the viewer shows a clearly marked local sample ID, license or proof-of-billing preview. Samples are never substituted for an uploaded document, identity approval or a receipt. `FRONTEND_ORIGIN` must contain the exact frontend origin when running a custom local port or separate frontend domain. Never make customer documents public to work around retrieval failures.

`/api/sync` supplies session, workspace, fleet, availability, operations and notifications in one transaction. All viewport sizes consume that response, and API reads bypass browser caches. Successful mutations, reconnects, window focus and visibility restoration refresh data; background polling remains at 30 seconds and does not renew inactivity.

The login expiration notice clears on route/form mount, keyboard, touch, input, submit and successful sign-in; it is never restored from storage and has an eight-second maximum lifetime. Session revisions prevent old API/document responses and idle callbacks from expiring a new login. Anonymous login refreshes cannot trigger expiry, and a new sign-in waits for an outstanding timeout logout response before creating its cookie. The expired-cookie `/api/sync` response is an anonymous snapshot, while protected API actions still reject expired sessions.

All phone fields use `+63 9XX XXX XXXX`. Every role uses `WorkspaceSidebar` and the same account/footer component. Desktop widths, the 1,000px mobile breakpoint and mobile drawer widths are identical. The logout button is 44px high, inset 20px horizontally and 20px above the viewport bottom plus mobile safe-area spacing. The footer is anchored outside the scrolling navigation; different module lengths and long account names cannot move it. React DOM regression checks mount client, agent, mechanic and manager/admin modules and compare the shared positioning styles.

## Verification

Run `npm run lint`, `npm test`, and `npm --prefix frontend run build`. Backend regression tests run on SQLite and embedded PostgreSQL with production database/email configuration disabled. Added checks cover cancellation fee/refund accounting, immediate rebooking, private document access, PSGC hierarchy validation, matching desktop/mobile snapshots, scheduled maintenance and the 1,500 → 2,500 km return calculation. Hosted Supabase configuration and production uploads require a separate deployed-environment check.
