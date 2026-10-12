# Task 11b — bank-credits-view agent

## Task
Implement `src/components/views/bank-credits-view.tsx` (replace the 1-line stub)
as a polished Bank Credits page with credit-card-style visuals, installment
schedule, repayment dialog, and full CRUD against the existing
`/api/bank-credits*` backend routes.

## What previous agents built (used as input)
- `src/lib/use-i18n.ts` → `{ locale, t, money, num, date, dateTime }`
- `src/lib/use-api.ts` → `{ get, post, put, del }` (auto toast errors, throws on non-2xx)
- `src/lib/money.ts` → `toCents`, `fromCents`, `toLocalDateString`, …
- `src/components/shared.tsx` → `StatCard`, `EmptyState`, `MoneyText`, `PageHeader`
- `src/components/confirm-dialog.tsx` → `ConfirmDialog`
- shadcn/ui in `src/components/ui/` (Card, Button, Input, Label, Select, Dialog,
  Badge, Skeleton, ScrollArea, Textarea, DropdownMenu, Progress).
- i18n keys `credit.*`, `common.*`, `goal.status.*` already present in
  `src/lib/i18n.ts` (EN + FR).
- Backend endpoints `/api/bank-credits`, `/api/bank-credits/[id]`,
  `/api/bank-credits/[id]/repayments` already implemented; DELETE returns 409
  when repayments exist.

## Work log
- Read the worklog, existing views (`wallets-view.tsx`, `dashboard-view.tsx`),
  shared components (`shared.tsx`, `confirm-dialog.tsx`), and the bank-credits
  API routes to align with established patterns.
- Replaced the 1-line stub with a ~1220-line implementation:
  1. **PageHeader** with `t('credit.title')` and an Add button.
  2. **Credits list grid** (1 col mobile / 2 cols sm+) where each credit renders
     as a credit-card-style Card:
     - Top stripe (`borderTop: 4px solid {color}`) tinted by
       `creditCardColor(progressPct)` — red (<50%), orange (50–<70%), dark green
       (70–<90%), green (90–100%).
     - Subtle diagonal gradient overlay tinted with the same color.
     - Header row: Landmark icon chip + credit name; lender + status badges.
     - Hero block: large outstanding amount colored by the same palette.
     - Quick-stats row: original principal / monthly installment / duration /
       progress %.
     - Custom progress bar (hand-rolled div, since shadcn `Progress` indicator
       is hardcoded to `bg-primary`); the fill width = progressPct,
       backgroundColor = card stripe color.
     - 4 MiniStat tiles: Total repaid (income tone), Paid installments / total
       (info), Next due date, Expected end date.
     - Optional description (`line-clamp-2`).
     - Kebab menu: View Schedule, Add Repayment, Edit, Delete.
  3. **Create/Edit dialog**: Credit name, Lender, Original principal, Duration
     months, Start date, Monthly installment, Interest rate (optional), Fees
     (optional), Payment day (1–31), Description, Status (Select active /
     completed / on_hold). Wrapped in `ScrollArea` (max-h-[70vh]) for small
     screens. Per-field validation with `toast.error`.
  4. **Schedule dialog**: fetches `/api/bank-credits/[id]` on open via
     `useQuery(['bank-credit', id], enabled: scheduleOpen)`. Renders a 2/4-col
     grid of installment segments, each colored by `installmentSegment(inst)`:
     - paid → green tint + green border + green badge.
     - pending + dueDate < today → red tint + red border + red badge.
     - pending + future → orange tint + orange border + orange badge.
     - Each segment shows #N, status badge, due date, amount.
     - Groups by year (with Flag icon header) when multiple years are present.
     - Legend at the top.
  5. **Add Repayment dialog**: Amount, Payment date (default today), Comment,
     Wallet (Select — optional, fetched from `/api/wallets`). Uses `__none__`
     sentinel for "None". On submit POSTs to
     `/api/bank-credits/[id]/repayments` with `walletId: null` when None.
  6. **Delete**: `ConfirmDialog` (destructive). On 409, useApi toasts the error
     and the mutation throws; `await deleteMutation.mutateAsync(id)` propagates
     the throw out of `onConfirm`, so ConfirmDialog's `onOpenChange(false)` is
     never called and the dialog stays open — surfacing the conflict.
  7. **Empty state**: `EmptyState` with `t('credit.empty')` and an Add button.
     Skeletons during initial load.
- Mutations: `createMutation`, `updateMutation`, `deleteMutation`,
  `repaymentMutation` — each invalidates `['bank-credits']`,
  `['bank-credit', id]` (when relevant), `['dashboard']`, `['analytics']` on
  success.
- Strict TypeScript types for `BankCredit`, `BankCreditDetail`,
  `CreditInstallment`, `CreditRepayment`, `Wallet`, `WalletsResponse`,
  `BankCreditsListResponse`. No `any`.
- Status labels reuse existing i18n keys (active → `common.active`, completed →
  `goal.status.completed`, on_hold → `goal.status.on_hold`) so no changes to
  i18n.ts were required.
- All API requests use relative paths only.

## Validation
- `bun run lint` → 0 errors in `bank-credits-view.tsx`. (1 pre-existing warning
  in `src/components/boot.tsx` — not my file.)
- `tail -40 dev.log` → `✓ Compiled in 144ms` / `✓ Compiled in 146ms`, no
  compile errors, no Fast Refresh runtime errors after final edits.
- Verified `BankCreditsView` is wired in `src/components/app-shell.tsx`
  (`case 'bankCredits': return <BankCreditsView />`) — no changes needed there.

## Stage Summary
- Bank Credits view is feature-complete: credit-card-style visuals
  (color-shifts by progress), responsive 1/2-column grid, kebab menu actions
  (View Schedule / Add Repayment / Edit / Delete), create/edit dialog with all
  11 fields, schedule dialog with year-grouped color-coded installment segments
  + legend, repayment dialog with optional wallet association, ConfirmDialog
  for delete with 409 surface, empty state, skeletons during load, and full
  React Query cache invalidation (list + dashboard + analytics).
- No Prisma schema changes. No app-shell changes. No test files. Only the
  single file `src/components/views/bank-credits-view.tsx` was modified.
