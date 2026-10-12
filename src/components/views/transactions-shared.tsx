'use client'

import { useMemo, useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Plus,
  Download,
  Search,
  Eye,
  Pencil,
  Trash2,
  MoreHorizontal,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  TrendingUp,
  TrendingDown,
  Hash,
  Calculator,
} from 'lucide-react'

import { useI18n } from '@/lib/use-i18n'
import { useApi } from '@/lib/use-api'
import { toCents, fromCents, toLocalDateString } from '@/lib/money'
import { cn } from '@/lib/utils'

import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  PaginationEllipsis,
} from '@/components/ui/pagination'
import { EmptyState, PageHeader, MoneyText } from '@/components/shared'
import { ConfirmDialog } from '@/components/confirm-dialog'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TxnKind = 'income' | 'expense'

type PeriodFilter =
  | 'today'
  | 'this_week'
  | 'this_month'
  | 'this_year'
  | 'all_time'
  | 'custom_range'

type SortKey = 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc'

interface TxnCategory {
  id: string
  name: string
  color: string | null
}
interface TxnArticle {
  id: string
  name: string
  defaultAmount: string | null
  defaultCategoryId: string | null
  defaultCategory?: TxnCategory | null
}
interface TxnWallet {
  id: string
  name: string
  type: string
  color: string | null
  balance: string
  active: boolean
}
interface TxnRow {
  id: string
  name: string
  amount: string
  financialDate: string
  comment: string | null
  createdAt: string
  updatedAt: string
  categoryId: string | null
  category: TxnCategory | null
  articleId: string | null
  article: { id: string; name: string } | null
  walletId: string
  wallet: TxnWallet
}
interface TxnListResponse {
  items: TxnRow[]
  total: number
  page: number
  pageSize: number
}

interface TransactionsViewProps {
  kind: TxnKind
}

const PAGE_SIZE = 10
const ALL = 'all'

// ---------------------------------------------------------------------------
// Date helpers — produce YYYY-MM-DD strings the backend can parse via parseLocalDate.
// ---------------------------------------------------------------------------

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function periodToRange(
  period: PeriodFilter,
  customFrom?: string,
  customTo?: string,
): { from?: string; to?: string } {
  const today = new Date()
  const y = today.getFullYear()
  const m = today.getMonth()
  const d = today.getDate()
  switch (period) {
    case 'today': {
      const t = fmtDate(today)
      return { from: t, to: t }
    }
    case 'this_week': {
      // Monday-based week (Sunday = end of week)
      const dow = today.getDay() // 0 = Sunday, 1 = Monday …
      const offset = dow === 0 ? -6 : 1 - dow
      const monday = new Date(y, m, d + offset)
      const sunday = new Date(y, m, d + offset + 6)
      return { from: fmtDate(monday), to: fmtDate(sunday) }
    }
    case 'this_month': {
      return { from: fmtDate(new Date(y, m, 1)), to: fmtDate(new Date(y, m + 1, 0)) }
    }
    case 'this_year': {
      return { from: `${y}-01-01`, to: `${y}-12-31` }
    }
    case 'all_time':
      return {}
    case 'custom_range':
      return {
        from: customFrom || undefined,
        to: customTo || undefined,
      }
  }
}

function todayLocal(): string {
  return toLocalDateString(new Date())
}

function clampPage(p: number, totalPages: number): number {
  if (p < 1) return 1
  if (p > totalPages) return totalPages
  return p
}

function buildPageList(current: number, totalPages: number): (number | 'ellipsis')[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  const pages: (number | 'ellipsis')[] = [1]
  const left = Math.max(2, current - 1)
  const right = Math.min(totalPages - 1, current + 1)
  if (left > 2) pages.push('ellipsis')
  for (let i = left; i <= right; i++) pages.push(i)
  if (right < totalPages - 1) pages.push('ellipsis')
  pages.push(totalPages)
  return pages
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TransactionsView({ kind }: TransactionsViewProps) {
  const { t, money, num, date } = useI18n()
  const api = useApi()
  const qc = useQueryClient()

  const apiBase = kind === 'income' ? '/api/income' : '/api/expenses'
  const exportUrl = kind === 'income' ? '/api/income/export' : '/api/expenses/export'
  const toneTextCls = kind === 'income' ? 'text-income' : 'text-expense'
  const toneBgCls = kind === 'income' ? 'bg-income/10' : 'bg-expense/10'
  const walletFieldLabel =
    kind === 'income' ? t('income.destinationWallet') : t('expense.sourceWallet')
  const TitleIcon = kind === 'income' ? TrendingUp : TrendingDown

  // ---- Filter state ----
  const [search, setSearch] = useState('')
  const [walletId, setWalletId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [articleId, setArticleId] = useState('')
  const [period, setPeriod] = useState<PeriodFilter>('this_month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<SortKey>('date_desc')

  // ---- Dialog state ----
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<TxnRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TxnRow | null>(null)

  // ---- Form state ----
  const [formName, setFormName] = useState('')
  const [formArticleId, setFormArticleId] = useState('')
  const [formCategoryId, setFormCategoryId] = useState('')
  const [formAmount, setFormAmount] = useState('')
  const [formWalletId, setFormWalletId] = useState('')
  const [formDate, setFormDate] = useState(todayLocal())
  const [formComment, setFormComment] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // ---- Filter derivation ----
  const range = useMemo(
    () => periodToRange(period, customFrom, customTo),
    [period, customFrom, customTo],
  )

  const filterParams = useMemo(
    () => ({
      search: search.trim() || undefined,
      walletId: walletId || undefined,
      categoryId: categoryId || undefined,
      articleId: articleId || undefined,
      from: range.from,
      to: range.to,
      page,
      pageSize: PAGE_SIZE,
      sort,
    }),
    [search, walletId, categoryId, articleId, range.from, range.to, page, sort],
  )

  // ---- Data queries ----
  const listQuery = useQuery<TxnListResponse>({
    queryKey: [kind, 'list', filterParams],
    queryFn: () => api.get<TxnListResponse>(apiBase, { query: filterParams }),
  })

  const walletsQuery = useQuery<{ wallets: TxnWallet[] }>({
    queryKey: ['wallets'],
    queryFn: () => api.get<{ wallets: TxnWallet[] }>('/api/wallets'),
  })

  const categoriesQuery = useQuery<{ items: TxnCategory[] }>({
    queryKey: ['categories', kind],
    queryFn: () =>
      api.get<{ items: TxnCategory[] }>('/api/categories', { query: { type: kind } }),
  })

  const articlesQuery = useQuery<{ items: TxnArticle[] }>({
    queryKey: ['articles', kind],
    queryFn: () =>
      api.get<{ items: TxnArticle[] }>('/api/articles', { query: { type: kind } }),
  })

  // ---- Derived data ----
  const wallets = walletsQuery.data?.wallets ?? []
  const categories = categoriesQuery.data?.items ?? []
  const articles = articlesQuery.data?.items ?? []
  const rows = listQuery.data?.items ?? []
  const total = listQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const safePage = clampPage(page, totalPages)

  // ---- Summary stats over the *current page* of items ----
  // Note: backend does not return a period aggregate; we approximate by summing
  // the current page items. For the "average", we divide by the page count
  // (rows.length) so the displayed average matches what the user is looking at.
  // This matches user expectations for the visible list.
  const summary = useMemo(() => {
    let totalCents = 0
    for (const r of rows) totalCents += toCents(r.amount)
    const count = rows.length
    return {
      total: fromCents(totalCents),
      count,
      avg: count > 0 ? fromCents(Math.round(totalCents / count)) : '0.00',
    }
  }, [rows])

  // ---- Mutations ----
  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post(apiBase, body),
    onSuccess: () => {
      toast.success(t(`${kind}.created`))
      qc.invalidateQueries({ queryKey: [kind] })
      qc.invalidateQueries({ queryKey: ['wallets'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['analytics'] })
      setDialogOpen(false)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.put(`${apiBase}/${id}`, body),
    onSuccess: () => {
      toast.success(t(`${kind}.updated`))
      qc.invalidateQueries({ queryKey: [kind] })
      qc.invalidateQueries({ queryKey: ['wallets'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['analytics'] })
      setDialogOpen(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del(`${apiBase}/${id}`),
    onSuccess: () => {
      toast.success(t(`${kind}.deleted`))
      qc.invalidateQueries({ queryKey: [kind] })
      qc.invalidateQueries({ queryKey: ['wallets'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['analytics'] })
      setDeleteTarget(null)
    },
  })

  // ---- Dialog handlers ----
  const openCreate = () => {
    setEditing(null)
    setFormName('')
    setFormArticleId('')
    setFormCategoryId('')
    setFormAmount('')
    setFormWalletId(wallets[0]?.id ?? '')
    setFormDate(todayLocal())
    setFormComment('')
    setDialogOpen(true)
  }

  const openEdit = (row: TxnRow) => {
    setEditing(row)
    setFormName(row.name)
    setFormArticleId(row.articleId ?? '')
    setFormCategoryId(row.categoryId ?? '')
    setFormAmount(row.amount)
    setFormWalletId(row.walletId)
    setFormDate(
      row.financialDate ? toLocalDateString(row.financialDate) : todayLocal(),
    )
    setFormComment(row.comment ?? '')
    setDialogOpen(true)
  }

  const handleArticleChange = (newArticleId: string) => {
    setFormArticleId(newArticleId)
    const article = articles.find((a) => a.id === newArticleId)
    if (article) {
      if (article.defaultAmount) setFormAmount(article.defaultAmount)
      if (article.defaultCategoryId) setFormCategoryId(article.defaultCategoryId)
    }
  }

  const handleSubmit = async () => {
    if (!formName.trim()) {
      toast.error(`${t('common.required')}: ${t('common.name')}`)
      return
    }
    if (!formWalletId) {
      toast.error(`${t('common.required')}: ${t('common.wallet')}`)
      return
    }
    const amt = Number(formAmount)
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error(`${t('common.required')}: ${t('common.amount')}`)
      return
    }
    if (!formDate) {
      toast.error(`${t('common.required')}: ${t('common.date')}`)
      return
    }

    const body: Record<string, unknown> = {
      name: formName.trim(),
      amount: amt.toFixed(2),
      walletId: formWalletId,
      financialDate: formDate,
    }
    if (formArticleId) body.articleId = formArticleId
    if (formCategoryId) body.categoryId = formCategoryId
    if (formComment.trim()) body.comment = formComment.trim()

    setSubmitting(true)
    try {
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, body })
      } else {
        await createMutation.mutateAsync(body)
      }
    } catch {
      // useApi already toasted the error; keep dialog open so user can fix & retry.
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
    } catch {
      // useApi already toasted the error.
    }
  }

  // ---- Export CSV ----
  const handleExport = () => {
    const params = new URLSearchParams()
    if (range.from) params.set('from', range.from)
    if (range.to) params.set('to', range.to)
    if (walletId) params.set('walletId', walletId)
    if (categoryId) params.set('categoryId', categoryId)
    if (articleId) params.set('articleId', articleId)
    if (search.trim()) params.set('search', search.trim())
    const qs = params.toString()
    window.location.href = qs ? `${exportUrl}?${qs}` : exportUrl
  }

  // ---- Clear filters ----
  const clearFilters = () => {
    setSearch('')
    setWalletId('')
    setCategoryId('')
    setArticleId('')
    setPeriod('this_month')
    setCustomFrom('')
    setCustomTo('')
    setSort('date_desc')
    setPage(1)
  }

  // ---- Sort cycling ----
  const cycleDateSort = () =>
    setSort((s) => (s === 'date_desc' ? 'date_asc' : 'date_desc'))
  const cycleAmountSort = () =>
    setSort((s) => (s === 'amount_desc' ? 'amount_asc' : 'amount_desc'))

  // ---- Reset to page 1 whenever filters/sort change ----
  useEffect(() => {
    setPage(1)
  }, [search, walletId, categoryId, articleId, period, customFrom, customTo, sort])

  // ---- Auto-clamp page if we drifted past the last page (e.g. after a delete) ----
  useEffect(() => {
    if (total > 0 && page > totalPages) {
      setPage(totalPages)
    }
  }, [total, totalPages, page])

  const loading = listQuery.isLoading
  const hasWallets = wallets.length > 0
  const hasActiveFilters =
    !!search ||
    !!walletId ||
    !!categoryId ||
    !!articleId ||
    period !== 'this_month' ||
    !!customFrom ||
    !!customTo

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      <PageHeader
        title={t(`${kind}.title`)}
        actions={
          <>
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={loading || total === 0}
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">{t('common.exportCsv')}</span>
            </Button>
            <Button onClick={openCreate} disabled={!hasWallets}>
              <Plus className="h-4 w-4" />
              {t(`${kind}.add`)}
            </Button>
          </>
        }
      />

      {/* Filter bar */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <div className="space-y-1.5 xl:col-span-2">
              <Label htmlFor="txn-search" className="text-xs text-muted-foreground">
                {t('common.search')}
              </Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="txn-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('common.search')}
                  className="pl-8"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t('common.wallet')}</Label>
              <Select
                value={walletId || ALL}
                onValueChange={(v) => setWalletId(v === ALL ? '' : v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t('common.all')}</SelectItem>
                  {wallets.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t('common.category')}</Label>
              <Select
                value={categoryId || ALL}
                onValueChange={(v) => setCategoryId(v === ALL ? '' : v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t('common.all')}</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t('common.article')}</Label>
              <Select
                value={articleId || ALL}
                onValueChange={(v) => setArticleId(v === ALL ? '' : v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t('common.all')}</SelectItem>
                  {articles.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t('common.filter')}</Label>
              <Select value={period} onValueChange={(v) => setPeriod(v as PeriodFilter)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">{t('common.today')}</SelectItem>
                  <SelectItem value="this_week">{t('common.thisWeek')}</SelectItem>
                  <SelectItem value="this_month">{t('common.thisMonth')}</SelectItem>
                  <SelectItem value="this_year">{t('common.thisYear')}</SelectItem>
                  <SelectItem value="all_time">{t('common.allTime')}</SelectItem>
                  <SelectItem value="custom_range">{t('common.customRange')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {period === 'custom_range' && (
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="txn-from" className="text-xs text-muted-foreground">
                  {t('common.from')}
                </Label>
                <Input
                  id="txn-from"
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="w-full sm:w-44"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="txn-to" className="text-xs text-muted-foreground">
                  {t('common.to')}
                </Label>
                <Input
                  id="txn-to"
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="w-full sm:w-44"
                />
              </div>
            </div>
          )}

          <div className="mt-3 flex items-center justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              disabled={!hasActiveFilters}
            >
              {t('common.clearFilters')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className={cn('overflow-hidden', toneBgCls)}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('tx.total')}
              </p>
              <TitleIcon className={cn('h-4 w-4', toneTextCls)} />
            </div>
            <p className={cn('mt-2 text-2xl font-bold tabular-nums', toneTextCls)}>
              {money(summary.total)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('tx.count')}
              </p>
              <Hash className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums">
              {num(total)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('tx.results', { count: total })}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('tx.average')}
              </p>
              <Calculator className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums">
              {money(summary.avg)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Transactions table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={t(`${kind}.empty`)}
                action={
                  <Button onClick={openCreate} disabled={!hasWallets}>
                    <Plus className="h-4 w-4" />
                    {t(`${kind}.add`)}
                  </Button>
                }
              />
              {!hasWallets && (
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  {t('tx.noWallets')}
                </p>
              )}
            </div>
          ) : (
            <ScrollArea className="max-h-[600px] scrollbar-thin">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[120px] cursor-pointer select-none" onClick={cycleDateSort}>
                      <span className="inline-flex items-center gap-1">
                        {t('common.date')}
                        {sort === 'date_desc' ? (
                          <ArrowDown className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : sort === 'date_asc' ? (
                          <ArrowUp className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </span>
                    </TableHead>
                    <TableHead>{t('common.name')}</TableHead>
                    <TableHead>{t('common.category')}</TableHead>
                    <TableHead className="hidden md:table-cell">{t('common.article')}</TableHead>
                    <TableHead className="hidden sm:table-cell">{t('common.wallet')}</TableHead>
                    <TableHead
                      className="cursor-pointer select-none text-right"
                      onClick={cycleAmountSort}
                    >
                      <span className="inline-flex items-center gap-1">
                        {t('common.amount')}
                        {sort === 'amount_desc' ? (
                          <ArrowDown className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : sort === 'amount_asc' ? (
                          <ArrowUp className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </span>
                    </TableHead>
                    <TableHead className="hidden lg:table-cell">{t('common.comment')}</TableHead>
                    <TableHead className="w-[60px] text-right">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {date(r.financialDate)}
                      </TableCell>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell>
                        {r.category ? (
                          <Badge
                            variant="outline"
                            style={{
                              borderColor: r.category.color ?? undefined,
                              color: r.category.color ?? undefined,
                              backgroundColor: r.category.color
                                ? `${r.category.color}15`
                                : undefined,
                            }}
                          >
                            {r.category.name}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {r.article?.name ?? '—'}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <span className="inline-flex items-center gap-2 text-sm">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: r.wallet.color ?? '#888' }}
                            aria-hidden
                          />
                          {r.wallet.name}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <MoneyText value={r.amount} tone={kind} className="text-sm" />
                      </TableCell>
                      <TableCell className="hidden lg:table-cell max-w-[260px]">
                        <span className="line-clamp-1 text-sm text-muted-foreground">
                          {r.comment ?? '—'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                              <span className="sr-only">{t('common.actions')}</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(r)}>
                              <Eye className="h-4 w-4" />
                              {t('common.view')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openEdit(r)}>
                              <Pencil className="h-4 w-4" />
                              {t('common.edit')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setDeleteTarget(r)}
                            >
                              <Trash2 className="h-4 w-4" />
                              {t('common.delete')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {!loading && rows.length > 0 && (
        <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
          <p className="text-xs text-muted-foreground">
            {t('tx.pageOf', { page: safePage, total: totalPages })} ·{' '}
            {t('tx.results', { count: total })}
          </p>
          <Pagination className="mx-0 w-auto">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  onClick={(e) => {
                    e.preventDefault()
                    setPage((p) => clampPage(p - 1, totalPages))
                  }}
                  aria-disabled={safePage <= 1}
                  className={cn(safePage <= 1 && 'pointer-events-none opacity-50')}
                />
              </PaginationItem>
              {buildPageList(safePage, totalPages).map((p, i) =>
                p === 'ellipsis' ? (
                  <PaginationItem key={`e-${i}`}>
                    <PaginationEllipsis />
                  </PaginationItem>
                ) : (
                  <PaginationItem key={p}>
                    <PaginationLink
                      href="#"
                      isActive={p === safePage}
                      onClick={(e) => {
                        e.preventDefault()
                        setPage(p)
                      }}
                    >
                      {p}
                    </PaginationLink>
                  </PaginationItem>
                ),
              )}
              <PaginationItem>
                <PaginationNext
                  href="#"
                  onClick={(e) => {
                    e.preventDefault()
                    setPage((p) => clampPage(p + 1, totalPages))
                  }}
                  aria-disabled={safePage >= totalPages}
                  className={cn(safePage >= totalPages && 'pointer-events-none opacity-50')}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>
              {editing ? t(`${kind}.edit`) : t(`${kind}.add`)}
            </DialogTitle>
            <DialogDescription>{walletFieldLabel}</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="f-name">
                {t('common.name')} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="f-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder={t('tx.namePlaceholder')}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="f-article">{t('common.article')}</Label>
                <Select
                  value={formArticleId || ALL}
                  onValueChange={(v) => handleArticleChange(v === ALL ? '' : v)}
                >
                  <SelectTrigger id="f-article" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t('common.none')}</SelectItem>
                    {articles.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="f-category">{t('common.category')}</Label>
                <Select
                  value={formCategoryId || ALL}
                  onValueChange={(v) => setFormCategoryId(v === ALL ? '' : v)}
                >
                  <SelectTrigger id="f-category" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t('common.none')}</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="f-amount">
                  {t('common.amount')} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="f-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  value={formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                  placeholder={t('tx.amountPlaceholder')}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="f-date">
                  {t(`${kind}.financialDate`)} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="f-date"
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="f-wallet">
                {t('common.wallet')} <span className="text-destructive">*</span>
              </Label>
              <Select value={formWalletId} onValueChange={setFormWalletId}>
                <SelectTrigger id="f-wallet" className="w-full">
                  <SelectValue placeholder={t('common.wallet')} />
                </SelectTrigger>
                <SelectContent>
                  {wallets.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: w.color ?? '#888' }}
                          aria-hidden
                        />
                        {w.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="f-comment">{t('common.comment')}</Label>
              <Textarea
                id="f-comment"
                value={formComment}
                onChange={(e) => setFormComment(e.target.value)}
                placeholder={t('tx.commentPlaceholder')}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting || !hasWallets}
            >
              {submitting ? t('common.loading') : editing ? t('common.save') : t('common.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title={t('common.delete')}
        description={t('tx.deleteConfirm')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={handleDelete}
      />
    </div>
  )
}
