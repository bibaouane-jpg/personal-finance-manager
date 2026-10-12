# Task 8 — dashboard-view agent

## Task
Implement the Dashboard view (`src/components/views/dashboard-view.tsx`) as a full
single-route client view consuming the `/api/dashboard` endpoint described in Task 6.

## What previous agents built (used as input)
- `src/lib/use-i18n.ts` → `{ locale, t, money, num, date, dateTime }`
- `src/lib/use-api.ts` → `{ get, post, put, del, loading }` (auto toast errors)
- `src/lib/money.ts` → `toCents`, `fromCents`, `pct`, `formatMoney`, …
- `src/components/shared.tsx` → `StatCard`, `EmptyState`, `MoneyText`, `PageHeader`
- shadcn/ui components (`Card`, `Select`, `Input`, `Skeleton`, `Badge`, `Progress`, `ScrollArea`)
- recharts is installed; lucide-react is installed
- Tailwind 4 color tokens `text-income / text-expense / text-warning / text-info` plus
  the matching `bg-*` tints defined in `src/app/globals.css`.
- `@tanstack/react-query` is wired through `src/components/providers.tsx` (default staleTime 30s).

## Work log
- Replaced the 1-line stub with a 1200-line implementation that:
  1. **Period filter bar** at the top — a `Select` with the six period options
     (today / this_week / this_month / this_year / all_time / custom_range); when
     `custom_range` is picked, two `Input type="date"` fields appear for `from` / `to`.
     Changing any of these updates the `useQuery` cache key → triggers a refetch.
     The query is disabled when `custom_range` is selected without both dates filled
     (avoids spurious 400s on the backend).
  2. **Top stats grid** — `StatCard`s for `totalWalletBalance` (Wallet icon), `income`
     (TrendingUp, income tone), `expenses` (TrendingDown, expense tone), `netCashFlow`
     (Scale, tone derived from sign via `useMemo` + `toCents`). Responsive:
     1 / 2 / 3 / 4 columns at mobile / sm / lg / xl.
  3. **Secondary stats grid** — `StatCard`s for `bankBalance`, `cashBalance`,
     `savingsBalance` (only when non-zero, checked via `toCents(savingsBalance) !== 0`),
     `outstandingBankDebt` (expense tone), `outstandingLent` (info tone), `savingsRate`
     (with `%` suffix), `goalsProgress` (with `%` suffix). Same responsive grid.
  4. **Charts section** (`lg:grid-cols-2`):
     - Monthly income vs expenses — grouped `BarChart` (`Bar dataKey="income"
       fill="var(--income)"` / `"expenses" fill="var(--expense)"`), with
       `ResponsiveContainer width="100%" height={300}`, hidden Y axis, locale-aware
       month tick formatter (`Intl.DateTimeFormat('fr-FR' | 'en-US', { month: 'short' })`
       applied to `new Date(month + '-01T00:00:00Z')`), custom `MoneyTooltip` content
       that uses `money()` for the values and the month label formatter.
     - Expense distribution by category — `PieChart` donut (`innerRadius={55}
       outerRadius={85}`) with each `Cell` filled by `slice.color`. Center overlay
       shows the total in money form, plus a side legend with name + amount per slice.
     - Income distribution by category — same shape via the shared
       `CategoryDonutChart` component.
     - Wallet balance distribution — horizontal `BarChart` (`layout="vertical"`) with
       one bar per wallet colored by `wallet.color`; Y axis shows wallet names; X
       axis hidden; `maxBarSize={26}`.
     - Net cash flow trend — `AreaChart` with a `linearGradient` fill from
       `var(--info)` 35% → 2%, monotone line stroke `var(--info)`; X axis tick is the
       day formatted via `Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' })`.
     - Goals completion — `PieChart` donut with `Cell` color from a
       `STATUS_COLOR` map (`not_started` → muted, `in_progress` → info, `completed` →
       income, `on_hold` → warning, `cancelled` → expense). Center shows total goals
       count. Side legend lists localized status names with their counts.
     - Each chart is wrapped in a `ChartCard` that renders a `Card` with `CardHeader`
       (translated title via `t('dash.*')`) and `CardContent`.
     - Empty data → `EmptyState` with `t('dash.noData')`.
  5. **Widgets section** (`lg:grid-cols-2 xl:grid-cols-3`):
     - **Recent transactions** — `Card` with `ScrollArea` (`max-h-80 scrollbar-thin`),
       showing name + colored `Badge` for category (background tinted by `categoryColor`),
       wallet name + date (small), and amount via `MoneyText` (income green / expense red).
     - **Top expense categories** — top 5 with color dot, name, amount + percent; a
       custom mini progress bar (div with inline `width: %` and `backgroundColor` set
       to the category color) shows the share of the period's total expense per
       category. A footer row shows the total.
     - **Recent transfers** — list of 5 with source → dest (with `ArrowRight` icon
       between), amount, date.
     - **Upcoming installments** — list of 5 with credit name, `#installmentNumber`
       outline badge, due date (`CalendarClock` icon), amount, and a status badge
       (paid → income tone, overdue → expense tone, pending → warning tone).
     - **Financial alerts** — list with `border-l-{level}` colored left border
       (warning → orange, error → red, info → blue) and a matching icon
       (`AlertTriangle` for warning/error, `Info` for info). When empty, shows a
       friendly "All clear" message with a `BellOff` icon.
     - **Goals nearing completion** — list of goals with `progress >= 75 && < 100`
       (already filtered by the backend), each with a `Progress` bar (`h-1.5`) and
       the percent displayed on the right.
     - **Current wallet balances** — list of active wallets with color dot, name,
       localized type label (`wal.bank` / `wal.cash` / `wal.savings` / `wal.other`)
       and the balance via `MoneyText`.
  6. **Loading state** — `DashboardSkeleton` renders skeleton placeholders for the
     four top cards, four secondary cards, four chart cards (260px tall skeleton
     inside), and six widget cards (each with 4 row skeletons). `useQuery`'s
     `isLoading` flag triggers the skeleton render.
  7. **Data fetching** — `useQuery<DashboardResponse>` with cache key
     `['dashboard', filter, from, to]` so changing any filter param refetches.
     `api.get('/api/dashboard', { query: { filter, ...(from?), ...(to?) } })` — the
     `useApi` wrapper handles 401s and toasts errors. The query is `enabled` only
     when filter ≠ `custom_range` OR both `from` and `to` are set.

## Implementation details worth noting
- Strict TypeScript types for the full `/api/dashboard` response (cards, charts,
  widgets) — no `any`.
- All recharts color tokens reference CSS variables (`var(--income)`,
  `var(--expense)`, `var(--info)`, `var(--accent)`) so the dashboard adapts to
  light/dark theme automatically.
- Custom `MoneyTooltip` is locale-aware (uses `money()` from `useI18n`) and renders
  in a `bg-popover` panel with a colored dot per payload entry.
- All month/date tick formatting uses `Intl.DateTimeFormat` with the locale from
  `useI18n()` — no hardcoded English.
- `useMemo` is used to pre-compute chart data (cents → numbers for recharts, total
  amounts, percentages) so recharts receives plain objects.
- For the top-expense-categories widget, the progress bar is a hand-rolled div
  instead of the shadcn `Progress` because the shadcn `Progress` indicator color
  is hardcoded to `bg-primary` (the component sets its own inline `transform`
  style). Using a plain div lets us tint the bar with each category's `color`.
- The shadcn `Progress` is still used for the "goals near completion" widget
  (where the default primary color is fine).
- Empty states everywhere use `EmptyState` with `t('dash.noData')`.
- The alerts widget degrades gracefully: empty `alerts` array → friendly "All clear"
  panel instead of `EmptyState` (better UX since "no alerts" is a *good* thing).

## Validation
- `bun run lint` — 0 errors in dashboard-view.tsx. (1 unrelated warning in
  `src/components/boot.tsx` from a stale `eslint-disable` directive — not my file.)
- `tail -10 dev.log` shows `✓ Compiled` entries with no errors after my changes.

## Stage Summary
- Dashboard view is feature-complete and matches every requirement in the spec:
  period filter bar (with custom range date inputs), top stats grid (4 cards),
  secondary stats grid (7 cards with conditional savings), 6 chart types using
  recharts (grouped bar, donut pie ×3, horizontal bar, area, donut pie again), and
  7 widget cards (recent transactions, top expense categories, recent transfers,
  upcoming installments, alerts, goals near completion, current wallet balances).
- All translations go through `t('dash.*')` / `t('common.*')` / `t('wal.*')` /
  `t('goal.status.*')` — full EN/FR bilingual coverage already present in i18n.ts.
- Skeletons shown during `useQuery` loading. Empty states shown when chart/widget
  arrays are empty. Errors are toast-notified by `useApi` and the query retries once
  (per Providers defaultOptions).
- No Prisma schema changes. No test files. No other views modified. Only the
  dashboard-view.tsx file was touched.
