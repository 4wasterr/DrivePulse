# DrivePulse deployment

Prepared 23 October 2026 (Asia/Manila).

Local development is ready without Supabase. The cloud database connection and deployment have not been verified against your account. Complete the steps below when Supabase is available.

## Work locally now

Use Node.js 24.x. In Windows PowerShell, use `npm.cmd` when script execution is disabled.

```powershell
npm.cmd run setup
npm.cmd run dev
```

Open http://127.0.0.1:5173. The API runs at http://127.0.0.1:5000; Vite forwards `/api` to it. Demo accounts are listed in the README. Staff registration is disabled by the supplied environment file; existing demo staff can sign in. Data persists in `backend/data/drivepulse.sqlite`. Keep that file if you want to preserve your development records.

```powershell
npm.cmd run check
npm.cmd run package:deploy
```

`check` runs frontend lint, frontend tests, the complete rental workflow suite on SQLite and an embedded PostgreSQL engine, persistence checks, and the Vite build. The archive is `artifacts/drivepulse-source.tar.gz`; it contains source, lockfiles, and configuration examples. It excludes credentials, certificates, local databases, dependency folders, build output, and Git metadata.

## Connect Supabase later

1. In Supabase, choose **Connect → Transaction pooler** and copy the exact PostgreSQL URL. Replace the password placeholder and percent-encode reserved characters in the password. The serverless connection uses port 6543. See [Supabase's connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres).
2. Back up an existing database before migration. Create a separate production database/project if the existing one contains demo rental data.
3. Use `backend/.env.production.example` as the reference. To run management commands locally, place the production connection variables in your ignored `backend/.env`, or supply them through your shell environment. Use `NODE_ENV=production`, `ALLOW_AGENT_SIGNUP=false`, `DATABASE_URL`, and your public HTTPS `FRONTEND_ORIGIN`. Do not commit this file.
4. TLS certificate verification is enabled. If the connection needs Supabase's CA certificate, set `DATABASE_CA_PATH` to the downloaded PEM file for local management commands. In Vercel, put its contents in `DATABASE_CA_CERT`; escaped `\n` newlines are accepted. Do not disable TLS verification.
5. Run the migration and provision the first manager:

   ```powershell
   npm.cmd run db:migrate
   npm.cmd run db:manager
   npm.cmd run preflight -- --connect
   ```

The manager command prompts for a name, email, and a hidden password of 12–128 characters. It refuses to replace an existing account or add a second bootstrap manager. No manager password is shipped in source. Automation may supply `BOOTSTRAP_MANAGER_NAME`, `BOOTSTRAP_MANAGER_EMAIL`, and `BOOTSTRAP_MANAGER_PASSWORD` to this command; remove them afterward and do not store them in Vercel.

The migration is transactional and repeatable. It preserves records from the earlier checked-in Supabase scaffold while converting payloads/timestamps to the types used by the API. The executable migration is `backend/schema.js`; `backend/supabase-schema.sql` is the equivalent SQL for the Supabase SQL editor. This path uses PostgreSQL directly through the backend. It does not use Supabase Auth or expose the database through browser API keys. Row Level Security is enabled and `anon`/`authenticated` table access is revoked; the backend connection must use the database owner role from the supplied connection URL. Private uploads remain in the database, so include them in backup and capacity planning.

The migration has been exercised against embedded PostgreSQL. Run it first in your Supabase staging database and verify the result before changing an existing production database.

## Configure Vercel

The existing Git repository has a parent directory above DrivePulse and includes tracked dependency files. For a new Git deployment, use the clean source archive in a separate DrivePulse repository. The archive excludes the surrounding personal folders. For CLI deployment, run commands from this DrivePulse directory.

Use the supplied `vercel.json` with [Vercel Services](https://vercel.com/docs/services). The backend service root is `backend`; the frontend service root is `frontend`. Node.js is pinned to 24.x. The frontend builds with `npm run build` to `dist`, and the backend entrypoint is `index.js`. Leave project-level build overrides unset so each service's configuration applies. `/api` and `/api/...` go to Express with the original path; all remaining paths go to the frontend.

Set these backend environment variables for **Production**, and separately for any **Preview** environment that should work:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `ALLOW_AGENT_SIGNUP` | `false` |
| `DATABASE_URL` | The appropriate Supabase transaction pooler URL |
| `FRONTEND_ORIGIN` | Additional custom HTTPS origins, comma-separated, without trailing slashes |
| `DATABASE_CA_CERT` | Supabase CA certificate if required by its TLS chain |

Enable Vercel system environment variables. The API recognizes the exact deployment and branch URLs; the production environment also recognizes the primary production domain. Use a separate database for preview deployments. Do not add database URLs, passwords, service-role keys, or private bindings to `VITE_` variables. There are no internal service bindings to configure.

If deploying the current parent repository, set Root Directory to `Documents/DrivePulse`. If deploying the clean standalone repository, leave Root Directory at `.`. No Vercel login, project link, or public deployment has been created by this preparation.

With Vercel CLI available, from the project root:

```powershell
npx.cmd vercel
```

Check the preview first, then publish production with `npx.cmd vercel --prod` when the database and environment are ready.

### Fix `vite: command not found` during a Vercel build

The root package has no frontend dependencies. Installing only at the repository root does not install Vite from `frontend/package.json`. The root `npm run build` now runs `npm --prefix frontend ci --include=dev` automatically before building, so a clean checkout includes Vite even when `NODE_ENV=production` is set. The frontend service in `vercel.json` also explicitly installs its development dependencies.

Push the updated root `package.json`, `vercel.json`, and both services' package manifests and lockfiles to the repository connected to Vercel. In Vercel's project settings:

1. Set Root Directory to the folder containing `vercel.json`: `.` for a standalone DrivePulse repository, or `Documents/DrivePulse` for the existing parent repository.
2. Set Node.js to 24.x and clear project-level Install Command, Build Command, Output Directory, and Framework Preset overrides so the service configuration applies.
3. Deploy the new commit. Redeploying an older failed commit will still use its old files. If using Redeploy on the new commit, disable the existing build cache for this attempt.

The supplied services configuration installs frontend dependencies with `npm ci --include=dev`, builds inside `frontend` with `npm run build`, and outputs `dist`. The backend installs separately inside `backend`. Do not change Root Directory to `frontend` for this full-stack deployment, because that skips the root configuration and backend service.

The `engines.node >=24` and npm `cache-dir` messages in the failed build are warnings. The supplied manifests pin Node.js to `24.x`; the missing frontend dependency is what causes exit code 127.

## Check a deployment

- `/` loads the app and its images and styles.
- `/api/health` returns `200` with `{ "ok": true }` after a database query.
- `/api/session` reports `demo: false` and `staffSignup: false`.
- Sign in with the manager account and create booking-agent and mechanic accounts through User Management.
- Create a client, upload distinct test IDs, and complete a booking. Uploads are limited to 4 MB to stay below [Vercel's function payload limit](https://vercel.com/docs/functions/limitations).
- Confirm unauthenticated document requests fail and a new deployment still shows the same account, reservation, and files.
- Confirm the manager can view audit records and the mechanics cannot view client identity files.

If the API returns 503, check database configuration, migration, and TLS settings in the backend service. If writes return 403, compare the browser origin with the exact allowed origins. The production API never falls back to volatile storage.
