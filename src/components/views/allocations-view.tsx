'use client'

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Plus,
  Pencil,
  Trash2,
  MoreHorizontal,
  Search,
  Info,
  Layers,
  TrendingUp,
  TrendingDown,
  Wallet,
  PieChart,
  CircleDollarSign,
  Gauge,
  AlertTriangle,
  Link2,
} from 'lucide-react'

import { useI18n } from '@/lib/use-i18n'
import { useApi } from '@/lib/use-api'
import { toCents, pct } from '@/lib/money'
import { cn } from '@/lib/utils'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { StatCard, EmptyState, MoneyText, PageHeader } from '@/components/shared'
import { ConfirmDialog } from '@/components/confirm-dialog'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AllocType = 'active' | 'passive'
type Classification = 'credit' | 'monthly_expense' | 'completed' | 'other'
type AllocStatus = 'active' | 'completed' | 'on_hold'

interface BankCredit {
  id: string
  creditName: string
  lender: string
  originalPrincipal: string
  durationMonths: number
  startDate: string
  monthlyInstallment: string
  status: string
  totalRepaid?: string
  outstanding?: string
  progressPct?: number
}

interface Category {
  id: string
  name: string
  type: string
  color: string | null
}

interface Allocation {
  id: string
  name: string
  allocType: AllocType
  classification: Classification
  amount: string
  color: string | null
  bankCreditId: string | null
  bankCredit?: BankCredit | null
  categoryId: string | null
  category?: Category | null
  progress: number
  status: string
  comment: string | null
  createdAt: string
  updatedAt: string
}

interface AllocSummary {
  referenceIncome: string
  unitValue: string
  totalActive: string
  totalPassive: string
  totalAllocated: string
  unallocated: string
  utilization: number
  available: string
}

interface AllocListResponse {
  items: Allocation[]
  summary: AllocSummary
}

interface BankCreditsListResponse {
  items: BankCredit[]
}

interface CategoriesListResponse {
  items: Category[]
}

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const DEFAULT_COLOR = '#64748b'
const ALL_SENTINEL = '__all__'
const NONE_SENTINEL = '__none__'
const MAX_SQUARES = 1000 // safety cap so we don't render thousands of DOM nodes

const CLASSIFICATIONS: Classification[] = ['credit', 'monthly_expense', 'completed', 'other']
const STATUSES: AllocStatus[] = ['active', 'completed', 'on_hold']

function isAllocType(v: string): v is AllocType {
  return v === 'active' || v === 'passive'
}
function isClassification(v: string): v is Classification {
  return v === 'credit' || v === 'monthly_expense' || v === 'completed' || v === 'other'
}
function isAllocStatus(v: string): v is AllocStatus {
  return v === 'active' || v === 'completed' || v === 'on_hold'
}

// ---------------------------------------------------------------------------
// Unit-grid visualization
// ---------------------------------------------------------------------------
// User's spec:
//   - Total = total actives value (NOT reference income). 25000 was just an example.
//   - Active color = green (adds money to me).
//   - Passive color = red (takes money from me).
//   - Passives start from slot 0 and fill until their cumulative value ends.
//   - Remaining slots = green (actives).
//   - Blue for remaining money value inside the bar (net = actives - passives).
// ---------------------------------------------------------------------------

const ACTIVE_COLOR = '#16a34a'   // green
const PASSIVE_COLOR = '#dc2626'  // red
const REMAIN_COLOR = '#2563eb'   // blue

interface SquareInfo {
  color: string // hex color or '' for unallocated
  name: string
  amount: string // already formatted money or ''
  partial: boolean // fractional unit (lighter opacity)
  unallocated: boolean
}

function buildUnitSquares(items: Allocation[], totalActives: string, unitValue: string): SquareInfo[] {
  const activeCents = toCents(totalActives)
  const unitCents = toCents(unitValue)
  if (unitCents <= 0 || activeCents <= 0) return []
  const totalUnits = Math.ceil(activeCents / unitCents)
  if (totalUnits <= 0) return []

  const cappedTotal = Math.min(totalUnits, MAX_SQUARES)

  const squares: SquareInfo[] = []
  let idx = 0

  // First: fill passives (red) from slot 0.
  const passives = items.filter((a) => a.allocType === 'passive')
  for (const a of passives) {
    if (idx >= cappedTotal) break
    const amtCents = toCents(a.amount)
    if (amtCents <= 0) continue
    const units = amtCents / unitCents
    const fullUnits = Math.floor(units)
    const isFractional = units - fullUnits > 0
    const name = a.name
    const amount = a.amount

    const remaining = cappedTotal - idx
    const takeFull = Math.min(fullUnits, remaining)
    for (let i = 0; i < takeFull; i++) {
      squares.push({ color: PASSIVE_COLOR, name, amount, partial: false, unallocated: false })
      idx++
    }
    if (isFractional && idx < cappedTotal) {
      squares.push({ color: PASSIVE_COLOR, name, amount, partial: true, unallocated: false })
      idx++
    }
  }

  // Second: fill actives (green) in remaining slots.
  const actives = items.filter((a) => a.allocType === 'active')
  for (const a of actives) {
    if (idx >= cappedTotal) break
    const amtCents = toCents(a.amount)
    if (amtCents <= 0) continue
    const units = amtCents / unitCents
    const fullUnits = Math.floor(units)
    const isFractional = units - fullUnits > 0
    const name = a.name
    const amount = a.amount

    const remaining = cappedTotal - idx
    const takeFull = Math.min(fullUnits, remaining)
    for (let i = 0; i < takeFull; i++) {
      squares.push({ color: ACTIVE_COLOR, name, amount, partial: false, unallocated: false })
      idx++
    }
    if (isFractional && idx < cappedTotal) {
      squares.push({ color: ACTIVE_COLOR, name, amount, partial: true, unallocated: false })
      idx++
    }
  }

  // Fill the remaining slots with unallocated muted squares.
  while (squares.length < cappedTotal) {
    squares.push({ color: '', name: '', amount: '', partial: false, unallocated: true })
  }

  return squares
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AllocationsView() {
  const { t, money, num } = useI18n()
  const api = useApi()
  const qc = useQueryClient()

  // ---- Filters ----
  const [filterType, setFilterType] = useState<string>(ALL_SENTINEL)
  const [filterClass, setFilterClass] = useState<string>(ALL_SENTINEL)
  const [filterStatus, setFilterStatus] = useState<string>(ALL_SENTINEL)
  const [search, setSearch] = useState('')

  const queryFilters = useMemo(
    () => ({
      type: filterType !== ALL_SENTINEL ? filterType : undefined,
      classification: filterClass !== ALL_SENTINEL ? filterClass : undefined,
      status: filterStatus !== ALL_SENTINEL ? filterStatus : undefined,
      search: search.trim() || undefined,
    }),
    [filterType, filterClass, filterStatus, search],
  )

  const hasFilters =
    filterType !== ALL_SENTINEL ||
    filterClass !== ALL_SENTINEL ||
    filterStatus !== ALL_SENTINEL ||
    search.trim() !== ''

  // ---- Allocations list ----
  const allocQuery = useQuery<AllocListResponse>({
    queryKey: ['allocations', queryFilters],
    queryFn: () => api.get<AllocListResponse>('/api/allocations', { query: queryFilters }),
  })

  const items = allocQuery.data?.items ?? []
  const summary: AllocSummary = allocQuery.data?.summary ?? {
    referenceIncome: '0',
    unitValue: '500',
    totalActive: '0',
    totalPassive: '0',
    totalAllocated: '0',
    unallocated: '0',
    utilization: 0,
    available: '0',
  }
  const loading = allocQuery.isLoading

  // ---- Bank credits (for linking in dialog) ----
  const creditsQuery = useQuery<BankCreditsListResponse>({
    queryKey: ['bank-credits', 'allocations-form'],
    queryFn: () => api.get<BankCreditsListResponse>('/api/bank-credits'),
  })
  const credits = creditsQuery.data?.items ?? []

  // ---- Categories (expense type, for linking) ----
  const catsQuery = useQuery<CategoriesListResponse>({
    queryKey: ['categories', 'expense', 'allocations-form'],
    queryFn: () => api.get<CategoriesListResponse>('/api/categories', { query: { type: 'expense' } }),
  })
  const categories = catsQuery.data?.items ?? []

  // ---- Create / edit dialog state ----
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Allocation | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [formName, setFormName] = useState('')
  const [formType, setFormType] = useState<AllocType>('active')
  const [formClassification, setFormClassification] = useState<Classification>('monthly_expense')
  const [formAmount, setFormAmount] = useState('')
  const [formColor, setFormColor] = useState(DEFAULT_COLOR)
  const [formBankCreditId, setFormBankCreditId] = useState<string>(NONE_SENTINEL)
  const [formCategoryId, setFormCategoryId] = useState<string>(NONE_SENTINEL)
  const [formProgress, setFormProgress] = useState<string>('0')
  const [formStatus, setFormStatus] = useState<AllocStatus>('active')
  const [formComment, setFormComment] = useState('')

  // ---- Delete dialog ----
  const [deleteTarget, setDeleteTarget] = useState<Allocation | null>(null)

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/api/allocations', body),
    onSuccess: () => {
      toast.success(t('alloc.created'))
      qc.invalidateQueries({ queryKey: ['allocations'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['analytics'] })
      setDialogOpen(false)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.put(`/api/allocations/${id}`, body),
    onSuccess: () => {
      toast.success(t('alloc.updated'))
      qc.invalidateQueries({ queryKey: ['allocations'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['analytics'] })
      setDialogOpen(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del(`/api/allocations/${id}`),
    onSuccess: () => {
      toast.success(t('common.delete'))
      qc.invalidateQueries({ queryKey: ['allocations'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['analytics'] })
      setDeleteTarget(null)
    },
  })

  // ---------------------------------------------------------------------------
  // Derived: unit-grid squares + legend + overflow warning
  // ---------------------------------------------------------------------------

  const squares = useMemo(
    () => buildUnitSquares(items, summary.totalActive, summary.unitValue),
    [items, summary.totalActive, summary.unitValue],
  )

  const activeCents = toCents(summary.totalActive)
  const passiveCents = toCents(summary.totalPassive)
  // Net = actives - passives (blue remaining money value)
  const netCents = activeCents - passiveCents

  const totalUnits = useMemo(() => {
    const unitCents = toCents(summary.unitValue)
    if (unitCents <= 0) return 0
    if (activeCents <= 0) return 0
    return Math.ceil(activeCents / unitCents)
  }, [activeCents, summary.unitValue])
  const truncated = totalUnits > MAX_SQUARES

  // Selected credit (for the create/edit dialog summary panel)
  const selectedCreditId =
    formBankCreditId !== NONE_SENTINEL ? formBankCreditId : null
  const selectedCredit = credits.find((c) => c.id === selectedCreditId) ?? null

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const openCreate = () => {
    setEditing(null)
    setFormName('')
    setFormType('active')
    setFormClassification('monthly_expense')
    setFormAmount('')
    setFormColor(DEFAULT_COLOR)
    setFormBankCreditId(NONE_SENTINEL)
    setFormCategoryId(NONE_SENTINEL)
    setFormProgress('0')
    setFormStatus('active')
    setFormComment('')
    setDialogOpen(true)
  }

  const openEdit = (a: Allocation) => {
    setEditing(a)
    setFormName(a.name)
    setFormType(isAllocType(a.allocType) ? a.allocType : 'active')
    setFormClassification(isClassification(a.classification) ? a.classification : 'other')
    setFormAmount(a.amount)
    setFormColor(a.color ?? DEFAULT_COLOR)
    setFormBankCreditId(a.bankCreditId ?? NONE_SENTINEL)
    setFormCategoryId(a.categoryId ?? NONE_SENTINEL)
    setFormProgress(String(a.progress ?? 0))
    setFormStatus(isAllocStatus(a.status) ? a.status : 'active')
    setFormComment(a.comment ?? '')
    setDialogOpen(true)
  }

  const clearFilters = () => {
    setFilterType(ALL_SENTINEL)
    setFilterClass(ALL_SENTINEL)
    setFilterStatus(ALL_SENTINEL)
    setSearch('')
  }

  const handleSubmit = async () => {
    if (!formName.trim()) {
      toast.error(`${t('common.required')}: ${t('common.name')}`)
      return
    }
    const amt = Number(formAmount)
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error(`${t('common.required')}: ${t('common.amount')}`)
      return
    }

    const body: Record<string, unknown> = {
      name: formName.trim(),
      allocType: formType,
      classification: formClassification,
      amount: amt.toFixed(2),
      color: formColor,
      status: formStatus,
    }

    // Bank credit link — only relevant when classification === 'credit'.
    if (formClassification === 'credit' && formBankCreditId !== NONE_SENTINEL) {
      body.bankCreditId = formBankCreditId
    } else {
      body.bankCreditId = null
    }

    // Category — optional in all cases.
    if (formCategoryId !== NONE_SENTINEL) {
      body.categoryId = formCategoryId
    } else {
      body.categoryId = null
    }

    // Manual progress — only used when NOT credit-linked.
    if (!(formClassification === 'credit' && formBankCreditId !== NONE_SENTINEL)) {
      const p = Number(formProgress)
      if (Number.isFinite(p)) {
        body.progress = Math.max(0, Math.min(100, Math.round(p)))
      }
    }

    if (formComment.trim()) {
      body.comment = formComment.trim()
    } else {
      body.comment = null
    }

    setSubmitting(true)
    try {
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, body })
      } else {
        await createMutation.mutateAsync(body)
      }
    } catch {
      // useApi already toasted the error.
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    await deleteMutation.mutateAsync(deleteTarget.id)
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const typeBadgeClass = (a: AllocType) =>
    a === 'active'
      ? 'border-income/30 bg-income/10 text-income'
      : 'border-expense/30 bg-expense/10 text-expense'

  const classificationLabel = (c: Classification) =>
    t(`alloc.class.${c}`)

  const statusBadgeClass = (s: string) => {
    if (s === 'completed') return 'border-income/30 bg-income/10 text-income'
    if (s === 'on_hold') return 'border-warning/30 bg-warning/10 text-warning'
    return 'border-info/30 bg-info/10 text-info'
  }

  const statusLabel = (s: string) => {
    if (s === 'completed') return t('goal.status.completed')
    if (s === 'on_hold') return t('goal.status.on_hold')
    return t('common.active')
  }

  const isCreditLinked = (a: Allocation) => !!a.bankCreditId

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title={t('alloc.title')}
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">{t('alloc.add')}</span>
          </Button>
        }
      />

      {/* Info note */}
      <div className="flex items-start gap-2 rounded-md border border-info/30 bg-info/5 px-3 py-2 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
        <span>{t('alloc.note')}</span>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        <StatCard
          label={t('alloc.referenceIncome')}
          value={money(summary.referenceIncome)}
          icon={CircleDollarSign}
          tone="default"
          loading={loading}
          hint={`${num(totalUnits)} × ${money(summary.unitValue, 'MAD', false)}`}
        />
        <StatCard
          label={t('alloc.totalActive')}
          value={money(summary.totalActive)}
          icon={TrendingUp}
          tone="income"
          loading={loading}
        />
        <StatCard
          label={t('alloc.totalPassive')}
          value={money(summary.totalPassive)}
          icon={TrendingDown}
          tone="expense"
          loading={loading}
        />
        <StatCard
          label={t('alloc.totalAllocated')}
          value={money(summary.totalAllocated)}
          icon={Wallet}
          tone="default"
          loading={loading}
        />
        <StatCard
          label={t('alloc.unallocated')}
          value={money(summary.unallocated)}
          icon={PieChart}
          tone="info"
          loading={loading}
        />
        <StatCard
          label={t('alloc.utilization')}
          value={`${num(Math.round(summary.utilization * 10) / 10)}%`}
          icon={Gauge}
          tone={summary.utilization > 100 ? 'warning' : 'default'}
          loading={loading}
        />
        <StatCard
          label={t('alloc.available')}
          value={money(summary.available)}
          icon={Layers}
          tone="info"
          loading={loading}
        />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t('common.search')}</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('common.search')}
                  className="pl-9"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t('common.type')}</Label>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_SENTINEL}>{t('common.all')}</SelectItem>
                  <SelectItem value="active">{t('alloc.active')}</SelectItem>
                  <SelectItem value="passive">{t('alloc.passive')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t('alloc.classification')}</Label>
              <Select value={filterClass} onValueChange={setFilterClass}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_SENTINEL}>{t('common.all')}</SelectItem>
                  {CLASSIFICATIONS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {classificationLabel(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t('common.status')}</Label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_SENTINEL}>{t('common.all')}</SelectItem>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {statusLabel(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {hasFilters && (
            <div className="mt-3 flex justify-end">
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                {t('common.clearFilters')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Allocation bar visualization */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">{t('alloc.title')}</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                {num(totalUnits)} × {money(summary.unitValue, 'MAD', false)} = {money(summary.totalActive)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: ACTIVE_COLOR }} />
                {t('alloc.active')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: PASSIVE_COLOR }} />
                {t('alloc.passive')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: REMAIN_COLOR }} />
                {t('common.remaining')}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-24 w-full" />
          ) : squares.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t('alloc.empty')}
            </p>
          ) : (
            <>
              <div
                className="flex flex-wrap gap-1"
                role="img"
                aria-label={`${num(squares.length)}`}
              >
                {squares.map((sq, i) => {
                  if (sq.unallocated) {
                    return (
                      <div
                        key={i}
                        className="h-4 w-4 rounded-sm bg-muted-foreground/15"
                        title={t('alloc.unallocated')}
                      />
                    )
                  }
                  return (
                    <div
                      key={i}
                      className={cn(
                        'h-4 w-4 rounded-sm transition-transform hover:scale-125 hover:z-10',
                        sq.partial && 'opacity-50',
                      )}
                      style={{
                        backgroundColor: sq.color,
                        backgroundImage: sq.partial
                          ? 'repeating-linear-gradient(45deg, rgba(255,255,255,0.4) 0 2px, transparent 2px 4px)'
                          : undefined,
                      }}
                      title={`${sq.name} · ${money(sq.amount)}`}
                    />
                  )
                })}
              </div>
              {truncated && (
                <p className="mt-3 text-xs text-muted-foreground tabular-nums">
                  {num(MAX_SQUARES)} / {num(totalUnits)}
                </p>
              )}
              {/* Net remaining summary */}
              <div className="mt-4 grid grid-cols-3 gap-3 border-t pt-4">
                <div className="rounded-lg p-3" style={{ backgroundColor: `${ACTIVE_COLOR}15` }}>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('alloc.totalActive')}</div>
                  <div className="mt-1 text-lg font-bold tabular-nums" style={{ color: ACTIVE_COLOR }}>
                    {money(summary.totalActive)}
                  </div>
                </div>
                <div className="rounded-lg p-3" style={{ backgroundColor: `${PASSIVE_COLOR}15` }}>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('alloc.totalPassive')}</div>
                  <div className="mt-1 text-lg font-bold tabular-nums" style={{ color: PASSIVE_COLOR }}>
                    {money(summary.totalPassive)}
                  </div>
                </div>
                <div className="rounded-lg p-3" style={{ backgroundColor: `${REMAIN_COLOR}15` }}>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('common.remaining')}</div>
                  <div className="mt-1 text-lg font-bold tabular-nums" style={{ color: REMAIN_COLOR }}>
                    {money(netCents > 0 ? netCents / 100 : 0)}
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Two separate cards: Actives list (green) + Passives list (red) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Actives card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: ACTIVE_COLOR }} />
                <CardTitle className="text-base">{t('alloc.active')}</CardTitle>
              </div>
              <Badge style={{ backgroundColor: `${ACTIVE_COLOR}20`, color: ACTIVE_COLOR, borderColor: 'transparent' }}>
                {money(summary.totalActive)}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : items.filter((a) => a.allocType === 'active').length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('alloc.empty')}</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto scrollbar-thin">
                {items.filter((a) => a.allocType === 'active').map((a) => (
                  <AllocationRow key={a.id} a={a} color={ACTIVE_COLOR} onEdit={openEdit} onDelete={setDeleteTarget} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Passives card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: PASSIVE_COLOR }} />
                <CardTitle className="text-base">{t('alloc.passive')}</CardTitle>
              </div>
              <Badge style={{ backgroundColor: `${PASSIVE_COLOR}20`, color: PASSIVE_COLOR, borderColor: 'transparent' }}>
                {money(summary.totalPassive)}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : items.filter((a) => a.allocType === 'passive').length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('alloc.empty')}</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto scrollbar-thin">
                {items.filter((a) => a.allocType === 'passive').map((a) => (
                  <AllocationRow key={a.id} a={a} color={PASSIVE_COLOR} onEdit={openEdit} onDelete={setDeleteTarget} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>{editing ? t('alloc.edit') : t('alloc.add')}</DialogTitle>
            <DialogDescription>{t('alloc.note')}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            {/* Name */}
            <div className="space-y-1.5">
              <Label htmlFor="alloc-name">
                {t('common.name')} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="alloc-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder={t('common.name')}
              />
            </div>

            {/* Type + Classification */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t('common.type')}</Label>
                <Select value={formType} onValueChange={(v) => isAllocType(v) && setFormType(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">{t('alloc.active')}</SelectItem>
                    <SelectItem value="passive">{t('alloc.passive')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('alloc.classification')}</Label>
                <Select
                  value={formClassification}
                  onValueChange={(v) => isClassification(v) && setFormClassification(v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CLASSIFICATIONS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {classificationLabel(c)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Amount + Color */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto]">
              <div className="space-y-1.5">
                <Label htmlFor="alloc-amount">
                  {t('common.amount')} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="alloc-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  value={formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="alloc-color">{t('common.color')}</Label>
                <div className="flex h-9 items-center gap-2">
                  <input
                    id="alloc-color"
                    type="color"
                    value={formColor}
                    onChange={(e) => setFormColor(e.target.value)}
                    className="h-9 w-12 cursor-pointer rounded-md border bg-transparent p-0.5"
                  />
                  <span className="font-mono text-xs uppercase text-muted-foreground">
                    {formColor}
                  </span>
                </div>
              </div>
            </div>

            {/* Linked bank credit — only when classification === 'credit' */}
            {formClassification === 'credit' && (
              <div className="space-y-2">
                <div className="space-y-1.5">
                  <Label>{t('alloc.linkedCredit')}</Label>
                  <Select value={formBankCreditId} onValueChange={setFormBankCreditId}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_SENTINEL}>{t('common.none')}</SelectItem>
                      {credits.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.creditName} · {c.lender}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selectedCredit && (
                  <div className="grid grid-cols-2 gap-2 rounded-md border bg-muted/30 p-3 text-xs sm:grid-cols-4">
                    <div>
                      <div className="text-muted-foreground">{t('credit.originalPrincipal')}</div>
                      <div className="font-medium tabular-nums">
                        {money(selectedCredit.originalPrincipal)}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">{t('credit.totalRepaid')}</div>
                      <div className="font-medium tabular-nums text-income">
                        {money(selectedCredit.totalRepaid ?? '0')}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">{t('credit.outstanding')}</div>
                      <div className="font-medium tabular-nums text-expense">
                        {money(selectedCredit.outstanding ?? selectedCredit.originalPrincipal)}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">{t('common.progress')}</div>
                      <div className="font-medium tabular-nums">
                        {num(selectedCredit.progressPct ?? 0)}%
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Category */}
            <div className="space-y-1.5">
              <Label>{t('common.category')}</Label>
              <Select value={formCategoryId} onValueChange={setFormCategoryId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_SENTINEL}>{t('common.none')}</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Manual progress — only when NOT credit-linked */}
            {!(formClassification === 'credit' && formBankCreditId !== NONE_SENTINEL) && (
              <div className="space-y-1.5">
                <Label htmlFor="alloc-progress">
                  {t('common.progress')} (0-100%)
                </Label>
                <Input
                  id="alloc-progress"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  inputMode="numeric"
                  value={formProgress}
                  onChange={(e) => setFormProgress(e.target.value)}
                />
              </div>
            )}

            {/* Status */}
            <div className="space-y-1.5">
              <Label>{t('common.status')}</Label>
              <Select
                value={formStatus}
                onValueChange={(v) => isAllocStatus(v) && setFormStatus(v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {statusLabel(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Comment */}
            <div className="space-y-1.5">
              <Label htmlFor="alloc-comment">{t('common.comment')}</Label>
              <Textarea
                id="alloc-comment"
                rows={3}
                value={formComment}
                onChange={(e) => setFormComment(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
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
        description={deleteTarget?.name}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={handleDelete}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// AllocationRow — compact row used in the two separate actives/passives cards
// ---------------------------------------------------------------------------

function AllocationRow({
  a,
  color,
  onEdit,
  onDelete,
}: {
  a: Allocation
  color: string
  onEdit: (a: Allocation) => void
  onDelete: (a: Allocation) => void
}) {
  const { t, money, num } = useI18n()
  const progressPct = Math.max(0, Math.min(100, a.progress ?? 0))
  const classLabel = (c: string) => t(`alloc.class.${c}` as string) || c
  const sBadgeClass = (s: string) => {
    if (s === 'completed') return 'border-income/30 bg-income/10 text-income'
    if (s === 'on_hold') return 'border-warning/30 bg-warning/10 text-warning'
    return 'border-info/30 bg-info/10 text-info'
  }
  const sLabel = (s: string) => {
    if (s === 'completed') return t('goal.status.completed')
    if (s === 'on_hold') return t('goal.status.on_hold')
    return t('common.active')
  }
  return (
    <div
      className="rounded-lg border p-3 transition-colors hover:bg-accent/50"
      style={{ borderLeftWidth: 3, borderLeftColor: color }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium leading-tight">{a.name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            <Badge variant="outline" className="text-[10px]">
              {classLabel(isClassification(a.classification) ? a.classification : 'other')}
            </Badge>
            <Badge variant="outline" className={cn('text-[10px]', sBadgeClass(a.status))}>
              {sLabel(a.status)}
            </Badge>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit(a)}>
              <Pencil className="h-4 w-4" />
              {t('common.edit')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDelete(a)}>
              <Trash2 className="h-4 w-4" />
              {t('common.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <MoneyText value={a.amount} className="text-base font-bold" />
        {a.bankCredit && (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Link2 className="h-3 w-3" />
            <span className="truncate max-w-[100px]">{a.bankCredit.creditName}</span>
          </span>
        )}
      </div>
      <div className="mt-2 space-y-1">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{t('common.progress')}</span>
          <span className="tabular-nums">{num(progressPct)}%</span>
        </div>
        <Progress value={progressPct} className="h-1.5" />
      </div>
      {a.comment && <p className="mt-2 line-clamp-2 text-[11px] text-muted-foreground">{a.comment}</p>}
    </div>
  )
}

// Re-export helpers used internally for potential reuse by other views.
export { buildUnitSquares }
export type { SquareInfo, Allocation, AllocSummary }
