# DrivePulse frontend

React 19 and Vite power the public landing page, client portal, common sign-in/registration pages, and separate Booking Agent / Front Desk, Fleet Mechanic, and Operations Manager workspaces. The interface uses a black-and-white palette with larger controls and original-color vehicle photos.

## Run the full app

From the repository root, run `npm run dev` to start the API and frontend together. Use Node.js 24 or later. On Windows PowerShell, `npm.cmd` is also supported. The frontend opens at http://127.0.0.1:5173 and proxies `/api` to port 5000.

See [the project README](../README.md) for setup, demo accounts, modules, persistence, and the development boundary. The client and staff workspaces require the backend; a static frontend build alone does not provide authentication or booking data.

## Source organization

`src/main.jsx` loads the shared styles and mounts `src/App.jsx`. `App.jsx` owns session loading, authentication gates, and hash-based routing into the page modules. The existing category folder names are preserved.

| Folder under `src/` | Responsibility |
| --- | --- |
| `pages/Public/` | Public landing page and its CSS. |
| `pages/Authentication/` | Shared login/sign-up screen for every role and authentication CSS. |
| `pages/Client Portal/` | Client portal, overview, fleet/saved rides, bookings, documents, payments, and client CSS. Its `components/` contains client booking and support dialogs. |
| `pages/Booking Agent/` | Agent portal, overview, reservations, availability calendar, verification/payment/dispatch review queues, support, and agent CSS. Its `components/` contains reservation tables, walk-in entry, and booking details. |
| `pages/Fleet Mechanic/` | Mechanic portal, overview, inspections, maintenance, mechanic forms, and mechanic CSS. |
| `pages/Operations Manager/` | Manager portal, deployment overview, financial approvals, analytics, driver risks, audit log, manager forms, and manager CSS. |
| `components/ui/` | Reusable brand mark, icons, modal, and file-upload controls. |
| `components/fleet/` | Vehicle cards shared by public browsing and the client portal. |
| `components/operations/` | Fleet views, inspection/maintenance history, agreements, handover records, financial requests, and other components used by multiple roles. |
| `components/support/` | Conversation UI and CSS shared by clients and agents. |
| `components/workspace/` | Shared workspace tags and empty states. |
| `layouts/` | Mechanic/manager workspace navigation and page layout, with layout CSS. |
| `styles/` | Global reset, shared dialog/form/theme styles, shared workspace styles, and responsive rules used across modules. |
| `utils/` | Shared vehicle lookup, workspace formatting, and CSV export helpers. |

Add each page and its module-specific components/styles to the appropriate category. Move a component to the shared `components/` folders when more than one module needs it; shared components should not import from `pages/`. The fleet browser serves both `#fleet` and `#saved`, and the agent review queue serves verification, billing, and dispatch so those screens keep their common behavior.

All CSS is loaded once through `src/styles/index.css`. Its import order preserves the existing cascade, including responsive overrides; add new module styles there instead of importing the same sheets from several page components. The small `layouts/staff-footer.css` file keeps the shared footer at its original point in that cascade. The existing `api.js`, `data.js`, `storage.js`, and `dispatchPass.js` remain shared JavaScript services at the source root.

## Sign-in flow

The landing page has public fleet information and generic sign-in/registration links, with no personalized portal links or role-selection controls. `#login` submits only email and password; the backend returns the account's stored role, and `App.jsx` opens its workspace. Public registration creates client accounts. Existing role-prefixed authentication links use the same generic form. Development demo accounts are preserved, with credentials available in an expandable section on the sign-in page.

## Checks

`npm test` runs client date/pricing/upload-validation tests. `npm run build` creates the production frontend bundle. The backend suite tests authentication, ownership, exact-time booking conflicts, dispatch prerequisites, review invalidation, payments, extensions, cancellation accounting, late fees, support conversations, photo-backed mechanic inspections, vehicle holds, maintenance transitions, financial approvals, risk overrides, fleet analytics, vehicle compliance records, issued agreement revisions, handover receipts, cash collections and disbursements, measured downtime/turnaround, and centralized audit permissions. A browser was not available for visual acceptance testing in this session.

The page-organization refactor passed `npm run lint`, all five frontend tests, and the production build. A temporary comparison against the original source checked 33 server-rendered pages across public/client, agent, mechanic, manager, and authentication flows; the rendered output matched, and the compiled production CSS was byte-for-byte identical. Interactive browser flows were not exercised by that comparison.

## Images and fonts

Vehicle photographs are illustrative Unsplash images, downloaded to `public/images` so the site does not need remote image requests at runtime:

- Porsche / hero: https://images.unsplash.com/photo-1503376780353-7e6692767b70
- BMW: https://images.unsplash.com/photo-1555215695-3004980ad54e
- Mercedes-Benz: https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8
- Toyota: https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb
- SUV: https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6
- Tesla: https://images.unsplash.com/photo-1560958089-b8a1929cea89

Manrope and DM Sans load from Google Fonts, with local sans-serif fallbacks when unavailable.
