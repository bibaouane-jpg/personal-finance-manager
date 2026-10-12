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
  Download,
  Target,
  CheckCircle2,
  CircleDollarSign,
  Gauge,
  Wallet,
  PiggyBank,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Tag,
  X,
} from 'lucide-react'

import { useI18n } from '@/lib/use-i18n'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { StatCard, EmptyState, MoneyText, PageHeader } from '@/components/shared'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { MiniHBarChart, type HBarDatum } from '@/components/mini-charts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GoalStatus = 'not_started' | 'in_progress' | 'completed' | 'on_hold' | 'cancelled'

interface GoalCategory {
  id: string
  name: string
  color: string | null
}

interface GoalCategoryWithCount extends GoalCategory {
  _count?: { goals?: number }
}

interface Goal {
  id: string
  year: number
  title: string
  description: string | null
  priority: number
  progress: number
  status: GoalStatus
  targetDate: string | null
  requiredBudget: string | null
  savedBudget: string | null
  remainingBudget: string
  note: string | null
  goalCategoryId: string | null
  goalCategory: GoalCategory | null
  createdAt: string
  updatedAt: string
}

interface CategorySummary {
  id: string
  name: string
  color: string
  count: number
  required: string
  saved: string
}

interface GoalSummary {
  totalGoals: number
  completedGoals: number
  inProgressGoals: number
  overallProgress: number
  requiredTotal: string
  savedTotal: string
  remainingTotal: string
  byCategory: CategorySummary[]
}

interface GoalsListResponse {
  items: Goal[]
  total: number
  page: number
  pageSize: number
  summary: GoalSummary
}

interface GoalCategoriesResponse {
  items: GoalCategoryWithCount[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_COLOR = '#64748b'
const ALL_SENTINEL = '__all__'
const NONE_SENTINEL = '__none__'
const PAGE_SIZE = 100

const STATUSES: GoalStatus[] = [
  'not_started',
  'in_progress',
  'completed',
  'on_hold',
  'cancelled',
]
const PRIORITIES = [1, 2, 3, 4, 5] as const

function isGoalStatus(v: string): v is GoalStatus {
  return (
    v === 'not_started' ||
    v === 'in_progress' ||
    v === 'completed' ||
    v === 'on_hold' ||
    v === 'cancelled'
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GoalsView() {
  const { t, money, num, date } = useI18n()
  const api = useApi()
  const qc = useQueryClient()

  // ---- Year selector ----
  const currentYear = new Date().getFullYear()
  const yearOptions = useMemo(() => {
    const arr: number[] = []
    for (let y = currentYear - 5; y <= currentYear + 5; y++) arr.push(y)
    return arr
  }, [currentYear])
  const [year, setYear] = useState<number>(currentYear)

  // ---- Filters ----
  const [filterStatus, setFilterStatus] = useState<string>(ALL_SENTINEL)
  const [filterCategoryId, setFilterCategoryId] = useState<string>(ALL_SENTINEL)
  const [filterPriority, setFilterPriority] = useState<string>(ALL_SENTINEL)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const queryFilters = useMemo(
    () => ({
      year: String(year),
      status: filterStatus !== ALL_SENTINEL ? filterStatus : undefined,
      goalCategoryId: filterCategoryId !== ALL_SENTINEL ? filterCategoryId : undefined,
      priority: filterPriority !== ALL_SENTINEL ? filterPriority : undefined,
      search: search.trim() || undefined,
      page: String(page),
      pageSize: String(PAGE_SIZE),
    }),
    [year, filterStatus, filterCategoryId, filterPriority, search, page],
  )

  const hasFilters =
    filterStatus !== ALL_SENTINEL ||
    filterCategoryId !== ALL_SENTINEL ||
    filterPriority !== ALL_SENTINEL ||
    search.trim() !== ''

  // ---- Goals list ----
  const goalsQuery = useQuery<GoalsListResponse>({
    queryKey: ['goals', year, filterStatus, filterCategoryId, filterPriority, search, page],
    queryFn: () => api.get<GoalsListResponse>('/api/goals', { query: queryFilters }),
  })

  const items = goalsQuery.data?.items ?? []
  const summary: GoalSummary = goalsQuery.data?.summary ?? {
    totalGoals: 0,
    completedGoals: 0,
    inProgressGoals: 0,
    overallProgress: 0,
    requiredTotal: '0',
    savedTotal: '0',
    remainingTotal: '0',
    byCategory: [],
  }
  const loading = goalsQuery.isLoading

  // ---- Goal categories ----
  const catsQuery = useQuery<GoalCategoriesResponse>({
    queryKey: ['goal-categories'],
    queryFn: () => api.get<GoalCategoriesResponse>('/api/goal-categories'),
  })
  const categories = catsQuery.data?.items ?? []

  // ---- Create / edit dialog state ----
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Goal | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [formYear, setFormYear] = useState<string>(String(currentYear))
  const [formTitle, setFormTitle] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formCategoryId, setFormCategoryId] = useState<string>(NONE_SENTINEL)
  const [formPriority, setFormPriority] = useState<string>('3')
  const [formProgress, setFormProgress] = useState<string>('0')
  const [formStatus, setFormStatus] = useState<GoalStatus>('not_started')
  const [formTargetDate, setFormTargetDate] = useState<string>('')
  const [formRequiredBudget, setFormRequiredBudget] = useState<string>('')
  const [formSavedBudget, setFormSavedBudget] = useState<string>('')
  const [formNote, setFormNote] = useState('')

  // ---- Inline "add new category" sub-dialog ----
  const [addCatOpen, setAddCatOpen] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [newCatColor, setNewCatColor] = useState(DEFAULT_COLOR)
  const [addCatSubmitting, setAddCatSubmitting] = useState(false)

  // ---- Manage categories dialog ----
  const [manageCatsOpen, setManageCatsOpen] = useState(false)
  const [editCatTarget, setEditCatTarget] = useState<GoalCategoryWithCount | null>(null)
  const [editCatName, setEditCatName] = useState('')
  const [editCatColor, setEditCatColor] = useState(DEFAULT_COLOR)
  const [catSubmitting, setCatSubmitting] = useState(false)
  const [deleteCatTarget, setDeleteCatTarget] = useState<GoalCategoryWithCount | null>(null)

  // ---- Delete goal confirmation ----
  const [deleteTarget, setDeleteTarget] = useState<Goal | null>(null)

  // ---------------------------------------------------------------------------
  // Mutations: goals
  // ---------------------------------------------------------------------------

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/api/goals', body),
    onSuccess: () => {
      toast.success(t('goal.created'))
      qc.invalidateQueries({ queryKey: ['goals'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['analytics'] })
      setDialogOpen(false)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.put(`/api/goals/${id}`, body),
    onSuccess: () => {
      toast.success(t('goal.updated'))
      qc.invalidateQueries({ queryKey: ['goals'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['analytics'] })
      setDialogOpen(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del(`/api/goals/${id}`),
    onSuccess: () => {
      toast.success(t('common.delete'))
      qc.invalidateQueries({ queryKey: ['goals'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['analytics'] })
      setDeleteTarget(null)
    },
  })

  // ---------------------------------------------------------------------------
  // Mutations: goal categories
  // ---------------------------------------------------------------------------

  const createCatMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<GoalCategory>('/api/goal-categories', body),
    onSuccess: (created: GoalCategory) => {
      toast.success(t('cat.created'))
      qc.invalidateQueries({ queryKey: ['goal-categories'] })
      qc.invalidateQueries({ queryKey: ['goals'] })
      setFormCategoryId(created.id)
      setAddCatOpen(false)
      setNewCatName('')
      setNewCatColor(DEFAULT_COLOR)
    },
  })

  const updateCatMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.put(`/api/goal-categories/${id}`, body),
    onSuccess: () => {
      toast.success(t('cat.updated'))
      qc.invalidateQueries({ queryKey: ['goal-categories'] })
      qc.invalidateQueries({ queryKey: ['goals'] })
      setEditCatTarget(null)
    },
  })

  const deleteCatMutation = useMutation({
    mutationFn: (id: string) => api.del(`/api/goal-categories/${id}`),
    onSuccess: () => {
      toast.success(t('common.delete'))
      qc.invalidateQueries({ queryKey: ['goal-categories'] })
      qc.invalidateQueries({ queryKey: ['goals'] })
      setDeleteCatTarget(null)
    },
  })

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const openCreate = () => {
    setEditing(null)
    setFormYear(String(year))
    setFormTitle('')
    setFormDescription('')
    setFormCategoryId(NONE_SENTINEL)
    setFormPriority('3')
    setFormProgress('0')
    setFormStatus('not_started')
    setFormTargetDate('')
    setFormRequiredBudget('')
    setFormSavedBudget('')
    setFormNote('')
    setDialogOpen(true)
  }

  const openEdit = (g: Goal) => {
    setEditing(g)
    setFormYear(String(g.year))
    setFormTitle(g.title)
    setFormDescription(g.description ?? '')
    setFormCategoryId(g.goalCategoryId ?? NONE_SENTINEL)
    setFormPriority(String(g.priority))
    setFormProgress(String(g.progress ?? 0))
    setFormStatus(isGoalStatus(g.status) ? g.status : 'not_started')
    setFormTargetDate(g.targetDate ? String(g.targetDate).slice(0, 10) : '')
    setFormRequiredBudget(g.requiredBudget ?? '')
    setFormSavedBudget(g.savedBudget ?? '')
    setFormNote(g.note ?? '')
    setDialogOpen(true)
  }

  const clearFilters = () => {
    setFilterStatus(ALL_SENTINEL)
    setFilterCategoryId(ALL_SENTINEL)
    setFilterPriority(ALL_SENTINEL)
    setSearch('')
    setPage(1)
  }

  const handleExport = () => {
    const params = new URLSearchParams()
    params.set('year', String(year))
    window.location.href = `/api/goals/export?${params.toString()}`
  }

  const handleSubmit = async () => {
    if (!formTitle.trim()) {
      toast.error(`${t('common.required')}: ${t('common.name')}`)
      return
    }
    const yNum = Number(formYear)
    if (!Number.isFinite(yNum) || yNum < 2000 || yNum > 2200) {
      toast.error(`${t('common.required')}: ${t('common.year')}`)
      return
    }

    const body: Record<string, unknown> = {
      year: yNum,
      title: formTitle.trim(),
      priority: Number(formPriority) || 3,
      progress: Math.max(0, Math.min(100, Math.round(Number(formProgress) || 0))),
      status: formStatus,
    }

    if (formDescription.trim()) {
      body.description = formDescription.trim()
    } else {
      body.description = null
    }

    if (formCategoryId !== NONE_SENTINEL) {
      body.goalCategoryId = formCategoryId
    } else {
      body.goalCategoryId = null
    }

    if (formTargetDate) {
      body.targetDate = formTargetDate
    } else {
      body.targetDate = null
    }

    if (formRequiredBudget.trim() !== '') {
      body.requiredBudget = formRequiredBudget.trim()
    } else {
      body.requiredBudget = null
    }
    if (formSavedBudget.trim() !== '') {
      body.savedBudget = formSavedBudget.trim()
    } else {
      body.savedBudget = null
    }

    if (formNote.trim()) {
      body.note = formNote.trim()
    } else {
      body.note = null
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

  // -- Category handlers --

  const openAddCat = () => {
    setNewCatName('')
    setNewCatColor(DEFAULT_COLOR)
    setAddCatOpen(true)
  }

  const handleAddCat = async () => {
    if (!newCatName.trim()) {
      toast.error(`${t('common.required')}: ${t('common.name')}`)
      return
    }
    setAddCatSubmitting(true)
    try {
      await createCatMutation.mutateAsync({ name: newCatName.trim(), color: newCatColor })
    } catch {
      // toasted by useApi
    } finally {
      setAddCatSubmitting(false)
    }
  }

  const openEditCat = (c: GoalCategoryWithCount) => {
    setEditCatTarget(c)
    setEditCatName(c.name)
    setEditCatColor(c.color ?? DEFAULT_COLOR)
  }

  const handleUpdateCat = async () => {
    if (!editCatTarget) return
    if (!editCatName.trim()) {
      toast.error(`${t('common.required')}: ${t('common.name')}`)
      return
    }
    setCatSubmitting(true)
    try {
      await updateCatMutation.mutateAsync({
        id: editCatTarget.id,
        body: { name: editCatName.trim(), color: editCatColor },
      })
    } catch {
      // toasted by useApi
    } finally {
      setCatSubmitting(false)
    }
  }

  const handleDeleteCat = async () => {
    if (!deleteCatTarget) return
    await deleteCatMutation.mutateAsync(deleteCatTarget.id)
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const priorityBadgeClass = (p: number) => {
    if (p <= 1) return 'border-expense/30 bg-expense/10 text-expense'
    if (p === 2) return 'border-warning/30 bg-warning/10 text-warning'
    if (p === 3) return 'border-info/30 bg-info/10 text-info'
    return 'border-muted-foreground/30 bg-muted text-muted-foreground'
  }

  const statusBadgeClass = (s: GoalStatus) => {
    if (s === 'completed') return 'border-income/30 bg-income/10 text-income'
    if (s === 'in_progress') return 'border-info/30 bg-info/10 text-info'
    if (s === 'on_hold') return 'border-warning/30 bg-warning/10 text-warning'
    if (s === 'cancelled') return 'border-expense/30 bg-expense/10 text-expense'
    return 'border-muted-foreground/30 bg-muted text-muted-foreground'
  }

  const statusLabel = (s: GoalStatus) => t(`goal.status.${s}`)

  // ---------------------------------------------------------------------------
  // Chart data
  // ---------------------------------------------------------------------------

  const chartData = useMemo<HBarDatum[]>(
    () =>
      summary.byCategory.map((c) => ({
        name: c.name,
        value: c.count,
        color: c.color || DEFAULT_COLOR,
      })),
    [summary.byCategory],
  )

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title={t('goal.title')}
        actions={
          <>
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={loading || summary.totalGoals === 0}
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">{t('common.exportCsv')}</span>
            </Button>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">{t('goal.add')}</span>
            </Button>
          </>
        }
      />

      {/* Year selector */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={() => {
            setYear((y) => y - 1)
            setPage(1)
          }}
          aria-label="Previous year"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Select
          value={String(year)}
          onValueChange={(v) => {
            setYear(Number(v))
            setPage(1)
          }}
        >
          <SelectTrigger className="w-[140px]" aria-label={t('common.year')}>
            <CalendarClock className="mr-2 h-4 w-4 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {yearOptions.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          onClick={() => {
            setYear((y) => y + 1)
            setPage(1)
          }}
          aria-label="Next year"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        {year !== currentYear && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setYear(currentYear)
              setPage(1)
            }}
          >
            {t('common.thisYear')}
          </Button>
        )}
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        <StatCard
          label={t('goal.totalGoals')}
          value={num(summary.totalGoals)}
          icon={Target}
          loading={loading}
        />
        <StatCard
          label={t('goal.completedGoals')}
          value={num(summary.completedGoals)}
          icon={CheckCircle2}
          tone="income"
          loading={loading}
        />
        <StatCard
          label={t('goal.inProgressGoals')}
          value={num(summary.inProgressGoals)}
          icon={CircleDollarSign}
          tone="info"
          loading={loading}
        />
        <StatCard
          label={t('goal.overallProgress')}
          value={`${num(Math.round(summary.overallProgress))}%`}
          icon={Gauge}
          loading={loading}
        />
        <StatCard
          label={t('goal.requiredTotal')}
          value={money(summary.requiredTotal)}
          icon={Wallet}
          loading={loading}
        />
        <StatCard
          label={t('goal.savedTotal')}
          value={money(summary.savedTotal)}
          icon={PiggyBank}
          tone="income"
          loading={loading}
        />
        <StatCard
          label={t('goal.remainingTotal')}
          value={money(summary.remainingTotal)}
          icon={CircleDollarSign}
          tone={Number(summary.remainingTotal) > 0 ? 'expense' : 'default'}
          loading={loading}
        />
      </div>

      {/* Category comparison chart */}
      <Card>
        <CardHeader>
          <CardTitle>{t('analytics.yearComparison')}</CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <EmptyState title={t('common.empty')} />
          ) : (
            <MiniHBarChart
              data={chartData}
              height={Math.max(180, chartData.length * 44 + 24)}
              formatValue={(v) => num(v)}
            />
          )}
        </CardContent>
      </Card>

      {/* Filter bar */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t('common.search')}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
                className="pl-8"
              />
            </div>
            <Select
              value={filterStatus}
              onValueChange={(v) => {
                setFilterStatus(v)
                setPage(1)
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('common.status')} />
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
            <Select
              value={filterCategoryId}
              onValueChange={(v) => {
                setFilterCategoryId(v)
                setPage(1)
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('common.category')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_SENTINEL}>{t('common.all')}</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filterPriority}
              onValueChange={(v) => {
                setFilterPriority(v)
                setPage(1)
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('common.priority')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_SENTINEL}>{t('common.all')}</SelectItem>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={String(p)}>
                    {p} — {t(`goal.priorities.${p}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={clearFilters}
                disabled={!hasFilters}
                className="flex-1"
              >
                <X className="h-4 w-4" />
                <span className="hidden sm:inline">{t('common.clearFilters')}</span>
              </Button>
              <Button
                variant="outline"
                onClick={() => setManageCatsOpen(true)}
                aria-label={t('goal.category')}
              >
                <Tag className="h-4 w-4" />
                <span className="hidden md:inline">{t('goal.category')}</span>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Goals grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="space-y-3 pt-6">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-2 w-full" />
                <Skeleton className="h-4 w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title={t('goal.empty')}
          action={
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              {t('goal.add')}
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((g) => (
            <Card key={g.id} className="flex flex-col">
              <CardContent className="flex flex-1 flex-col gap-3 pt-6">
                {/* Header: badges + actions */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge
                        variant="outline"
                        className={priorityBadgeClass(g.priority)}
                      >
                        {t(`goal.priorities.${g.priority}`)}
                      </Badge>
                      {g.goalCategory && (
                        <Badge
                          variant="outline"
                          style={{
                            color: g.goalCategory.color ?? DEFAULT_COLOR,
                            borderColor: g.goalCategory.color ?? DEFAULT_COLOR,
                          }}
                        >
                          {g.goalCategory.name}
                        </Badge>
                      )}
                    </div>
                    <h3 className="mt-1.5 truncate text-base font-semibold">
                      {g.title}
                    </h3>
                    {g.description && (
                      <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                        {g.description}
                      </p>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="-mr-2 -mt-1 h-7 w-7"
                        aria-label={t('common.actions')}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(g)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        {t('common.edit')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-expense"
                        onClick={() => setDeleteTarget(g)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {t('common.delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* Status */}
                <Badge
                  variant="outline"
                  className={cn('w-fit', statusBadgeClass(g.status))}
                >
                  {statusLabel(g.status)}
                </Badge>

                {/* Progress */}
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {t('common.progress')}
                    </span>
                    <span className="font-medium tabular-nums">
                      {num(g.progress)}%
                    </span>
                  </div>
                  <Progress value={g.progress} className="h-2" />
                </div>

                {/* Budget row */}
                {g.requiredBudget && (
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">
                        {t('goal.requiredBudget')}
                      </p>
                      <MoneyText value={g.requiredBudget} />
                    </div>
                    <div>
                      <p className="text-muted-foreground">
                        {t('goal.savedBudget')}
                      </p>
                      <MoneyText
                        value={g.savedBudget ?? '0'}
                        tone="income"
                      />
                    </div>
                    <div>
                      <p className="text-muted-foreground">
                        {t('goal.remainingBudget')}
                      </p>
                      <MoneyText
                        value={g.remainingBudget}
                        tone={
                          Number(g.remainingBudget) < 0 ? 'expense' : 'default'
                        }
                      />
                    </div>
                  </div>
                )}

                {/* Footer */}
                <div className="mt-auto space-y-1 text-xs text-muted-foreground">
                  {g.targetDate && (
                    <div className="flex items-center gap-1.5">
                      <CalendarClock className="h-3.5 w-3.5" />
                      <span>{date(g.targetDate)}</span>
                    </div>
                  )}
                  {g.note && <p className="line-clamp-2">{g.note}</p>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>{editing ? t('goal.edit') : t('goal.add')}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t('common.year')}</Label>
                <Input
                  type="number"
                  min={2000}
                  max={2200}
                  value={formYear}
                  onChange={(e) => setFormYear(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('common.status')}</Label>
                <Select
                  value={formStatus}
                  onValueChange={(v) => isGoalStatus(v) && setFormStatus(v)}
                >
                  <SelectTrigger>
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
            </div>

            <div className="space-y-1.5">
              <Label>{t('common.name')}</Label>
              <Input
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder={t('common.name')}
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t('common.description')}</Label>
              <Textarea
                rows={2}
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
              />
            </div>

            {/* Category with inline add + manage */}
            <div className="space-y-1.5">
              <Label>{t('goal.category')}</Label>
              <div className="flex gap-2">
                <Select value={formCategoryId} onValueChange={setFormCategoryId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_SENTINEL}>
                      {t('common.none')}
                    </SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={openAddCat}
                  aria-label={t('cat.add')}
                >
                  <Plus className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setManageCatsOpen(true)}
                  aria-label={t('cat.title')}
                >
                  <Tag className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>{t('common.priority')}</Label>
                <Select value={formPriority} onValueChange={setFormPriority}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={String(p)}>
                        {p} — {t(`goal.priorities.${p}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('goal.progress')}</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={formProgress}
                  onChange={(e) => setFormProgress(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('goal.targetDate')}</Label>
                <Input
                  type="date"
                  value={formTargetDate}
                  onChange={(e) => setFormTargetDate(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t('goal.requiredBudget')}</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={formRequiredBudget}
                  onChange={(e) => setFormRequiredBudget(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('goal.savedBudget')}</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={formSavedBudget}
                  onChange={(e) => setFormSavedBudget(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{t('goal.note')}</Label>
              <Textarea
                rows={2}
                value={formNote}
                onChange={(e) => setFormNote(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting
                ? t('common.loading')
                : editing
                  ? t('common.save')
                  : t('common.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Inline add category dialog */}
      <Dialog open={addCatOpen} onOpenChange={setAddCatOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t('cat.add')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>{t('common.name')}</Label>
              <Input
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder={t('common.name')}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('common.color')}</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={newCatColor}
                  onChange={(e) => setNewCatColor(e.target.value)}
                  className="h-9 w-12 rounded border border-input bg-background"
                  aria-label={t('common.color')}
                />
                <Input
                  value={newCatColor}
                  onChange={(e) => setNewCatColor(e.target.value)}
                  className="flex-1"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddCatOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleAddCat} disabled={addCatSubmitting}>
              {addCatSubmitting ? t('common.loading') : t('common.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage categories dialog */}
      <Dialog open={manageCatsOpen} onOpenChange={setManageCatsOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{t('cat.title')}</DialogTitle>
            <DialogDescription>{t('goal.category')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {catsQuery.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : categories.length === 0 ? (
              <EmptyState
                title={t('cat.empty')}
                action={
                  <Button variant="outline" size="sm" onClick={openAddCat}>
                    <Plus className="h-4 w-4" />
                    {t('cat.add')}
                  </Button>
                }
              />
            ) : (
              <ScrollArea className="max-h-72">
                <div className="space-y-2 pr-2">
                  {categories.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center gap-2 rounded-md border p-2"
                    >
                      <span
                        className="h-4 w-4 shrink-0 rounded-full"
                        style={{ backgroundColor: c.color ?? DEFAULT_COLOR }}
                      />
                      {editCatTarget?.id === c.id ? (
                        <>
                          <Input
                            value={editCatName}
                            onChange={(e) => setEditCatName(e.target.value)}
                            className="h-8 flex-1"
                          />
                          <input
                            type="color"
                            value={editCatColor}
                            onChange={(e) => setEditCatColor(e.target.value)}
                            className="h-8 w-8 shrink-0 rounded border border-input bg-background"
                            aria-label={t('common.color')}
                          />
                          <Button
                            size="sm"
                            onClick={handleUpdateCat}
                            disabled={catSubmitting}
                          >
                            {t('common.save')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditCatTarget(null)}
                          >
                            {t('common.cancel')}
                          </Button>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 truncate text-sm font-medium">
                            {c.name}
                          </span>
                          {typeof c._count?.goals === 'number' && (
                            <Badge variant="secondary" className="tabular-nums">
                              {num(c._count.goals)}
                            </Badge>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => openEditCat(c)}
                            aria-label={t('common.edit')}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-expense"
                            onClick={() => setDeleteCatTarget(c)}
                            aria-label={t('common.delete')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
          <DialogFooter className="sm:justify-between">
            <Button variant="outline" onClick={openAddCat}>
              <Plus className="h-4 w-4" />
              {t('cat.add')}
            </Button>
            <Button variant="ghost" onClick={() => setManageCatsOpen(false)}>
              {t('common.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete goal confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title={t('common.delete')}
        description={deleteTarget?.title}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={handleDelete}
      />

      {/* Delete category confirmation */}
      <ConfirmDialog
        open={!!deleteCatTarget}
        onOpenChange={(v) => !v && setDeleteCatTarget(null)}
        title={t('common.delete')}
        description={deleteCatTarget?.name}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={handleDeleteCat}
      />
    </div>
  )
}
