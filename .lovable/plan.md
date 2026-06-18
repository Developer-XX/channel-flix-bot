# Phased Hardening Plan

Tackling all 15 requested items in 3 phases. Each phase is one turn; I'll pause for your "go" between phases so you can review.

---

## Phase 1 — Reliability & user-facing error UX (ship first)

Goal: no more blank screens, no more stale-client hangs, clear status when something breaks.

1. **`/api/public/health` server route**
   - Returns `{ status, buildId, serverFnIds: string[], timestamp, commit? }`.
   - `buildId` derived from a generated `src/build-id.ts` (timestamp at build) so client can compare.
2. **Client `BuildSyncProvider`**
   - On mount + every 60s, fetch `/api/public/health`.
   - If `buildId` differs from the one baked into the client bundle → show a non-blocking toast "New version available — reload", auto hard-reload after 5s.
   - Exposes `useServerStatus()` (green/red dot) for a small header indicator.
3. **Stale-serverFn auto-recovery**
   - Global `fetch` interceptor wrapping `/_serverFn/*` responses.
   - On `500` with body containing `Invalid server function ID` (or 404 on `/_serverFn/`), trigger one automatic hard reload (with a `?_sfreload=1` guard so we don't loop).
4. **In-app error banner + friendly 500 screen**
   - `<ServerFnErrorBoundary>` mounted in `__root.tsx`.
   - Decodes the base64 fn ID from the URL, shows: function name, timestamp, Retry button, link to `/admin/diagnostics`.
   - Replaces the current blank screen for serverFn 500s.
5. **Client error logger**
   - `src/lib/client-error-log.ts` captures serverFn failures (fn name, request ID, timestamp, status) and POSTs to `/api/public/client-errors` (rate-limited, no PII).

---

## Phase 2 — Auth & navigation hardening

Goal: clicking Admin/Premium/Support never bounces to home; if unauthenticated, post-login returns to the exact URL.

1. **Redirect-back after login**
   - `_authenticated/route.tsx` already redirects to `/auth`; add `search: { redirect: location.href }`.
   - `/auth` route reads `redirect` search param, navigates there after successful sign-in (validated to be same-origin path).
2. **Guard decision logging**
   - Server: `requireSupabaseAuth` middleware logs `{ requestId, path, hasToken, userId?, decision }` via the centralized logger (phase 3).
   - Client: `_authenticated` layout logs guard transitions to console in dev only (gated by `import.meta.env.DEV`).
3. **Header & admin-panel link audit**
   - Grep every `<Link to=...>` and `navigate({ to })` targeting `/admin*`, `/premium*`, `/support*`.
   - Replace any string-built hrefs with typed `<Link to="/_authenticated/...">`. Fix any that still point at removed/renamed routes.
4. **Playwright E2E suite** (`tests/e2e/`)
   - `auth-redirect.spec.ts` — unauthenticated click on `/admin` → `/auth?redirect=/admin` → login → lands on `/admin` (not `/`).
   - `admin-routes.spec.ts` — authenticated admin user visits every admin sub-route via header + sidebar; asserts URL stays put and page renders heading.
   - `premium-support.spec.ts` — same for `/premium` and `/support`.
   - Uses the existing `LOVABLE_BROWSER_SUPABASE_*` env vars; one admin user seeded via migration helper.
   - Wired into `package.json` as `test:e2e`.

---

## Phase 3 — Observability, admin tooling, dev-time checks

Goal: when something does break, I see exactly what and why — fast.

1. **Centralized server logger** (`src/lib/server-logger.server.ts`)
   - `logServerFnRequest({ requestId, fnExport, fileRef, userId?, status, durationMs, error? })`.
   - Writes structured JSON to console (picked up by worker logs) and, for 5xx, inserts into a new `admin_error_log` table (admin-only RLS).
2. **`/_serverFn` request middleware**
   - Global `functionMiddleware` that wraps every server fn, generates `requestId` (ulid), times it, catches throws, logs via above, re-throws.
   - Captures the full stack (not just message) for 500s.
3. **Admin Health Check page** (`/admin/health`)
   - Lists every registered server fn export with last-known status (last 24h) from `admin_error_log`.
   - Live probes a small set of critical fns (`getAdminGate`, `getPremiumPlan`, `getTutorialConfig`) and shows ✓/✗.
   - Shows current `buildId`, deployed worker version, DB connectivity, secret presence (names only).
4. **Admin error log viewer** (`/admin/error-log`)
   - Paginated table of recent serverFn failures with requestId, fnExport, userId, stack.
5. **Manifest-sync dev check**
   - Vite plugin (`vite/plugin-serverfn-manifest.ts`) emits `src/.serverfn-manifest.json` on every build with all serverFn IDs.
   - Dev-only: client compares its baked-in manifest against `/api/public/health.serverFnIds` on boot; mismatch → warning in console + dev toast.
6. **Playwright tests for admin-gating**
   - `admin-gate.spec.ts` — non-admin authenticated user → `/admin` redirects to `/unauthorized` (not home); admin user gets through.
   - `serverfn-mismatch.spec.ts` — simulates stale ID, asserts auto-reload kicks in.

---

## Technical notes (for reference)

- **buildId source**: `vite.config.ts` defines `__BUILD_ID__` via `define`; both client and `/health` read the same constant.
- **requestId**: ulid (sortable, no extra dep — 30-line impl in `server-logger.server.ts`).
- **`admin_error_log` table**:
  ```sql
  CREATE TABLE public.admin_error_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id text NOT NULL,
    fn_export text,
    fn_file text,
    user_id uuid,
    status int,
    error_message text,
    error_stack text,
    duration_ms int,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  -- GRANT + RLS: admin role only via has_role
  ```
- **No new external deps** except `@playwright/test` (dev).
- **Phase 1 ships even if Phases 2–3 stall** — each phase is self-contained.

---

Reply **"go phase 1"** (or "go all") and I'll start. You can also tell me to drop/add items per phase before I begin.