'use client'

import { useMemo, useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Wallet as WalletIcon,
  TrendingUp,
  TrendingDown,
  Scale,
  Banknote,
  PiggyBank,
  CreditCard,
  HandCoins,
  Percent,
  Target,
  ArrowRight,
  CalendarClock,
  Info,
  AlertTriangle,
  BellOff,
} from 'lucide-react'

import { useI18n } from '@/lib/use-i18n'
import { useApi } from '@/lib/use-api'
import { toCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import { MiniBarChart, MiniDonutChart, MiniHBarChart, MiniAreaChart, type BarDatum, type DonutDatum, type HBarDatum, type LineDatum } from '@/components/mini-charts'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { StatCard, EmptyState, MoneyText, PageHeader } from '@/components/shared'

// ---------------------------------------------------------------------------
// Types — match the /api/dashboard response shape.
// ---------------------------------------------------------------------------

type PeriodFilter =
  | 'today'
  | 'this_week'
  | 'this_month'
  | 'this_year'
  | 'all_time'
  | 'custom_range'

interface DashboardPeriod {
  filter: string
  start: string
  end: string
}

interface DashboardCards {
  totalWalletBalance: string
  income: string
  expenses: string
  netCashFlow: string
  bankBalance: string
  cashBalance: string
  savingsBalance: string
  outstandingBankDebt: string
  outstandingLent: string
  savingsRate: number
  goalsProgress: number
}

interface CategorySlice {
  categoryId: string
  name: string
  color: string
  amount: string
}

interface WalletSlice {
  walletId: string
  name: string
  color: string
  balance: string
}

interface MonthlyBucket {
  month: string
  income: string
  expenses: string
}

interface TrendPoint {
  date: string
  value: string
}

interface GoalCompletionSlice {
  status: string
  count: number
}

interface RecentTransaction {
  id: string
  name: string
  amount: string
  type: 'income' | 'expense'
  date: string
  categoryName: string | null
  categoryColor: string | null
  walletName: string | null
}

interface RecentTransfer {
  id: string
  sourceName: string
  destName: string
  amount: string
  date: string
  comment: string | null
}

interface UpcomingInstallment {
  creditId: string
  creditName: string
  installmentNumber: number
  dueDate: string
  amount: string
  status: string
}

interface DashboardAlert {
  level: 'warning' | 'error' | 'info'
  message: string
}

interface GoalNearCompletion {
  id: string
  title: string
  progress: number
  year: number
}

interface CurrentWalletBalance {
  walletId: string
  name: string
  type: string
  color: string
  balance: string
}

interface DashboardResponse {
  period: DashboardPeriod
  cards: DashboardCards
  charts: {
    monthlyIncomeVsExpenses: MonthlyBucket[]
    incomeTrend: TrendPoint[]
    expenseTrend: TrendPoint[]
    expenseByCategory: CategorySlice[]
    incomeByCategory: CategorySlice[]
    walletDistribution: WalletSlice[]
    netCashFlowTrend: TrendPoint[]
    goalsCompletion: GoalCompletionSlice[]
  }
  widgets: {
    recentTransactions: RecentTransaction[]
    topExpenseCategories: CategorySlice[]
    recentTransfers: RecentTransfer[]
    upcomingInstallments: UpcomingInstallment[]
    budgetUsage: { walletId: string; walletName: string; used: string; limit: string }[]
    alerts: DashboardAlert[]
    goalsNearCompletion: GoalNearCompletion[]
    currentWalletBalances: CurrentWalletBalance[]
  }
}

// ---------------------------------------------------------------------------
// Period filter bar
// ---------------------------------------------------------------------------

const FILTER_OPTIONS: { value: PeriodFilter; labelKey: string }[] = [
  { value: 'today', labelKey: 'common.today' },
  { value: 'this_week', labelKey: 'common.thisWeek' },
  { value: 'this_month', labelKey: 'common.thisMonth' },
  { value: 'this_year', labelKey: 'common.thisYear' },
  { value: 'all_time', labelKey: 'common.allTime' },
  { value: 'custom_range', labelKey: 'common.customRange' },
]

function PeriodFilterBar({
  filter,
  from,
  to,
  onFilterChange,
  onFromChange,
  onToChange,
}: {
  filter: PeriodFilter
  from: string
  to: string
  onFilterChange: (f: PeriodFilter) => void
  onFromChange: (v: string) => void
  onToChange: (v: string) => void
}) {
  const { t } = useI18n()
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="flex items-center gap-2">
        <Select value={filter} onValueChange={(v) => onFilterChange(v as PeriodFilter)}>
          <SelectTrigger className="w-[180px]" size="sm">
            <SelectValue placeholder={t('common.filter')} />
          </SelectTrigger>
          <SelectContent>
            {FILTER_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {filter === 'custom_range' && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-muted-foreground whitespace-nowrap">{t('common.from')}</label>
            <Input
              type="date"
              value={from}
              onChange={(e) => onFromChange(e.target.value)}
              className="h-8 w-[150px]"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-muted-foreground whitespace-nowrap">{t('common.to')}</label>
            <Input
              type="date"
              value={to}
              onChange={(e) => onToChange(e.target.value)}
              className="h-8 w-[150px]"
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Recharts custom tooltip
// ---------------------------------------------------------------------------

function MoneyTooltip({
  active,
  payload,
  label,
  money,
  labelFormatter,
}: {
  active?: boolean
  payload?: { name?: string; value?: string | number; color?: string; dataKey?: string }[]
  label?: string | number
  money: (v: string | number | null | undefined) => string
  labelFormatter?: (label: string | number | undefined) => string
}) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="rounded-md border bg-popover p-3 text-xs shadow-md">
      {label !== undefined && label !== '' && (
        <p className="mb-1 font-medium text-foreground">
          {labelFormatter ? labelFormatter(label) : label}
        </p>
      )}
      <div className="space-y-1">
        {payload.map((entry, i) => (
          <div key={i} className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: entry.color || 'var(--muted-foreground)' }}
            />
            <span className="text-muted-foreground">{entry.name}:</span>
            <span className="font-medium tabular-nums text-foreground">{money(entry.value)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Chart card wrapper
// ---------------------------------------------------------------------------

function ChartCard({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Recharts 3.x has native React 19 support; ChartReady is now a passthrough.
function ChartReady({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

const STATUS_COLOR: Record<string, string> = {
  not_started: 'var(--muted-foreground)',
  in_progress: 'var(--info)',
  completed: 'var(--income)',
  on_hold: 'var(--warning)',
  cancelled: 'var(--expense)',
}

const ALERT_BORDER: Record<DashboardAlert['level'], string> = {
  warning: 'border-l-warning',
  error: 'border-l-expense',
  info: 'border-l-info',
}

const ALERT_ICON_COLOR: Record<DashboardAlert['level'], string> = {
  warning: 'text-warning',
  error: 'text-expense',
  info: 'text-info',
}

function formatMonthLabel(month: string, locale: 'en' | 'fr'): string {
  // month comes as "YYYY-MM"
  const d = new Date(`${month}-01T00:00:00Z`)
  if (isNaN(d.getTime())) return month
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-US', { month: 'short' }).format(d)
}

function formatTrendDate(iso: string, locale: 'en' | 'fr'): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-US', {
    month: 'short',
    day: 'numeric',
  }).format(d)
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

function IncomeVsExpensesChart({ data }: { data: MonthlyBucket[] }) {
  const { t, money, locale } = useI18n()
  const chartData = useMemo(
    () =>
      data.map((b) => ({
        month: b.month,
        income: Number(b.income),
        expenses: Number(b.expenses),
      })),
    [data]
  )
  if (chartData.length === 0) {
    return <EmptyState title={t('dash.noData')} />
  }
  const barData: BarDatum[] = chartData.map((b) => ({
    label: formatMonthLabel(b.month, locale),
    values: [
      { value: b.income, color: '#16a34a', name: t('dash.income') },
      { value: b.expenses, color: '#dc2626', name: t('dash.expenses') },
    ],
  }))
  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: '#16a34a' }} />{t('dash.income')}</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: '#dc2626' }} />{t('dash.expenses')}</span>
      </div>
      <MiniBarChart data={barData} height={300} formatValue={(v) => money(v / 100)} />
    </div>
  )
}

function CategoryDonutChart({
  data,
  emptyKey,
}: {
  data: CategorySlice[]
  emptyKey?: string
}) {
  const { t, money } = useI18n()
  const { chartData, totalCents } = useMemo(() => {
    const arr = data.map((d) => ({
      name: d.name,
      value: toCents(d.amount),
      color: d.color || 'var(--muted-foreground)',
    }))
    const total = arr.reduce((s, e) => s + e.value, 0)
    return { chartData: arr, totalCents: total }
  }, [data])

  if (chartData.length === 0) {
    return <EmptyState title={t(emptyKey || 'dash.noData')} />
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="flex items-center justify-center">
        <MiniDonutChart
          data={chartData}
          size={200}
          thickness={28}
          centerLabel={t('common.total')}
          centerValue={money(totalCents / 100)}
          formatValue={(v) => money(v / 100)}
        />
      </div>
      <div className="flex flex-col justify-center gap-1.5">
        {chartData.map((entry, i) => (
          <div key={i} className="flex items-center justify-between gap-2 text-xs">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="truncate text-muted-foreground">{entry.name}</span>
            </div>
            <span className="font-medium tabular-nums text-foreground">{money(entry.value / 100)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function WalletDistributionChart({ data }: { data: WalletSlice[] }) {
  const { t, money } = useI18n()
  const chartData = useMemo(
    () =>
      data.map((d) => ({
        name: d.name,
        balance: toCents(d.balance),
        color: d.color || 'var(--muted-foreground)',
      })),
    [data]
  )
  if (chartData.length === 0) {
    return <EmptyState title={t('dash.noData')} />
  }
  const hBarData: HBarDatum[] = chartData.map((d) => ({ name: d.name, value: d.balance, color: d.color }))
  return (
    <MiniHBarChart data={hBarData} height={260} formatValue={(v) => money(v / 100)} />
  )
}

function NetCashFlowTrendChart({ data }: { data: TrendPoint[] }) {
  const { t, money, locale } = useI18n()
  const chartData = useMemo(
    () =>
      data.map((p) => ({
        date: p.date,
        value: toCents(p.value),
      })),
    [data]
  )
  if (chartData.length === 0) {
    return <EmptyState title={t('dash.noData')} />
  }
  const lineData: LineDatum[] = chartData.map((p) => ({ label: formatTrendDate(p.date, locale), value: p.value }))
  return (
    <MiniAreaChart data={lineData} height={260} color="var(--info)" formatValue={(v) => money(v / 100)} />
  )
}

function GoalsCompletionChart({ data }: { data: GoalCompletionSlice[] }) {
  const { t } = useI18n()
  const chartData = useMemo(
    () =>
      data.map((d) => ({
        name: t(`goal.status.${d.status}` as string) || d.status,
        value: d.count,
        color: STATUS_COLOR[d.status] || 'var(--muted-foreground)',
      })),
    [data, t]
  )
  if (chartData.length === 0) {
    return <EmptyState title={t('dash.noData')} />
  }
  const total = chartData.reduce((s, e) => s + e.value, 0)
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="flex items-center justify-center">
        <MiniDonutChart
          data={chartData}
          size={180}
          thickness={28}
          centerLabel={t('goal.totalGoals')}
          centerValue={String(total)}
        />
      </div>
      <div className="flex flex-col justify-center gap-1.5">
        {chartData.map((entry, i) => (
          <div key={i} className="flex items-center justify-between gap-2 text-xs">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="truncate text-muted-foreground">{entry.name}</span>
            </div>
            <span className="font-medium tabular-nums text-foreground">{entry.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Widget lists
// ---------------------------------------------------------------------------

function RecentTransactionsWidget({ items }: { items: RecentTransaction[] }) {
  const { t, money, date } = useI18n()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">{t('dash.recentTransactions')}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <EmptyState title={t('dash.noData')} />
        ) : (
          <ScrollArea className="max-h-80 pr-3 scrollbar-thin">
            <ul className="divide-y">
              {items.map((tx) => (
                <li key={`${tx.type}-${tx.id}`} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{tx.name}</span>
                      {tx.categoryName && (
                        <Badge
                          variant="secondary"
                          className="shrink-0"
                          style={
                            tx.categoryColor
                              ? {
                                  backgroundColor: `${tx.categoryColor}22`,
                                  color: tx.categoryColor,
                                  borderColor: 'transparent',
                                }
                              : undefined
                          }
                        >
                          {tx.categoryName}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      {tx.walletName && <span className="truncate">{tx.walletName}</span>}
                      {tx.walletName && <span>·</span>}
                      <span>{date(tx.date)}</span>
                    </div>
                  </div>
                  <MoneyText
                    value={tx.amount}
                    tone={tx.type === 'income' ? 'income' : 'expense'}
                    className="text-sm whitespace-nowrap"
                  />
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}

function TopExpenseCategoriesWidget({ items }: { items: CategorySlice[] }) {
  const { t, money } = useI18n()
  const { totalCents, rows } = useMemo(() => {
    const total = items.reduce((s, c) => s + toCents(c.amount), 0)
    const rows = items.map((c) => ({
      ...c,
      cents: toCents(c.amount),
      pct: total > 0 ? Math.round((toCents(c.amount) / total) * 100) : 0,
    }))
    return { totalCents: total, rows }
  }, [items])
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">{t('dash.topExpenseCategories')}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState title={t('dash.noData')} />
        ) : (
          <ul className="space-y-3">
            {rows.map((row) => (
              <li key={row.categoryId} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: row.color || 'var(--muted-foreground)' }}
                    />
                    <span className="truncate text-foreground">{row.name}</span>
                  </div>
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <span className="font-medium tabular-nums text-foreground">{money(row.amount)}</span>
                    <span className="text-[11px] text-muted-foreground">{row.pct}%</span>
                  </div>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${row.pct}%`,
                      backgroundColor: row.color || 'var(--primary)',
                    }}
                  />
                </div>
              </li>
            ))}
            {totalCents > 0 && (
              <li className="flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
                <span>{t('common.total')}</span>
                <span className="font-medium tabular-nums">{money(totalCents / 100)}</span>
              </li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function RecentTransfersWidget({ items }: { items: RecentTransfer[] }) {
  const { t, money, date } = useI18n()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">{t('dash.recentTransfers')}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <EmptyState title={t('dash.noData')} />
        ) : (
          <ul className="space-y-2.5">
            {items.map((tr) => (
              <li key={tr.id} className="flex items-center gap-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-foreground">{tr.sourceName}</span>
                    <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="truncate text-foreground">{tr.destName}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">{date(tr.date)}</div>
                </div>
                <MoneyText value={tr.amount} tone="default" className="whitespace-nowrap" />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function UpcomingInstallmentsWidget({ items }: { items: UpcomingInstallment[] }) {
  const { t, money, date } = useI18n()
  const statusTone = (status: string): 'warning' | 'expense' | 'income' => {
    if (status === 'paid') return 'income'
    if (status === 'overdue') return 'expense'
    return 'warning'
  }
  const statusLabel = (status: string) => {
    if (status === 'paid') return t('goal.status.completed')
    if (status === 'overdue') return t('common.status')
    return status
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">{t('dash.upcomingInstallments')}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <EmptyState title={t('dash.noData')} />
        ) : (
          <ul className="space-y-2.5">
            {items.map((ins) => (
              <li key={`${ins.creditId}-${ins.installmentNumber}`} className="flex items-center gap-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-foreground">{ins.creditName}</span>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      #{ins.installmentNumber}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <CalendarClock className="h-3 w-3" />
                    <span>{date(ins.dueDate)}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <MoneyText value={ins.amount} className="whitespace-nowrap" />
                  <Badge
                    variant="secondary"
                    className={cn(
                      'text-[10px]',
                      statusTone(ins.status) === 'income' && 'bg-income/15 text-income',
                      statusTone(ins.status) === 'expense' && 'bg-expense/15 text-expense',
                      statusTone(ins.status) === 'warning' && 'bg-warning/15 text-warning'
                    )}
                  >
                    {statusLabel(ins.status)}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function AlertsWidget({ alerts }: { alerts: DashboardAlert[] }) {
  const { t } = useI18n()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">{t('dash.alerts')}</CardTitle>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
            <BellOff className="mb-2 h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">All clear</p>
            <p className="mt-1 text-xs text-muted-foreground">No alerts for the current period.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {alerts.map((a, i) => {
              const Icon =
                a.level === 'error' ? AlertTriangle : a.level === 'warning' ? AlertTriangle : Info
              return (
                <li
                  key={i}
                  className={cn(
                    'flex items-start gap-2 rounded-md border border-l-2 bg-card p-2.5 text-sm',
                    ALERT_BORDER[a.level]
                  )}
                >
                  <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', ALERT_ICON_COLOR[a.level])} />
                  <span className="text-foreground">{a.message}</span>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function GoalsNearCompletionWidget({ items }: { items: GoalNearCompletion[] }) {
  const { t } = useI18n()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">{t('dash.goalsNearCompletion')}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <EmptyState title={t('dash.noData')} />
        ) : (
          <ul className="space-y-3">
            {items.map((g) => (
              <li key={g.id} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <div className="flex min-w-0 items-center gap-2">
                    <Target className="h-3.5 w-3.5 shrink-0 text-info" />
                    <span className="truncate text-foreground">{g.title}</span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">{g.year}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Progress value={g.progress} className="h-1.5" />
                  <span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">
                    {g.progress}%
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function CurrentWalletBalancesWidget({ items }: { items: CurrentWalletBalance[] }) {
  const { t, money } = useI18n()
  const typeLabel = (type: string) => {
    if (type === 'bank') return t('wal.bank')
    if (type === 'cash') return t('wal.cash')
    if (type === 'savings') return t('wal.savings')
    return t('wal.other')
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">{t('dash.currentWalletBalances')}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <EmptyState title={t('dash.noData')} />
        ) : (
          <ul className="space-y-2.5">
            {items.map((w) => (
              <li key={w.walletId} className="flex items-center justify-between gap-2 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: w.color || 'var(--muted-foreground)' }}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-foreground">{w.name}</div>
                    <div className="text-[11px] text-muted-foreground">{typeLabel(w.type)}</div>
                  </div>
                </div>
                <MoneyText value={w.balance} className="whitespace-nowrap" />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Loading skeletons
// ---------------------------------------------------------------------------

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-7 w-7 rounded-md" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-7 w-32" />
              <Skeleton className="mt-2 h-3 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-7 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-5 w-40" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-[260px] w-full rounded-md" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-5 w-40" />
            </CardHeader>
            <CardContent className="space-y-3">
              {Array.from({ length: 4 }).map((__, j) => (
                <Skeleton key={j} className="h-5 w-full" />
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function DashboardView() {
  const { t, money } = useI18n()
  const api = useApi()

  const [filter, setFilter] = useState<PeriodFilter>('this_month')
  const [from, setFrom] = useState<string>('')
  const [to, setTo] = useState<string>('')

  const queryKey = useMemo(
    () => ['dashboard', filter, from, to] as const,
    [filter, from, to]
  )

  const { data, isLoading } = useQuery<DashboardResponse>({
    queryKey,
    queryFn: () =>
      api.get<DashboardResponse>('/api/dashboard', {
        query: {
          filter,
          ...(filter === 'custom_range' && from ? { from } : {}),
          ...(filter === 'custom_range' && to ? { to } : {}),
        },
      }),
    enabled: filter !== 'custom_range' || (!!from && !!to),
  })

  const cards = data?.cards
  const charts = data?.charts
  const widgets = data?.widgets

  const netTone: 'income' | 'expense' | 'default' = useMemo(() => {
    if (!cards) return 'default'
    const c = toCents(cards.netCashFlow)
    if (c > 0) return 'income'
    if (c < 0) return 'expense'
    return 'default'
  }, [cards])

  const showSavingsBalance = cards ? toCents(cards.savingsBalance) !== 0 : true

  return (
    <div className="space-y-6">
      <PageHeader title={t('dash.title')} description={undefined} actions={undefined} />

      <PeriodFilterBar
        filter={filter}
        from={from}
        to={to}
        onFilterChange={setFilter}
        onFromChange={setFrom}
        onToChange={setTo}
      />

      {isLoading || !data ? (
        <DashboardSkeleton />
      ) : (
        <>
          {/* Top stats grid */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <StatCard
              label={t('dash.totalBalance')}
              value={money(cards?.totalWalletBalance)}
              icon={WalletIcon}
              tone="default"
            />
            <StatCard
              label={t('dash.income')}
              value={money(cards?.income)}
              icon={TrendingUp}
              tone="income"
            />
            <StatCard
              label={t('dash.expenses')}
              value={money(cards?.expenses)}
              icon={TrendingDown}
              tone="expense"
            />
            <StatCard
              label={t('dash.netCashFlow')}
              value={money(cards?.netCashFlow)}
              icon={Scale}
              tone={netTone === 'income' ? 'income' : netTone === 'expense' ? 'expense' : 'default'}
            />
          </div>

          {/* Secondary stats grid */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <StatCard
              label={t('dash.bankBalance')}
              value={money(cards?.bankBalance)}
              icon={Banknote}
              tone="default"
            />
            <StatCard
              label={t('dash.cashBalance')}
              value={money(cards?.cashBalance)}
              icon={WalletIcon}
              tone="default"
            />
            {showSavingsBalance && (
              <StatCard
                label={t('wal.savings')}
                value={money(cards?.savingsBalance)}
                icon={PiggyBank}
                tone="info"
              />
            )}
            <StatCard
              label={t('dash.outstandingDebt')}
              value={money(cards?.outstandingBankDebt)}
              icon={CreditCard}
              tone="expense"
            />
            <StatCard
              label={t('dash.lentOut')}
              value={money(cards?.outstandingLent)}
              icon={HandCoins}
              tone="info"
            />
            <StatCard
              label={t('dash.savingsRate')}
              value={`${cards?.savingsRate ?? 0}%`}
              icon={Percent}
              tone={Number(cards?.savingsRate ?? 0) >= 0 ? 'income' : 'expense'}
            />
            <StatCard
              label={t('dash.goalsProgress')}
              value={`${cards?.goalsProgress ?? 0}%`}
              icon={Target}
              tone="info"
            />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title={t('dash.incomeVsExpenses')}>
              <IncomeVsExpensesChart data={charts?.monthlyIncomeVsExpenses ?? []} />
            </ChartCard>
            <ChartCard title={t('dash.netCashFlowTrend')}>
              <NetCashFlowTrendChart data={charts?.netCashFlowTrend ?? []} />
            </ChartCard>
            <ChartCard title={t('dash.expenseDistribution')}>
              <CategoryDonutChart data={charts?.expenseByCategory ?? []} />
            </ChartCard>
            <ChartCard title={t('dash.incomeDistribution')}>
              <CategoryDonutChart data={charts?.incomeByCategory ?? []} />
            </ChartCard>
            <ChartCard title={t('dash.walletDistribution')}>
              <WalletDistributionChart data={charts?.walletDistribution ?? []} />
            </ChartCard>
            <ChartCard title={t('dash.goalsCompletion')}>
              <GoalsCompletionChart data={charts?.goalsCompletion ?? []} />
            </ChartCard>
          </div>

          {/* Widgets */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <RecentTransactionsWidget items={widgets?.recentTransactions ?? []} />
            <TopExpenseCategoriesWidget items={widgets?.topExpenseCategories ?? []} />
            <RecentTransfersWidget items={widgets?.recentTransfers ?? []} />
            <UpcomingInstallmentsWidget items={widgets?.upcomingInstallments ?? []} />
            <AlertsWidget alerts={widgets?.alerts ?? []} />
            <GoalsNearCompletionWidget items={widgets?.goalsNearCompletion ?? []} />
            <CurrentWalletBalancesWidget items={widgets?.currentWalletBalances ?? []} />
          </div>
        </>
      )}
    </div>
  )
}
