# Task ID 6 — backend-analytics-api

## Task
Backend API routes for Dashboard, multi-section Analytics, and two CSV exports (wallets list, wallet history). Plus shared date-filter helper.

## Files Created

1. `src/lib/date-filter.ts`
   - `resolvePeriod(filter, from?, to?)` returning `{ start, end }` with Africa/Casablanca local-date semantics (uses `Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' })` to derive local Y/M/D, then constructs midnight-UTC Date — matches the `parseLocalDate` convention used by tasks 3-5).
   - `WeekStart(date)` / `WeekEnd(date)` — Monday-based week helpers; Monday=0 (offset from JS getUTCDay where Sunday=0). WeekEnd is Sunday 23:59:59.999 UTC.
   - For 'this_month' / 'this_year' / 'custom' / 'today', `end` is end-of-day (23:59:59.999 UTC) inclusive. For 'all_time', start=epoch, end=now.
   - Helper `ymKey(date)` ("YYYY-MM") and `ymdKey(date)` ("YYYY-MM-DD") for chart bucketing.

2. `src/app/api/dashboard/route.ts`
   - `GET` (auth). Query: `filter` (default 'this_month'), `from`, `to` (for custom).
   - Returns full dashboard object: `period`, `cards`, `charts`, `widgets`.
   - Cards: `totalWalletBalance` (all wallets), `income`/`expenses`/`netCashFlow`/`savingsRate`, `bankBalance`/`cashBalance`/`savingsBalance` (subtotal per type — matches /api/wallets behavior, includes all wallets since the money still exists when archived), `outstandingBankDebt`, `outstandingLent`, `goalsProgress` (avg progress of current-year goals).
   - Charts: 12-month income-vs-expenses ending at period-end month; daily income/expense/net-cash-flow (cumulative) trend (capped at 400 days); expense-by-category & income-by-category aggregations (excludes archived categories); wallet distribution (active wallets only); goals completion (count per status, current year).
   - Widgets: recentTransactions (last 8 income+expense), topExpenseCategories (top 5), recentTransfers (last 5), upcomingInstallments (next 5 due), budgetUsage (empty — no budget schema), alerts (low/negative balance, overdue installments, overdue loan repayments), goalsNearCompletion (75 ≤ progress < 100, current year), currentWalletBalances (active wallets only).

3. `src/app/api/analytics/route.ts`
   - `GET` (auth). Query: `filter`, `from`, `to`, optional `section` (comma-separated list — invalid sections dropped; if none valid, returns all 10 sections).
   - 10 sections: `income`, `expenses`, `wallets`, `cash_withdrawals`, `transfers`, `net_cash_flow`, `allocations`, `bank_credits`, `personal_loans`, `goals`. Each computed by a dedicated `*Section` function so they can be selectively computed.
   - `income`/`expenses`: `total`, `byCategory` (excludes archived), `byArticle` (excludes inactive articles), `byWallet`, `monthly` (12 months ending at period-end), `average` (per month), `largest` (single transaction), `sourceConcentration` (income) / `savingsRate` + `budgetComparison` (expenses).
   - `wallets`: `currentByWallet`, `bankVsCash` (subtotals by type, all wallets), `historicalEvolution` (Σ `getWalletBalanceAt` across wallets, for 12 month-ends), `inflows`/`outflows` per wallet (income / expense + withdrawal_external buckets — EXCLUDES transfer_in/transfer_out/withdrawal_internal/adjustment to avoid double-counting), `transfers` (count + total halved since each transfer creates 2 ledger entries), `withdrawals` (external vs internal, halved for internal), `adjustments` (count + absolute total).
   - `cash_withdrawals`, `transfers`, `net_cash_flow`: standard aggregations.
   - `allocations`: referenceIncome, totals, utilization, byClassification.
   - `bank_credits`: originalDebt, totalRepaid, outstanding, progressPct, upcomingInstallments, byCredit (full per-credit summary via `computeCreditSummary`).
   - `personal_loans`: totals, progressByBorrower (sorted by outstanding desc).
   - `goals`: progressByYear, completionRate, budgetProgress, categoryComparison.

4. `src/app/api/wallets/export/route.ts`
   - `GET` (auth). Returns CSV with header `Name,Type,InitialBalance,CurrentBalance,Active,Description` and one row per wallet. `CurrentBalance` via `getWalletBalance`. Formula-injection guards. Audits the export count. Returns `new NextResponse(csv, { headers })` directly.

5. `src/app/api/wallets/[id]/history/export/route.ts`
   - Next.js 16 dynamic route with `params: Promise<{ id: string }>`. `GET` (auth). 404 if wallet doesn't belong to user.
   - Supports same `from`/`to`/`search` filters as `/api/wallets/[id]/history` (date range parsed via `parseLocalDate`, end-of-day inclusive on `to`).
   - Returns CSV with header `Date,OperationType,Direction,Amount,Comment` and one row per ledger entry (ordered by financialDate asc, createdAt asc). Formula-injection guards. Filename sanitized: `wallet-<safe-name>-history.csv`.

## Aggregation Rules Honored
- Internal transfers (`transfer_in`/`transfer_out`) and internal withdrawals (`withdrawal_internal`) NEVER count as income/expense. They're bucketed separately under `transfers`/`withdrawals.internal` in the wallets analytics section.
- External withdrawals (`withdrawal_external`) reported in a separate section, NOT in income/expense totals.
- Historical balances reconstructed via `getWalletBalanceAt(walletId, date)`.
- Archived categories excluded from by-category charts; archived wallet test verified (archived Salary category disappears from incomeByCategory, then reappears when restored).
- Inactive wallets excluded from default charts (`walletDistribution`, `currentWalletBalances`) but kept in raw totals (`totalWalletBalance`, `bankVsCash`) and CSV exports — matches /api/wallets behavior.

## Smoke Test Summary
End-to-end curl test (fresh DB, test user setup):
- Created 3 wallets (bank 5000 / cash 1000 / savings 10000), 2 categories (Salary income / Groceries expense), 1 income (25000 to bank), 1 expense (500 from bank), 1 transfer (800 bank→cash), 1 external withdrawal (200 from cash), 1 bank credit (120000/12mo), 1 personal loan (Alice 5000), 1 goal (year=2026, 80% progress), 1 allocation (5000/mo).
- Dashboard `this_month`: totalWalletBalance=40300, income=25000, expenses=500, savingsRate=98%, outstandingBankDebt=120000, outstandingLent=5000, goalsProgress=80. ✓
- Dashboard widgets: alerts (1 error: 9 overdue installments), goalsNearCompletion (1), upcomingInstallments (3: Oct/Nov/Dec 2026). ✓
- Analytics `section=income`: total=25000, byCategory=[Salary 25000], sourceConcentration=100%. ✓
- Analytics `section=wallets`: historicalEvolution correct (16000 for past months → 40300 in October), inflows/outflows/transfers/withdrawals correctly separated. ✓
- Analytics `section=bank_credits`: 3 upcoming installments, byCredit summary correct (expectedEndDate 2027-01-15). ✓
- Analytics `section=personal_loans` / `goals` / `allocations` / `cash_withdrawals` / `transfers` / `net_cash_flow`: all numbers verified. ✓
- Wallets CSV export: 3 rows with correct balances. ✓
- Wallet history CSV export: ledger entries in date asc order, negative amounts prefixed with `'` for formula-injection safety, comment field with `=CMD|...` correctly double-quoted AND prefixed with `'`. ✓
- All filters tested: `today` (1 trend bucket), `this_week` (Mon-Sun range), `this_month`, `this_year`, `all_time` (epoch → now), `custom` (Jan-Sep 2026 correctly excludes October data).
- Archived wallet test: archiving Cash wallet removed it from `walletDistribution` + `currentWalletBalances`, but kept it in `totalWalletBalance` (40300) and `bankVsCash`/`cashBalance` (1600) — matches the "default charts exclude inactive wallets, raw totals/include-all behavior matches /api/wallets" rule.

## Lint & DB Reset
- `bun run lint` passes cleanly with zero errors.
- After testing, dev DB reset via `bun run db:push --force-reset --skip-generate` so downstream agents start clean.

## Constraints Honored
- No tests written (per instructions).
- No Prisma schema changes (per instructions).
- No changes to `src/app/page.tsx`.
- Only relative API paths used.
- All Decimal-bearing Prisma results pass through `serialize()` before `ok()`.
- Dynamic routes use `params: Promise<{ id: string }>` per Next.js 16 conventions.
- `withAuth({ req, userId })` pattern followed.
- Existing libs reused: `db`, `getSession`/auth, `withAuth`/`ok`/`fail`/`serialize`, `toCents`/`fromCents`/`addMoney`/`subMoney`/`pct`/`parseLocalDate`, `getWalletBalance`/`getWalletBalanceAt`, `computeCreditSummary`/`computeLoanSummary`/`computeAllocationProgress`, `audit`.

Ready for downstream frontend agents to wire these endpoints into the dashboard & analytics SPA views.
