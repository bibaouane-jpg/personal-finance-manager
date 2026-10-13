'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  TrendingUp,
  TrendingDown,
  Wallet as WalletIcon,
  Banknote,
  ArrowLeftRight,
  Scale,
  CreditCard,
  HandCoins,
  Target,
  CalendarClock,
  Coins,
  Landmark,
  Percent,
  ArrowDownToLine,
  Hash,
  Trophy,
  PiggyBank,
} from 'lucide-react'

import { useI18n } from '@/lib/use-i18n'
import { useApi } from '@/lib/use-api'
import { toCents } from '@/lib/money'

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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { StatCard, EmptyState, PageHeader } from '@/components/shared'
import {
  MiniBarChart,
  MiniDonutChart,
  MiniHBarChart,
  MiniAreaChart,
  type BarDatum,
  type DonutDatum,
  type HBarDatum,
  type LineDatum,
} from '@/components/mini-charts'

// ---------------------------------------------------------------------------
// Types — minimal shapes matching the /api/analytics?section=… response.
// ---------------------------------------------------------------------------

type PeriodFilter =
  | 'today'
  | 'this_week'
  | 'this_month'
  | 'this_year'
  | 'all_time'
  | 'custom_range'

type AnalyticsSection =
  | 'income'
  | 'expenses'
  | 'wallets'
  | 'cash_withdrawals'
  | 'transfers'
  | 'net_cash_flow'
  | 'allocations'
  | 'bank_credits'
  | 'personal_loans'
  | 'goals'

interface ByCategoryRow {
  categoryId: string
  name: string
  color: string
  amount: string
}
interface ByArticleRow {
  articleId: string
  name: string
  amount: string
}
interface ByWalletRow {
  walletId: string
  name: string
  color: string
  amount: string
}
interface MonthlyAmount {
  month: string
  amount: string
}
interface LargestRow {
  id: string
  name: string | null
  amount: string
  date: string
  categoryName: string | null
}

interface IncomeData {
  total: string
  byCategory: ByCategoryRow[]
  byArticle: ByArticleRow[]
  byWallet: ByWalletRow[]
  monthly: MonthlyAmount[]
  average: string
  largest: LargestRow | null
  sourceConcentration: number
}
interface ExpenseData {
  total: string
  byCategory: ByCategoryRow[]
  byArticle: ByArticleRow[]
  byWallet: ByWalletRow[]
  largest: LargestRow | null
  monthly: MonthlyAmount[]
  average: string
  savingsRate: number
  budgetComparison: { hasBudgets: boolean; message?: string }
}
interface WalletCurrent {
  walletId: string
  name: string
  type: string
  color: string
  active: boolean
  balance: string
}
interface WalletFlowRow {
  walletId: string
  name: string
  amount: string
}
interface WalletsData {
  currentByWallet: WalletCurrent[]
  bankVsCash: {
    bank: string
    cash: string
    savings: string
    other: string
  }
  historicalEvolution: { date: string; total: string }[]
  inflows: WalletFlowRow[]
  outflows: WalletFlowRow[]
  transfers: { count: number; total: string }
  withdrawals: {
    external: { count: number; total: string }
    internal: { count: number; total: string }
  }
  adjustments: { count: number; total: string }
}
interface CashWithdrawalsData {
  total: string
  byWallet: ByWalletRow[]
  count: number
}
interface TransfersData {
  total: string
  count: number
  bySource: (ByWalletRow & { count: number })[]
  byDest: (ByWalletRow & { count: number })[]
}
interface NetCashFlowData {
  income: string
  expenses: string
  net: string
  monthly: { month: string; income: string; expenses: string; net: string }[]
  savingsRate: number
}
interface AllocationClassificationRow {
  classification: string
  count: number
  amount: string
}
interface AllocationsData {
  referenceIncome: string
  totalActive: string
  totalPassive: string
  totalAllocated: string
  unallocated: string
  utilization: number
  available: string
  byClassification: AllocationClassificationRow[]
}
interface UpcomingInstallment {
  creditId: string
  creditName: string
  installmentNumber: number
  dueDate: string
  amount: string
  status: string
}
interface BankCreditsData {
  originalDebt: string
  totalRepaid: string
  outstanding: string
  progressPct: number
  upcomingInstallments: UpcomingInstallment[]
}
interface BorrowerProgress {
  loanId: string
  borrowerName: string
  lent: string
  repaid: string
  outstanding: string
  progressPct: number
}
interface PersonalLoansData {
  totalLent: string
  totalRepaid: string
  outstanding: string
  progressPct: number
  progressByBorrower: BorrowerProgress[]
}
interface GoalYearRow {
  year: number
  count: number
  completed: number
  overallProgress: number
}
interface GoalCategoryRow {
  categoryName: string
  color: string
  count: number
  avgProgress: number
}
interface GoalsData {
  progressByYear: GoalYearRow[]
  completionRate: number
  totalGoals: number
  completedGoals: number
  budgetProgress: { required: string; saved: string; remaining: string }
  categoryComparison: GoalCategoryRow[]
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const FILTER_OPTIONS: { value: PeriodFilter; labelKey: string }[] = [
  { value: 'today', labelKey: 'common.today' },
  { value: 'this_week', labelKey: 'common.thisWeek' },
  { value: 'this_month', labelKey: 'common.thisMonth' },
  { value: 'this_year', labelKey: 'common.thisYear' },
  { value: 'all_time', labelKey: 'common.allTime' },
  { value: 'custom_range', labelKey: 'common.customRange' },
]

const SECTION_TABS: { value: AnalyticsSection; labelKey: string }[] = [
  { value: 'income', labelKey: 'analytics.income' },
  { value: 'expenses', labelKey: 'analytics.expenses' },
  { value: 'wallets', labelKey: 'analytics.wallets' },
  { value: 'cash_withdrawals', labelKey: 'analytics.cashWithdrawals' },
  { value: 'transfers', labelKey: 'analytics.transfers' },
  { value: 'net_cash_flow', labelKey: 'analytics.netCashFlow' },
  { value: 'allocations', labelKey: 'analytics.allocations' },
  { value: 'bank_credits', labelKey: 'analytics.bankCredits' },
  { value: 'personal_loans', labelKey: 'analytics.personalLoans' },
  { value: 'goals', labelKey: 'analytics.goals' },
]

const INCOME_COLOR = 'var(--income)'
const EXPENSE_COLOR = 'var(--expense)'
const WARNING_COLOR = 'var(--warning)'
const INFO_COLOR = 'var(--info)'
const MUTED_COLOR = 'var(--muted-foreground)'

const WALLET_TYPE_COLORS: Record<string, string> = {
  bank: 'var(--info)',
  cash: 'var(--warning)',
  savings: INCOME_COLOR,
  other: MUTED_COLOR,
}

function safeColor(c: string | null | undefined, fallback = MUTED_COLOR): string {
  if (!c) return fallback
  return c.startsWith('#') || c.startsWith('var(') || c.startsWith('rgb') ? c : fallback
}

function formatMonthLabel(month: string, locale: 'en' | 'fr'): string {
  // month comes as "YYYY-MM"
  const d = new Date(`${month}-01T00:00:00Z`)
  if (isNaN(d.getTime())) return month
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-US', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(d)
}

function formatTrendDate(iso: string, locale: 'en' | 'fr'): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-US', {
    month: 'short',
    day: 'numeric',
  }).format(d)
}

function formatYearLabel(year: number, locale: 'en' | 'fr'): string {
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-US', {
    year: 'numeric',
  }).format(new Date(Date.UTC(year, 0, 1)))
}

function asNumber(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

// ---------------------------------------------------------------------------
// Chart card wrapper & empty state
// ---------------------------------------------------------------------------

function ChartCard({
  title,
  children,
  className,
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function ChartEmpty({ noData }: { noData: string }) {
  return (
    <div className="flex h-[200px] items-center justify-center">
      <EmptyState title={noData} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

function AnalyticsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-[320px]" />
        <Skeleton className="h-[320px]" />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Period filter bar
// ---------------------------------------------------------------------------

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
            <label className="whitespace-nowrap text-xs text-muted-foreground">{t('common.from')}</label>
            <Input
              type="date"
              value={from}
              onChange={(e) => onFromChange(e.target.value)}
              className="h-8 w-[150px]"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="whitespace-nowrap text-xs text-muted-foreground">{t('common.to')}</label>
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
// Section: Income
// ---------------------------------------------------------------------------

function IncomeSection({ data, loading }: { data?: IncomeData; loading: boolean }) {
  const { t, money, locale } = useI18n()
  const noData = t('dash.noData')

  const monthly = useMemo<LineDatum[]>(
    () =>
      (data?.monthly ?? []).map((m) => ({
        label: formatMonthLabel(m.month, locale),
        value: asNumber(m.amount),
      })),
    [data?.monthly, locale]
  )
  const byCategory = useMemo<DonutDatum[]>(
    () =>
      (data?.byCategory ?? []).map((c) => ({
        name: c.name,
        value: asNumber(c.amount),
        color: safeColor(c.color),
      })),
    [data?.byCategory]
  )
  const byArticle = useMemo<HBarDatum[]>(
    () =>
      (data?.byArticle ?? []).map((a) => ({
        name: a.name,
        value: asNumber(a.amount),
        color: INCOME_COLOR,
      })),
    [data?.byArticle]
  )
  const byWallet = useMemo<HBarDatum[]>(
    () =>
      (data?.byWallet ?? []).map((w) => ({
        name: w.name,
        value: asNumber(w.amount),
        color: safeColor(w.color),
      })),
    [data?.byWallet]
  )

  const concentration = data?.sourceConcentration ?? 0

  if (loading) return <AnalyticsSkeleton />

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('common.total')}
          value={money(data?.total)}
          icon={TrendingUp}
          tone="income"
        />
        <StatCard
          label={t('analytics.average')}
          value={money(data?.average)}
          icon={CalendarClock}
          tone="default"
        />
        <StatCard
          label={t('analytics.largest')}
          value={data?.largest ? money(data.largest.amount) : money('0')}
          hint={data?.largest?.name ?? data?.largest?.categoryName ?? undefined}
          icon={Trophy}
          tone="info"
        />
        <StatCard
          label={t('analytics.savingsRate')}
          value={`${concentration.toFixed(1)}%`}
          hint={data?.byCategory?.[0]?.name ?? undefined}
          icon={Percent}
          tone="warning"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title={t('analytics.monthlyTrend')}>
          {monthly.length === 0 ? (
            <ChartEmpty noData={noData} />
          ) : (
            <MiniAreaChart
              data={monthly}
              height={260}
              color={INCOME_COLOR}
              formatValue={(v) => money(v)}
            />
          )}
        </ChartCard>

        <ChartCard title={t('analytics.byCategory')}>
          {byCategory.length === 0 ? (
            <ChartEmpty noData={noData} />
          ) : (
            <div className="flex items-center justify-center py-2">
              <MiniDonutChart
                data={byCategory}
                size={180}
                thickness={28}
                centerLabel={t('common.total')}
                centerValue={money(data?.total)}
                formatValue={(v) => money(v)}
              />
            </div>
          )}
        </ChartCard>

        <ChartCard title={t('analytics.byArticle')}>
          {byArticle.length === 0 ? (
            <ChartEmpty noData={noData} />
          ) : (
            <MiniHBarChart
              data={byArticle}
              height={260}
              formatValue={(v) => money(v)}
            />
          )}
        </ChartCard>

        <ChartCard title={t('analytics.byWallet')}>
          {byWallet.length === 0 ? (
            <ChartEmpty noData={noData} />
          ) : (
            <MiniHBarChart
              data={byWallet}
              height={260}
              formatValue={(v) => money(v)}
            />
          )}
        </ChartCard>
      </div>

      {/* Source concentration */}
      <ChartCard title={`${t('analytics.savingsRate')} — ${data?.byCategory?.[0]?.name ?? '—'}`}>
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">
              {data?.byCategory?.[0]?.name ?? '—'}
            </span>
            <span className="text-lg font-semibold tabular-nums text-income">
              {concentration.toFixed(1)}%
            </span>
          </div>
          <Progress value={concentration} className="h-3" />
        </div>
      </ChartCard>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section: Expenses
// ---------------------------------------------------------------------------

function ExpensesSection({ data, loading }: { data?: ExpenseData; loading: boolean }) {
  const { t, money, locale } = useI18n()
  const noData = t('dash.noData')

  const monthly = useMemo<LineDatum[]>(
    () =>
      (data?.monthly ?? []).map((m) => ({
        label: formatMonthLabel(m.month, locale),
        value: asNumber(m.amount),
      })),
    [data?.monthly, locale]
  )
  const byCategory = useMemo<DonutDatum[]>(
    () =>
      (data?.byCategory ?? []).map((c) => ({
        name: c.name,
        value: asNumber(c.amount),
        color: safeColor(c.color),
      })),
    [data?.byCategory]
  )
  const byArticle = useMemo<HBarDatum[]>(
    () =>
      (data?.byArticle ?? []).map((a) => ({
        name: a.name,
        value: asNumber(a.amount),
        color: EXPENSE_COLOR,
      })),
    [data?.byArticle]
  )
  const byWallet = useMemo<HBarDatum[]>(
    () =>
      (data?.byWallet ?? []).map((w) => ({
        name: w.name,
        value: asNumber(w.amount),
        color: safeColor(w.color),
      })),
    [data?.byWallet]
  )

  if (loading) return <AnalyticsSkeleton />

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('common.total')}
          value={money(data?.total)}
          icon={TrendingDown}
          tone="expense"
        />
        <StatCard
          label={t('analytics.average')}
          value={money(data?.average)}
          icon={CalendarClock}
          tone="default"
        />
        <StatCard
          label={t('analytics.largest')}
          value={data?.largest ? money(data.largest.amount) : money('0')}
          hint={data?.largest?.name ?? data?.largest?.categoryName ?? undefined}
          icon={Trophy}
          tone="warning"
        />
        <StatCard
          label={t('analytics.savingsRate')}
          value={`${(data?.savingsRate ?? 0).toFixed(1)}%`}
          icon={Percent}
          tone="info"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title={t('analytics.monthlyTrend')}>
          {monthly.length === 0 ? (
            <ChartEmpty noData={noData} />
          ) : (
            <MiniAreaChart
              data={monthly}
              height={260}
              color={EXPENSE_COLOR}
              formatValue={(v) => money(v)}
            />
          )}
        </ChartCard>

        <ChartCard title={t('analytics.byCategory')}>
          {byCategory.length === 0 ? (
            <ChartEmpty noData={noData} />
          ) : (
            <div className="flex items-center justify-center py-2">
              <MiniDonutChart
                data={byCategory}
                size={180}
                thickness={28}
                centerLabel={t('common.total')}
                centerValue={money(data?.total)}
                formatValue={(v) => money(v)}
              />
            </div>
          )}
        </ChartCard>

        <ChartCard title={t('analytics.byArticle')}>
          {byArticle.length === 0 ? (
            <ChartEmpty noData={noData} />
          ) : (
            <MiniHBarChart
              data={byArticle}
              height={260}
              formatValue={(v) => money(v)}
            />
          )}
        </ChartCard>

        <ChartCard title={t('analytics.byWallet')}>
          {byWallet.length === 0 ? (
            <ChartEmpty noData={noData} />
          ) : (
            <MiniHBarChart
              data={byWallet}
              height={260}
              formatValue={(v) => money(v)}
            />
          )}
        </ChartCard>
      </div>

      {data?.budgetComparison && data.budgetComparison.hasBudgets === false && (
        <ChartCard title={t('dash.budgetUsage')}>
          <div className="text-sm text-muted-foreground py-6 text-center">
            {data.budgetComparison.message ?? t('dash.noData')}
          </div>
        </ChartCard>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section: Wallets
// ---------------------------------------------------------------------------

function WalletsSection({ data, loading }: { data?: WalletsData; loading: boolean }) {
  const { t, money, locale } = useI18n()
  const noData = t('dash.noData')

  const currentByWallet = useMemo<HBarDatum[]>(
    () =>
      (data?.currentByWallet ?? []).map((w) => ({
        name: w.name,
        value: asNumber(w.balance),
        color: safeColor(w.color, WALLET_TYPE_COLORS[w.type] ?? MUTED_COLOR),
      })),
    [data?.currentByWallet]
  )

  const bankVsCash = useMemo<DonutDatum[]>(() => {
    const d = data?.bankVsCash
    return [
      { name: t('wal.bank') || 'Bank', value: asNumber(d?.bank), color: WALLET_TYPE_COLORS.bank },
      { name: t('wal.cash') || 'Cash', value: asNumber(d?.cash), color: WALLET_TYPE_COLORS.cash },
      { name: t('wal.savings') || 'Savings', value: asNumber(d?.savings), color: WALLET_TYPE_COLORS.savings },
      { name: t('common.type') || 'Other', value: asNumber(d?.other), color: WALLET_TYPE_COLORS.other },
    ].filter((row) => row.value !== 0)
  }, [data?.bankVsCash, t])

  const evolution = useMemo<LineDatum[]>(
    () =>
      (data?.historicalEvolution ?? []).map((e) => ({
        label: formatTrendDate(e.date, locale),
        value: asNumber(e.total),
      })),
    [data?.historicalEvolution, locale]
  )

  const flows = useMemo<BarDatum[]>(() => {
    const inflows = (data?.inflows ?? []).map((w) => ({
      name: w.name,
      inflow: asNumber(w.amount),
      outflow: 0,
    }))
    const outflows = (data?.outflows ?? []).map((w) => ({
      name: w.name,
      inflow: 0,
      outflow: asNumber(w.amount),
    }))
    const merged = new Map<string, { name: string; inflow: number; outflow: number }>()
    for (const r of [...inflows, ...outflows]) {
      const cur = merged.get(r.name) ?? { name: r.name, inflow: 0, outflow: 0 }
      cur.inflow += r.inflow
      cur.outflow += r.outflow
      merged.set(r.name, cur)
    }
    return Array.from(merged.values()).map((r) => ({
      label: r.name,
      values: [
        { value: r.inflow, color: INCOME_COLOR, name: t('analytics.income') },
        { value: r.outflow, color: EXPENSE_COLOR, name: t('analytics.expenses') },
      ],
    }))
  }, [data?.inflows, data?.outflows, t])

  if (loading) return <AnalyticsSkeleton />

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('common.balance')}
          value={money(
            (data?.currentByWallet ?? [])
              .reduce((acc, w) => acc + asNumber(w.balance), 0)
              .toFixed(2)
          )}
          icon={WalletIcon}
          tone="default"
        />
        <StatCard
          label={t('wal.bank')}
          value={money(data?.bankVsCash?.bank)}
          icon={Banknote}
          tone="info"
        />
        <StatCard
          label={t('wal.cash')}
          value={money(data?.bankVsCash?.cash)}
          icon={Coins}
          tone="warning"
        />
        <StatCard
          label={t('wal.savings')}
          value={money(data?.bankVsCash?.savings)}
          icon={PiggyBank}
          tone="income"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title={t('analytics.byWallet')}>
          {currentByWallet.length === 0 ? (
            <ChartEmpty noData={noData} />
          ) : (
            <MiniHBarChart
              data={currentByWallet}
              height={300}
              formatValue={(v) => money(v)}
            />
          )}
        </ChartCard>

        <ChartCard title={t('analytics.byCategory')}>
          {bankVsCash.length === 0 ? (
            <ChartEmpty noData={noData} />
          ) : (
            <div className="flex items-center justify-center py-2">
              <MiniDonutChart
                data={bankVsCash}
                size={180}
                thickness={28}
                centerLabel={t('common.balance')}
                centerValue={money(
                  (data?.currentByWallet ?? [])
                    .reduce((acc, w) => acc + asNumber(w.balance), 0)
                    .toFixed(2)
                )}
                formatValue={(v) => money(v)}
              />
            </div>
          )}
        </ChartCard>

        <ChartCard title={t('analytics.historicalBalance')}>
          {evolution.length === 0 ? (
            <ChartEmpty noData={noData} />
          ) : (
            <MiniAreaChart
              data={evolution}
              height={300}
              color={INFO_COLOR}
              formatValue={(v) => money(v)}
            />
          )}
        </ChartCard>

        <ChartCard title={t('analytics.inflowsOutflows')}>
          {flows.length === 0 ? (
            <ChartEmpty noData={noData} />
          ) : (
            <MiniBarChart
              data={flows}
              height={300}
              formatValue={(v) => money(v)}
            />
          )}
        </ChartCard>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section: Cash Withdrawals
// ---------------------------------------------------------------------------

function CashWithdrawalsSection({ data, loading }: { data?: CashWithdrawalsData; loading: boolean }) {
  const { t, money } = useI18n()
  const noData = t('dash.noData')

  const byWallet = useMemo<HBarDatum[]>(
    () =>
      (data?.byWallet ?? []).map((w) => ({
        name: w.name,
        value: asNumber(w.amount),
        color: safeColor(w.color, WARNING_COLOR),
      })),
    [data?.byWallet]
  )

  if (loading) return <AnalyticsSkeleton />

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label={t('common.total')}
          value={money(data?.total)}
          icon={ArrowDownToLine}
          tone="warning"
        />
        <StatCard
          label={t('tx.count')}
          value={String(data?.count ?? 0)}
          icon={Hash}
          tone="default"
        />
        <StatCard
          label={t('analytics.average')}
          value={money(
            data && data.count > 0
              ? (asNumber(data.total) / data.count).toFixed(2)
              : '0'
          )}
          icon={CalendarClock}
          tone="info"
        />
      </div>

      <ChartCard title={t('analytics.byWallet')}>
        {byWallet.length === 0 ? (
          <ChartEmpty noData={noData} />
        ) : (
          <MiniHBarChart
            data={byWallet}
            height={300}
            formatValue={(v) => money(v)}
          />
        )}
      </ChartCard>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section: Transfers
// ---------------------------------------------------------------------------

function TransfersSection({ data, loading }: { data?: TransfersData; loading: boolean }) {
  const { t, money } = useI18n()
  const noData = t('dash.noData')

  const bySource = useMemo<HBarDatum[]>(
    () =>
      (data?.bySource ?? []).map((w) => ({
        name: w.name,
        value: asNumber(w.amount),
        color: safeColor(w.color, EXPENSE_COLOR),
      })),
    [data?.bySource]
  )
  const byDest = useMemo<HBarDatum[]>(
    () =>
      (data?.byDest ?? []).map((w) => ({
        name: w.name,
        value: asNumber(w.amount),
        color: safeColor(w.color, INCOME_COLOR),
      })),
    [data?.byDest]
  )

  if (loading) return <AnalyticsSkeleton />

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label={t('common.total')}
          value={money(data?.total)}
          icon={ArrowLeftRight}
          tone="default"
        />
        <StatCard
          label={t('tx.count')}
          value={String(data?.count ?? 0)}
          icon={Hash}
          tone="info"
        />
        <StatCard
          label={t('analytics.average')}
          value={money(
            data && data.count > 0
              ? (asNumber(data.total) / data.count).toFixed(2)
              : '0'
          )}
          icon={CalendarClock}
          tone="default"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title={`${t('analytics.byWallet')} — ${t('transfer.source')}`}>
          {bySource.length === 0 ? (
            <ChartEmpty noData={noData} />
          ) : (
            <MiniHBarChart
              data={bySource}
              height={260}
              formatValue={(v) => money(v)}
            />
          )}
        </ChartCard>

        <ChartCard title={`${t('analytics.byWallet')} — ${t('common.to')}`}>
          {byDest.length === 0 ? (
            <ChartEmpty noData={noData} />
          ) : (
            <MiniHBarChart
              data={byDest}
              height={260}
              formatValue={(v) => money(v)}
            />
          )}
        </ChartCard>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section: Net Cash Flow
// ---------------------------------------------------------------------------

function NetCashFlowSection({ data, loading }: { data?: NetCashFlowData; loading: boolean }) {
  const { t, money, locale, num } = useI18n()
  const noData = t('dash.noData')

  const monthly = useMemo<BarDatum[]>(
    () =>
      (data?.monthly ?? []).map((m) => ({
        label: formatMonthLabel(m.month, locale),
        values: [
          { value: asNumber(m.income), color: INCOME_COLOR, name: t('analytics.income') },
          { value: asNumber(m.expenses), color: EXPENSE_COLOR, name: t('analytics.expenses') },
          { value: asNumber(m.net), color: INFO_COLOR, name: t('analytics.netCashFlow') },
        ],
      })),
    [data?.monthly, locale, t]
  )
  const netTrend = useMemo<LineDatum[]>(
    () =>
      (data?.monthly ?? []).map((m) => ({
        label: formatMonthLabel(m.month, locale),
        value: asNumber(m.net),
      })),
    [data?.monthly, locale]
  )

  if (loading) return <AnalyticsSkeleton />

  const netTone = data ? (asNumber(data.net) > 0 ? 'income' : asNumber(data.net) < 0 ? 'expense' : 'default') : 'default'

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('analytics.income')}
          value={money(data?.income)}
          icon={TrendingUp}
          tone="income"
        />
        <StatCard
          label={t('analytics.expenses')}
          value={money(data?.expenses)}
          icon={TrendingDown}
          tone="expense"
        />
        <StatCard
          label={t('analytics.netCashFlow')}
          value={money(data?.net)}
          icon={Scale}
          tone={netTone}
        />
        <StatCard
          label={t('analytics.savingsRate')}
          value={`${(data?.savingsRate ?? 0).toFixed(1)}%`}
          icon={Percent}
          tone="info"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title={t('analytics.monthlyTrend')}>
          {monthly.length === 0 ? (
            <ChartEmpty noData={noData} />
          ) : (
            <MiniBarChart
              data={monthly}
              height={300}
              formatValue={(v) => money(v)}
            />
          )}
        </ChartCard>

        <ChartCard title={t('analytics.netCashFlow')}>
          {netTrend.length === 0 ? (
            <ChartEmpty noData={noData} />
          ) : (
            <MiniAreaChart
              data={netTrend}
              height={300}
              color={INFO_COLOR}
              formatValue={(v) => money(v)}
            />
          )}
        </ChartCard>
      </div>

      <ChartCard title={`${t('analytics.savingsRate')} — ${num(data?.savingsRate ?? 0)}%`}>
        <Progress value={data?.savingsRate ?? 0} className="h-3" />
      </ChartCard>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section: Allocations
// ---------------------------------------------------------------------------

function AllocationsSection({ data, loading }: { data?: AllocationsData; loading: boolean }) {
  const { t, money } = useI18n()
  const noData = t('dash.noData')

  const byClassification = useMemo<DonutDatum[]>(() => {
    const palette = [INCOME_COLOR, EXPENSE_COLOR, WARNING_COLOR, INFO_COLOR, MUTED_COLOR]
    return (data?.byClassification ?? []).map((c, i) => ({
      name: c.classification,
      value: asNumber(c.amount),
      color: palette[i % palette.length],
    }))
  }, [data?.byClassification])

  // Compute new derived metrics client-side:
  //   Available capacity = total actives - total passives
  //   Utilization = % of total passive from total actives
  const activeCents = toCents(data?.totalActive ?? '0')
  const passiveCents = toCents(data?.totalPassive ?? '0')
  const availableCents = activeCents - passiveCents
  const availableAmount = availableCents / 100
  const utilizationPct = activeCents > 0 ? (passiveCents / activeCents) * 100 : 0

  if (loading) return <AnalyticsSkeleton />

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('alloc.totalActive')}
          value={money(data?.totalActive)}
          icon={TrendingUp}
          tone="income"
        />
        <StatCard
          label={t('alloc.totalPassive')}
          value={money(data?.totalPassive)}
          icon={TrendingDown}
          tone="expense"
        />
        <StatCard
          label={t('alloc.utilization')}
          value={`${utilizationPct.toFixed(1)}%`}
          icon={Percent}
          tone={utilizationPct > 100 ? 'warning' : 'default'}
        />
        <StatCard
          label={t('alloc.available')}
          value={money(availableAmount)}
          icon={Landmark}
          tone={availableCents >= 0 ? 'info' : 'expense'}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title={`${t('alloc.utilization')} — ${utilizationPct.toFixed(1)}%`}>
          <Progress value={utilizationPct} className="h-4" />
        </ChartCard>

        <ChartCard title={t('analytics.byCategory')}>
          {byClassification.length === 0 ? (
            <ChartEmpty noData={noData} />
          ) : (
            <div className="flex items-center justify-center py-2">
              <MiniDonutChart
                data={byClassification}
                size={180}
                thickness={28}
                centerLabel={t('alloc.totalActive')}
                centerValue={money(data?.totalActive)}
                formatValue={(v) => money(v)}
              />
            </div>
          )}
        </ChartCard>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section: Bank Credits
// ---------------------------------------------------------------------------

function BankCreditsSection({ data, loading }: { data?: BankCreditsData; loading: boolean }) {
  const { t, money, date: fmtDate } = useI18n()
  const noData = t('dash.noData')

  if (loading) return <AnalyticsSkeleton />

  const installments = data?.upcomingInstallments ?? []

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('credit.originalPrincipal')}
          value={money(data?.originalDebt)}
          icon={CreditCard}
          tone="default"
        />
        <StatCard
          label={t('credit.totalRepaid')}
          value={money(data?.totalRepaid)}
          icon={TrendingUp}
          tone="income"
        />
        <StatCard
          label={t('credit.outstanding')}
          value={money(data?.outstanding)}
          icon={TrendingDown}
          tone="expense"
        />
        <StatCard
          label={t('common.progress')}
          value={`${(data?.progressPct ?? 0).toFixed(1)}%`}
          icon={Percent}
          tone="info"
        />
      </div>

      <ChartCard title={`${t('common.progress')} — ${(data?.progressPct ?? 0).toFixed(1)}%`}>
        <Progress value={data?.progressPct ?? 0} className="h-4" />
      </ChartCard>

      <ChartCard title={t('dash.upcomingInstallments')}>
        {installments.length === 0 ? (
          <ChartEmpty noData={noData} />
        ) : (
          <ScrollArea className="max-h-96">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common.date')}</TableHead>
                  <TableHead>{t('credit.creditName')}</TableHead>
                  <TableHead className="text-right">#</TableHead>
                  <TableHead className="text-right">{t('common.amount')}</TableHead>
                  <TableHead className="text-right">{t('common.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {installments.map((ins, i) => (
                  <TableRow key={`${ins.creditId}-${ins.installmentNumber}-${i}`}>
                    <TableCell className="whitespace-nowrap">{fmtDate(ins.dueDate)}</TableCell>
                    <TableCell className="font-medium">{ins.creditName}</TableCell>
                    <TableCell className="text-right tabular-nums">{ins.installmentNumber}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(ins.amount)}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline" className="capitalize">
                        {ins.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </ChartCard>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section: Personal Loans
// ---------------------------------------------------------------------------

function PersonalLoansSection({ data, loading }: { data?: PersonalLoansData; loading: boolean }) {
  const { t, money } = useI18n()
  const noData = t('dash.noData')

  const byBorrower = data?.progressByBorrower ?? []

  if (loading) return <AnalyticsSkeleton />

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('loan.totalLent')}
          value={money(data?.totalLent)}
          icon={HandCoins}
          tone="income"
        />
        <StatCard
          label={t('loan.totalRepaid')}
          value={money(data?.totalRepaid)}
          icon={TrendingUp}
          tone="default"
        />
        <StatCard
          label={t('loan.outstanding')}
          value={money(data?.outstanding)}
          icon={TrendingDown}
          tone="expense"
        />
        <StatCard
          label={t('common.progress')}
          value={`${(data?.progressPct ?? 0).toFixed(1)}%`}
          icon={Percent}
          tone="info"
        />
      </div>

      <ChartCard title={t('loan.borrower')}>
        {byBorrower.length === 0 ? (
          <ChartEmpty noData={noData} />
        ) : (
          <ScrollArea className="max-h-96">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('loan.borrower')}</TableHead>
                  <TableHead className="text-right">{t('loan.totalLent')}</TableHead>
                  <TableHead className="text-right">{t('loan.totalRepaid')}</TableHead>
                  <TableHead className="text-right">{t('loan.outstanding')}</TableHead>
                  <TableHead className="w-[160px]">{t('common.progress')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byBorrower.map((b) => (
                  <TableRow key={b.loanId}>
                    <TableCell className="font-medium">{b.borrowerName}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(b.lent)}</TableCell>
                    <TableCell className="text-right tabular-nums text-income">{money(b.repaid)}</TableCell>
                    <TableCell className="text-right tabular-nums text-expense">{money(b.outstanding)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress value={b.progressPct} className="h-2 flex-1" />
                        <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
                          {b.progressPct.toFixed(0)}%
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </ChartCard>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section: Goals
// ---------------------------------------------------------------------------

function GoalsSection({ data, loading }: { data?: GoalsData; loading: boolean }) {
  const { t, money, locale, num } = useI18n()
  const noData = t('dash.noData')

  const byYear = useMemo<BarDatum[]>(
    () =>
      (data?.progressByYear ?? []).map((y) => ({
        label: formatYearLabel(y.year, locale),
        values: [{ value: y.overallProgress, color: INCOME_COLOR, name: t('common.progress') }],
      })),
    [data?.progressByYear, locale, t]
  )

  const categoryComparison = useMemo<HBarDatum[]>(
    () =>
      (data?.categoryComparison ?? []).map((c) => ({
        name: c.categoryName,
        value: c.avgProgress,
        color: safeColor(c.color),
      })),
    [data?.categoryComparison]
  )

  if (loading) return <AnalyticsSkeleton />

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('goal.requiredTotal')}
          value={money(data?.budgetProgress?.required)}
          icon={Target}
          tone="default"
        />
        <StatCard
          label={t('goal.savedTotal')}
          value={money(data?.budgetProgress?.saved)}
          icon={TrendingUp}
          tone="income"
        />
        <StatCard
          label={t('goal.remainingTotal')}
          value={money(data?.budgetProgress?.remaining)}
          icon={TrendingDown}
          tone="warning"
        />
        <StatCard
          label={t('analytics.savingsRate')}
          value={`${(data?.completionRate ?? 0).toFixed(1)}%`}
          hint={
            data
              ? `${num(data.completedGoals)} / ${num(data.totalGoals)}`
              : undefined
          }
          icon={Trophy}
          tone="info"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title={t('analytics.yearlyTrend')}>
          {byYear.length === 0 ? (
            <ChartEmpty noData={noData} />
          ) : (
            <MiniBarChart
              data={byYear}
              height={300}
              formatValue={(v) => `${num(v)}%`}
            />
          )}
        </ChartCard>

        <ChartCard title={t('analytics.byCategory')}>
          {categoryComparison.length === 0 ? (
            <ChartEmpty noData={noData} />
          ) : (
            <MiniHBarChart
              data={categoryComparison}
              height={300}
              formatValue={(v) => `${num(v)}%`}
            />
          )}
        </ChartCard>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section router
// ---------------------------------------------------------------------------

interface SectionProps {
  section: AnalyticsSection
  filter: PeriodFilter
  from: string
  to: string
}

function SectionLoader({ section, filter, from, to }: SectionProps) {
  const api = useApi()
  const { t } = useI18n()
  const noData = t('dash.noData')

  const enabled = filter !== 'custom_range' || (!!from && !!to)

  const queryKey = useMemo(
    () => ['analytics', filter, from, to, section] as const,
    [filter, from, to, section]
  )

  const { data, isLoading } = useQuery<Record<string, unknown>>({
    queryKey,
    queryFn: () =>
      api.get<Record<string, unknown>>('/api/analytics', {
        query: {
          filter,
          ...(filter === 'custom_range' && from ? { from } : {}),
          ...(filter === 'custom_range' && to ? { to } : {}),
          section,
        },
      }),
    enabled,
  })

  const sectionData = data?.[section]

  if (!enabled) {
    return (
      <div className="flex h-[200px] items-center justify-center">
        <EmptyState title={t('common.apply')} description={`${t('common.from')} / ${t('common.to')}`} />
      </div>
    )
  }

  if (isLoading) return <AnalyticsSkeleton />
  if (!sectionData) {
    return (
      <div className="flex h-[200px] items-center justify-center">
        <EmptyState title={noData} />
      </div>
    )
  }

  switch (section) {
    case 'income':
      return <IncomeSection data={sectionData as IncomeData} loading={false} />
    case 'expenses':
      return <ExpensesSection data={sectionData as ExpenseData} loading={false} />
    case 'wallets':
      return <WalletsSection data={sectionData as WalletsData} loading={false} />
    case 'cash_withdrawals':
      return <CashWithdrawalsSection data={sectionData as CashWithdrawalsData} loading={false} />
    case 'transfers':
      return <TransfersSection data={sectionData as TransfersData} loading={false} />
    case 'net_cash_flow':
      return <NetCashFlowSection data={sectionData as NetCashFlowData} loading={false} />
    case 'allocations':
      return <AllocationsSection data={sectionData as AllocationsData} loading={false} />
    case 'bank_credits':
      return <BankCreditsSection data={sectionData as BankCreditsData} loading={false} />
    case 'personal_loans':
      return <PersonalLoansSection data={sectionData as PersonalLoansData} loading={false} />
    case 'goals':
      return <GoalsSection data={sectionData as GoalsData} loading={false} />
    default:
      return (
        <div className="flex h-[200px] items-center justify-center">
          <EmptyState title={noData} />
        </div>
      )
  }
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function AnalyticsView() {
  const { t } = useI18n()
  const [filter, setFilter] = useState<PeriodFilter>('this_month')
  const [from, setFrom] = useState<string>('')
  const [to, setTo] = useState<string>('')
  const [activeSection, setActiveSection] = useState<AnalyticsSection>('income')

  return (
    <div className="space-y-6">
      <PageHeader title={t('analytics.title')} />

      <PeriodFilterBar
        filter={filter}
        from={from}
        to={to}
        onFilterChange={setFilter}
        onFromChange={setFrom}
        onToChange={setTo}
      />

      <Tabs
        value={activeSection}
        onValueChange={(v) => setActiveSection(v as AnalyticsSection)}
        className="space-y-4"
      >
        <ScrollArea className="w-full">
          <TabsList className="flex w-max">
            {SECTION_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {t(tab.labelKey)}
              </TabsTrigger>
            ))}
          </TabsList>
        </ScrollArea>

        {SECTION_TABS.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            <SectionLoader section={tab.value} filter={filter} from={from} to={to} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
