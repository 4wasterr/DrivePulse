# DrivePulse frontend

React 19 and Vite power the public landing page, client portal, role-specific login/sign-up pages, and Booking Agent / Front Desk workspace. The interface uses a black-and-white palette with larger controls and original-color vehicle photos.

## Run the full app

From the repository root, run `npm run dev` to start the API and frontend together. Use Node.js 24 or later. On Windows PowerShell, `npm.cmd` is also supported. The frontend opens at http://127.0.0.1:5173 and proxies `/api` to port 5000.

See [the project README](../README.md) for setup, demo accounts, modules, persistence, and the development boundary. The client and staff workspaces require the backend; a static frontend build alone does not provide authentication or booking data.

## Checks

`npm test` runs client date/pricing/upload-validation tests. `npm run build` creates the production frontend bundle. The backend suite tests authentication, ownership, exact-time booking conflicts, dispatch prerequisites, review invalidation, payments, extensions, cancellation accounting, late fees, and support conversations. Browser visual testing was unavailable in this session.

## Images and fonts

Vehicle photographs are illustrative Unsplash images, downloaded to `public/images` so the site does not need remote image requests at runtime:

- Porsche / hero: https://images.unsplash.com/photo-1503376780353-7e6692767b70
- BMW: https://images.unsplash.com/photo-1555215695-3004980ad54e
- Mercedes-Benz: https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8
- Toyota: https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb
- SUV: https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6
- Tesla: https://images.unsplash.com/photo-1560958089-b8a1929cea89

Manrope and DM Sans load from Google Fonts, with local sans-serif fallbacks when unavailable.
