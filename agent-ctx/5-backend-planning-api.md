# Task 5 — backend-planning-api

## Scope
Backend API routes for Allocations, Bank Credits (+ installments + repayments),
Personal Loans (+ operations), Goal Categories, Goals (CRUD + filters + summary),
and Goals CSV export.

## Deliverables

### Route files (13)
- `src/app/api/allocations/route.ts` — GET (list + summary), POST (create).
- `src/app/api/allocations/[id]/route.ts` — GET, PUT (recompute progress if credit-linked), DELETE.
- `src/app/api/bank-credits/route.ts` — GET (list with summary), POST (create + auto-generate installment schedule).
- `src/app/api/bank-credits/[id]/route.ts` — GET, PUT (regenerate schedule on duration/start/installment change), DELETE (refuse if has repayments).
- `src/app/api/bank-credits/[id]/repayments/route.ts` — GET, POST (record + auto-mark earliest pending installments as 'paid').
- `src/app/api/personal-loans/route.ts` — GET (list with summary), POST (create + initial disbursement operation).
- `src/app/api/personal-loans/[id]/route.ts` — GET, PUT, DELETE (refuse if has ops beyond initial disbursement).
- `src/app/api/personal-loans/[id]/operations/route.ts` — GET, POST (validate outstanding for repayments, require comment for corrections).
- `src/app/api/goal-categories/route.ts` — GET, POST.
- `src/app/api/goal-categories/[id]/route.ts` — GET, PUT, DELETE (refuse if referenced by goals).
- `src/app/api/goals/route.ts` — GET (filters + pagination + summary), POST (force progress=100 when status=completed).
- `src/app/api/goals/[id]/route.ts` — GET, PUT (force progress=100 on transition to completed), DELETE.
- `src/app/api/goals/export/route.ts` — GET CSV with formula-injection escaping.

### Shared helper module
- `src/lib/credit-summary.ts` — `computeAllocationProgress`, `computeCreditSummary`, `computeLoanSummary`.

## Patterns reused from earlier tasks
- `withAuth({ req, userId })`, `ok`/`fail`/`zodError`/`serialize`.
- `audit({ userId, entityType, entityId, operation, previousValues, newValues, reason })`.
- `parseLocalDate`, `toCents`, `fromCents`, `subMoney`, `isPositiveMoney`, `pct`, `addMoney`.
- `params: Promise<{ id: string }>` for dynamic routes.
- All Decimal-bearing Prisma results pass through `serialize()` before `ok()`.

## Smoke test (curl, fresh DB)
- Bank credit create (12-month schedule auto-gen) → 12 installments with correct dueDates.
- Repayment 10500 → installment #1 marked paid, summary correct (progressPct=9, paidInstallments=1, remaining=11).
- Allocation linked to credit → progress derived from repayments (9%).
- Manual allocation → stored progress preserved.
- Allocation summary: referenceIncome/unitValue from AppSettings, utilization/unallocated/available all correct.
- Personal loan create → initial disbursement op auto-created; summary totalLent=5000.
- Loan repayment 1500 → outstanding=3500, progressPct=30.
- Loan repayment > outstanding → 400 `'Repayment exceeds the outstanding amount.'`.
- Loan correction without comment → 400.
- Loan DELETE with operations beyond initial → 409.
- Goal create (requiredBudget=10000, savedBudget=4000) → remainingBudget=6000.
- Goal create with status='completed' → progress forced to 100.
- Goal PUT transitioning to completed → progress forced to 100.
- Goals list summary aggregates totals + per-category breakdown; 'uncategorized' bucket included.
- Goals CSV export: correct headers, formula-injection escape, targetDate formatted as YYYY-MM-DD.
- Goal category DELETE with goals → 409.
- Bank credit DELETE with repayments → 409.
- Bank credit PUT durationMonths 12→6 → schedule regenerated (6 installments, paid installment #1 preserved).

## Lint
`bun run lint` passes cleanly with zero errors.

## DB reset
Dev DB was reset with `prisma db push --force-reset --skip-generate` after testing so downstream agents start clean.
