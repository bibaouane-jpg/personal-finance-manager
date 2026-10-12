# Task 3 — Backend Wallets API

Agent: **backend-wallets-api**
Task ID: **3**

## What was built

14 API route files under `src/app/api/`, plus a critical fix to `src/lib/api.ts` so cookies work in Next.js 16 route handlers.

### Auth
- `auth/status/route.ts` — `GET { setupComplete }` (public)
- `auth/setup/route.ts` — `POST` first-run admin creation (validates name/email/password≥10, ensures AppSettings singleton, hashes password, creates session, sets cookie, audits)
- `auth/login/route.ts` — `POST` validates credentials, returns `{ user, settings }` (404 if no user, 401 on bad creds)
- `auth/logout/route.ts` — `POST` destroys session + clears cookie
- `auth/me/route.ts` — `GET` current user + settings
- `auth/password/route.ts` — `PUT` change password (verifies current, audits)

### Settings
- `settings/route.ts` — `GET` (upserts defaults) and `PUT` (Zod-validated update of appName/appNameFr/defaultLanguage/defaultCurrency/defaultTimezone/referenceMonthlyIncome/allocationUnitValue/allowOverdraft)
- `settings/branding-restore/route.ts` — `PATCH` resets app names to defaults

### Wallets
- `wallets/route.ts` — `GET` (lists wallets with computed balance + combined/bank/cash/savings/other subtotals) and `POST` (create, type ∈ bank|cash|savings|other)
- `wallets/[id]/route.ts` — `GET` (one wallet + recent 10 ledger entries), `PUT` (update metadata only, never initialBalance), `DELETE` (refuses 400 if any ledger entries exist)
- `wallets/[id]/history/route.ts` — paginated `GET` with `from`/`to`/`search`/`page`/`pageSize`

### Ledger mutations (all use `$transaction` + `appendLedgerEntry(tx, ...)`)
- `transfers/route.ts` — atomic source-debit / dest-credit (validates source≠dest, amount>0, active wallets, sufficient funds)
- `withdrawals/route.ts` — external (debit only) or internal (debit source + credit dest)
- `adjustments/route.ts` — accepts `actualBalance` (computes signed adjustment vs systemBalance) or explicit `adjustment`; reason required (≥3 chars)

## Critical fix to `src/lib/api.ts`

The Task 1 `withAuth` constructed `new NextRequest(req)` to read cookies — this throws `Cannot read private member #state from an object whose class did not declare it` in Next.js 16. Replaced with `await getSession()` (no args), which falls through to `next/headers` `cookies()` — the canonical Next.js 16 pattern. Same fix applied to the logout route.

## Verification
- `bun run lint` — zero errors.
- Full end-to-end curl smoke test: setup → me → settings → wallet create (bank 5000 + cash 500) → transfer 1000 bank→cash (4000/1500, combined unchanged 5500) → external withdrawal 200 (cash 1300) → adjustment actualBalance=4050 (bank +50 → 4050) → history pagination → DELETE-with-entries returns 400 → branding restore → password change → logout. All correct.
- Dev DB was reset (`prisma db push --force-reset`) so downstream agents start fresh.
