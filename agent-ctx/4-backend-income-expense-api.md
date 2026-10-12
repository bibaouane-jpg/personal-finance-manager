# Task 4 — Backend Income/Expense API

Agent: **backend-income-expense-api**
Task ID: **4**

## What was built

10 API route files under `src/app/api/{categories,articles,income,expenses}/` implementing the full CRUD + CSV export for categories, articles, income and expense transactions. All financial mutations go through `db.$transaction` + `appendLedgerEntry(tx, ...)` and audit accordingly.

### Categories
- `categories/route.ts` — `GET` (list with `type`/`archived`/`search` filters, defaults to non-archived only) and `POST` (Zod-validated create; enforces unique `(name,type)` per user, 409 on dup).
- `categories/[id]/route.ts` — `GET` / `PUT` (name/type/color/description/archived; re-checks uniqueness) / `DELETE` (409 `'This category is referenced by historical transactions. Archive it instead?'` if any IncomeTransaction / ExpenseTransaction / Article.defaultCategoryId references the id; otherwise hard-delete).

### Articles
- `articles/route.ts` — `GET` (list with `type`/`active`(default true)/`search`; includes `defaultCategory`) and `POST` (Zod-validated; verifies `defaultCategoryId` belongs to user and type matches; unique `(name,type)` per user).
- `articles/[id]/route.ts` — `GET` / `PUT` (same fields; re-validates default category; re-checks uniqueness) / `DELETE` (409 `'Cannot delete an article referenced by transactions. Deactivate it instead.'` if referenced by any income/expense; otherwise hard-delete).

### Income transactions
- `income/route.ts` — `GET` with filters `from`/`to` (parsed via `parseLocalDate`, end-of-day inclusive), `walletId`/`categoryId`/`articleId`, `search`, `page`/`pageSize` (max 100), `sort` (date_desc default; date_asc, amount_desc, amount_asc). Returns `{ items, total, page, pageSize }` with `category`/`article`/`wallet` relations. `POST`: Zod-validated `{name, categoryId?, articleId?, amount>0, walletId, financialDate, comment?}`. Inside `$transaction`: load wallet (must be active), article fallback for category (`article.defaultCategoryId` if `categoryId` missing), validate category is income type, create row, append a credit ledger entry (`operationType:'income'`, `direction:'credit'`, `referenceType:'income'`, `referenceId: income.id`), update `ledgerEntryId`. Returns `{ income, walletBalance }` (201) with audit.
- `income/[id]/route.ts` — `GET` (with relations); `PUT` (optional fields, ledger reconciliation):
  - **walletChanged**: append a debit of the OLD full amount to the old wallet (`operationType:'adjustment'`, `direction:'debit'`) and a credit of the NEW full amount to the new wallet (`operationType:'income'`, `direction:'credit'`).
  - **same wallet, amountChanged**: compute `diffCents = newAmount - oldAmount`; append a single signed ledger entry (`operationType:'adjustment'`, direction = credit if ≥0 else debit).
  - **no change**: just metadata update. Audits with previous/new values. Returns `{ income, walletBalance }`.
  - `DELETE`: inside `$transaction`, append a debit reversal of the original amount (`operationType:'adjustment'`, `direction:'debit'`, `referenceType:'income'`, `referenceId:id`) and hard-delete the row. Ledger entries are kept intact for auditability (no FK constraint from `WalletLedgerEntry.referenceId` to the transaction). Audits. Returns `{ ok: true, walletBalance }`.
- `income/export/route.ts` — `GET` returns CSV (`Content-Type: text/csv`, `Content-Disposition: attachment; filename="income.csv"`). Same filters as the list (no pagination). Headers: `Date, Name, Category, Article, Wallet, Amount, Comment`. Cells starting with `=`, `+`, `-`, `@` are prefixed with a single quote (`'`) to prevent formula injection; values containing commas/quotes/newlines are double-quoted with embedded quotes doubled.

### Expenses
- `expenses/route.ts` — mirrors income but the wallet is the SOURCE wallet. `POST` calls `assertDebitAllowed(tx, walletId, amount)` before creating the row, then appends a debit ledger entry (`operationType:'expense'`, `direction:'debit'`, amount negative). Same filters/pagination/sort.
- `expenses/[id]/route.ts` — `GET`/`PUT`/`DELETE`. PUT reconciliation:
  - **walletChanged**: append a credit of the OLD amount on the old wallet, and (after re-checking funds via `assertDebitAllowed`) a debit of the NEW amount on the new wallet.
  - **same wallet, amountChanged**: `diffCents = oldAmount - newAmount` (positive when expense shrank → credit; negative when expense grew → debit). When the expense increased, `assertDebitAllowed` is called with the increase magnitude to prevent overdraft.
  - `DELETE`: append a credit reversal of the original amount, hard-delete the row.
- `expenses/export/route.ts` — same CSV export pattern, filename `expenses.csv`.

## Key correctness fix: walletBalance returned after the transaction commits

Initial implementation computed `walletBalance` inside the `$transaction` callback via `getWalletBalance(walletId)`, which uses `db` (not `tx`). With Prisma SQLite, `db` reads happen on a *different* connection from the interactive transaction, so the returned `walletBalance` was stale (reflected the state *before* the ledger entry was applied).

Verified the bug with a smoke test: income update 2500→3000 (same wallet) returned `walletBalance: 7200.00` instead of the expected `7700.00`. The ledger entry WAS persisted correctly — only the in-transaction read was stale.

**Fix applied to all 6 ledger-mutating routes (income POST/PUT/DELETE, expense POST/PUT/DELETE)**: do all writes inside `db.$transaction(async (tx) => { ... return { row, walletId } })`, then call `getWalletBalance(walletId)` *after* the transaction resolves so the read sees committed state. The wallet-change path correctly returns the balance of the *new* wallet.

Re-ran the full smoke test after the fix and every balance came back correct.

## Smoke test summary

End-to-end curl test (fresh DB, single user, single bank wallet 5000 + cash wallet 1000):

1. Create income category `Salary`, expense category `Groceries`.
2. Create income article `Monthly Salary` (defaultCategoryId=Salary) and expense article `Weekly Groceries`.
3. POST income 2500 to BANK (with `articleId`, no `categoryId` → category auto-resolved from article.defaultCategoryId). Returned `walletBalance: 7500.00`. ✓
4. POST expense 300 from BANK (article fallback again). Returned `walletBalance: 7200.00`. ✓
5. PUT income amount 2500→3000 (same wallet). Returned `walletBalance: 7700.00`. ✓
6. PUT expense amount 300→800 (same wallet). Returned `walletBalance: 7200.00`. ✓
7. PUT income walletId BANK→CASH. Returned `walletBalance: 4000.00` (CASH). BANK independently read as `4200.00`. ✓
8. DELETE income (3000 from CASH). Returned `{ ok: true, walletBalance: 1000.00 }`. ✓
9. DELETE expense (800 from BANK). Returned `{ ok: true, walletBalance: 5000.00 }`. ✓
10. Final wallet balances: BANK `5000.00`, CASH `1000.00` — back to the original state, all ledger adjustments net to zero. ✓
11. Wallet history confirms 6 ledger entries: initial income +2500, income adjustment +500, income deletion reversal -3000, initial expense -300, expense adjustment -500, expense deletion reversal +800.

Edge cases verified:
- POST expense with `amount=99999` on BANK (overdraft disabled) → 400 `'Insufficient funds in this wallet. Enable overdraft to allow negative balances.'`. ✓
- DELETE category referenced by an IncomeTransaction → 409 `'This category is referenced by historical transactions. Archive it instead?'`. ✓
- DELETE article referenced by an IncomeTransaction → 409 `'Cannot delete an article referenced by transactions. Deactivate it instead.'`. ✓
- PUT category `archived:true`; `GET ?type=expense` (default) excludes it; `GET ?type=expense&archived=true` includes it. ✓
- PUT article `active:false`; `GET ?type=income` (default) excludes it; `GET ?type=income&active=false` includes it. ✓
- GET income `?sort=amount_desc` / `amount_asc` / `?search=bonus` — all work.
- CSV exports return correct `Content-Type: text/csv; charset=utf-8` and `Content-Disposition: attachment; filename="income.csv"` (resp. `expenses.csv`); a row whose name was `=CMD` was escaped to `'=CMD` and a comment `@formula injection test, with commas` was escaped and properly quoted.

## Notes / constraints honored

- `serialize()` applied to every Prisma result returned via `ok()`.
- Dynamic routes use `params: Promise<{ id: string }>` and are awaited (Next.js 16).
- Monetary fields validated as numeric strings via `z.string().refine(v => v !== '' && !isNaN(Number(v)))`; dates via `z.string().min(1)` then `parseLocalDate(value)`.
- All mutating endpoints audit the create/update/delete with previous/new values and a human-readable reason.
- Used only relative API paths; no absolute URLs in fetches (none needed here — these are pure API routes).
- No tests written; no Prisma schema changes; no changes to `src/app/page.tsx`.
- `bun run lint` passes with zero errors.
- Dev DB was reset (`prisma db push --force-reset`) so downstream frontend agents start fresh.

## Files delivered

- `src/app/api/categories/route.ts`
- `src/app/api/categories/[id]/route.ts`
- `src/app/api/articles/route.ts`
- `src/app/api/articles/[id]/route.ts`
- `src/app/api/income/route.ts`
- `src/app/api/income/[id]/route.ts`
- `src/app/api/income/export/route.ts`
- `src/app/api/expenses/route.ts`
- `src/app/api/expenses/[id]/route.ts`
- `src/app/api/expenses/export/route.ts`
