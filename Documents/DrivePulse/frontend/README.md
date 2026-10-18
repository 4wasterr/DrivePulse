# DrivePulse client portal

A responsive React rental website with a landing page, a black-and-white palette, grayscale vehicle photography, larger typography and controls, and accessible native dialogs. A custom road-inspired D mark is shared by the header, portal sidebar, and SVG favicon. Only the client experience is implemented; no staff or administrator interface is included.

## Run locally

```sh
cd frontend
npm install
npm run dev
```

Open the local URL printed by Vite, normally http://localhost:5173. On Windows PowerShell with script execution disabled, use `npm.cmd` in place of `npm`. The existing Express starter in `../backend` is independent and is not required for this client preview.

## Included flows

- The root URL and `#home` open the landing page first, with a responsive header, vehicle search, featured fleet, booking steps, and footer. `#overview` opens the client portal; the portal brand links back home.
- Overview dashboard with a featured vehicle, trip search, recommended rides, and upcoming booking.
- Six-vehicle catalog with categories, search, price sorting, capacity, transmission, daily budget, and date-based availability filters.
- Saved rides and an editable local client profile.
- Guided reservation: pick-up/drop-off locations and date/time, required documents, and payment choice.
- Driver’s license and two different government IDs; PDF, JPG, PNG, and WebP up to 5 MB each. Duplicate file content is detected at the booking step.
- Rental quotation per started 24-hour period, plus a PHP 5,000 refundable security deposit.
- Clearly simulated checkout or payment-proof upload with awaiting-verification status.
- Booking tracker: Pending Approval → Ready for Dispatch → On Rental → Completed. Client users cannot change the stage.
- Printable HTML draft agreements and receipts; open a download and use Print → Save as PDF.
- Notifications, document downloads, billing history, mobile navigation, focus containment, and reduced-motion support.

## Preview data and integration boundary

Reservations, profile details, favorites, and document metadata are persisted in browser localStorage. Uploaded files are persisted as Blobs in IndexedDB; they are not sent to a server. Two clearly labeled sample bookings illustrate the experience. The three uploaded requirements must be distinct files, but no real identity verification is performed.

Availability reflects bookings in this browser and synchronizes changes between tabs. It is not a shared or transactionally locked fleet inventory. New requests remain Pending Approval; staff review and status transitions require a future backend integration. Checkout never collects card details or real money. Payment-proof uploads are retained for demonstration and are not actually verified.

There is no existing authentication or user/role implementation in this checkout. Before production, connect the portal to your authenticated user system, server-validated inventory and prices, durable reservations, protected uploads, staff review, and payment provider. Downloaded agreements are demo drafts, not signed contracts. Clearing browser site data removes local records and documents.

## Checks

```sh
npm test
npm run build
```

The tests cover Philippine-time rental periods, started-day pricing, date validation, overlap/handover availability, and file size/type restrictions. The monochrome refresh also passed production build and server-rendering checks for the landing page and all portal routes. Visual browser QA was unavailable because the session did not expose a browser.

## Images and fonts

Vehicle photographs are illustrative Unsplash images, downloaded to `public/images` so the site does not need remote image requests at runtime:

- Porsche / hero: https://images.unsplash.com/photo-1503376780353-7e6692767b70
- BMW: https://images.unsplash.com/photo-1555215695-3004980ad54e
- Mercedes-Benz: https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8
- Toyota: https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb
- SUV: https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6
- Tesla: https://images.unsplash.com/photo-1560958089-b8a1929cea89

Manrope and DM Sans load from Google Fonts, with local sans-serif fallbacks when unavailable.
