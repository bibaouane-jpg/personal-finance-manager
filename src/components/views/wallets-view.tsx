'use client'

import { useMemo, useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Plus,
  Download,
  MoreHorizontal,
  Eye,
  Pencil,
  Trash2,
  ArrowRightLeft,
  Banknote,
  Scale,
  Wallet as WalletIcon,
  PiggyBank,
  Landmark,
  HelpCircle,
  History as HistoryIcon,
  Search,
} from 'lucide-react'

import { useI18n } from '@/lib/use-i18n'
import { useApi } from '@/lib/use-api'
import { toCents, fromCents, toLocalDateString } from '@/lib/money'
import { cn } from '@/lib/utils'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { EmptyState, PageHeader, MoneyText } from '@/components/shared'
import { ConfirmDialog } from '@/components/confirm-dialog'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WalletType = 'bank' | 'cash' | 'savings' | 'other'

interface Wallet {
  id: string
  name: string
  type: WalletType
  color: string | null
  description: string | null
  initialBalance: string
  balance: string
  currentBalance?: string
  allowOverdraft: boolean
  active: boolean
  createdAt: string
}

interface WalletsListResponse {
  wallets: Wallet[]
  combined: string
  bankSubtotal: string
  cashSubtotal: string
  savingsSubtotal: string
  otherSubtotal: string
}

interface WalletDetailResponse extends Wallet {
  recentEntries?: unknown[]
}

interface LedgerEntry {
  id: string
  walletId: string
  amount: string
  operationType: string
  direction: 'credit' | 'debit'
  financialDate: string
  comment: string | null
  createdAt: string
}

interface HistoryResponse {
  items: LedgerEntry[]
  total: number
  page: number
  pageSize: number
}

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const WALLET_TYPES: WalletType[] = ['bank', 'cash', 'savings', 'other']
const HISTORY_PAGE_SIZE = 10
const DEFAULT_COLOR = '#2563eb'

function todayLocal(): string {
  return toLocalDateString(new Date())
}

function walletBalance(w: Wallet): string {
  return w.currentBalance ?? w.balance
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

const TYPE_ICON: Record<WalletType, typeof WalletIcon> = {
  bank: Landmark,
  cash: WalletIcon,
  savings: PiggyBank,
  other: HelpCircle,
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WalletsView() {
  const { t, money, date } = useI18n()
  const api = useApi()
  const qc = useQueryClient()

  // ---- Wallets list ----
  const walletsQuery = useQuery<WalletsListResponse>({
    queryKey: ['wallets'],
    queryFn: () => api.get<WalletsListResponse>('/api/wallets'),
  })

  const wallets = walletsQuery.data?.wallets ?? []
  const combined = walletsQuery.data?.combined ?? '0.00'
  const bankSubtotal = walletsQuery.data?.bankSubtotal ?? '0.00'
  const cashSubtotal = walletsQuery.data?.cashSubtotal ?? '0.00'
  const loading = walletsQuery.isLoading

  // ---- Wallet create / edit dialog ----
  const [walletDialogOpen, setWalletDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Wallet | null>(null)
  const [submittingWallet, setSubmittingWallet] = useState(false)

  const [formName, setFormName] = useState('')
  const [formType, setFormType] = useState<WalletType>('bank')
  const [formColor, setFormColor] = useState(DEFAULT_COLOR)
  const [formDescription, setFormDescription] = useState('')
  const [formInitialBalance, setFormInitialBalance] = useState('0')
  const [formAllowOverdraft, setFormAllowOverdraft] = useState(false)
  const [formActive, setFormActive] = useState(true)

  // ---- Transfer dialog ----
  const [transferOpen, setTransferOpen] = useState(false)
  const [transferSource, setTransferSource] = useState('')
  const [transferDest, setTransferDest] = useState('')
  const [transferAmount, setTransferAmount] = useState('')
  const [transferDate, setTransferDate] = useState(todayLocal())
  const [transferComment, setTransferComment] = useState('')
  const [submittingTransfer, setSubmittingTransfer] = useState(false)

  // ---- Withdraw dialog ----
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [withdrawType, setWithdrawType] = useState<'external' | 'internal'>('external')
  const [withdrawSource, setWithdrawSource] = useState('')
  const [withdrawDest, setWithdrawDest] = useState('')
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [withdrawDate, setWithdrawDate] = useState(todayLocal())
  const [withdrawComment, setWithdrawComment] = useState('')
  const [submittingWithdraw, setSubmittingWithdraw] = useState(false)

  // ---- Adjust dialog ----
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [adjustWallet, setAdjustWallet] = useState<Wallet | null>(null)
  const [adjustMode, setAdjustMode] = useState<'actual' | 'adjustment'>('actual')
  const [adjustActual, setAdjustActual] = useState('')
  const [adjustAdjustment, setAdjustAdjustment] = useState('')
  const [adjustDate, setAdjustDate] = useState(todayLocal())
  const [adjustReason, setAdjustReason] = useState('')
  const [submittingAdjust, setSubmittingAdjust] = useState(false)

  const adjustDetailQuery = useQuery<WalletDetailResponse>({
    queryKey: ['wallet', adjustWallet?.id],
    queryFn: () => api.get<WalletDetailResponse>(`/api/wallets/${adjustWallet!.id}`),
    enabled: !!adjustWallet && adjustOpen,
  })

  // ---- History dialog ----
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyWallet, setHistoryWallet] = useState<Wallet | null>(null)
  const [historyPage, setHistoryPage] = useState(1)
  const [historyFrom, setHistoryFrom] = useState('')
  const [historyTo, setHistoryTo] = useState('')
  const [historySearch, setHistorySearch] = useState('')

  const historyParams = useMemo(
    () => ({
      from: historyFrom || undefined,
      to: historyTo || undefined,
      search: historySearch.trim() || undefined,
      page: historyPage,
      pageSize: HISTORY_PAGE_SIZE,
    }),
    [historyFrom, historyTo, historySearch, historyPage],
  )

  const historyQuery = useQuery<HistoryResponse>({
    queryKey: ['wallet', historyWallet?.id, 'history', historyParams],
    queryFn: () =>
      api.get<HistoryResponse>(`/api/wallets/${historyWallet!.id}/history`, {
        query: historyParams,
      }),
    enabled: !!historyWallet && historyOpen,
  })

  // ---- Delete ----
  const [deleteTarget, setDeleteTarget] = useState<Wallet | null>(null)

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/api/wallets', body),
    onSuccess: () => {
      toast.success(t('wal.created'))
      qc.invalidateQueries({ queryKey: ['wallets'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['analytics'] })
      setWalletDialogOpen(false)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.put(`/api/wallets/${id}`, body),
    onSuccess: () => {
      toast.success(t('wal.updated'))
      qc.invalidateQueries({ queryKey: ['wallets'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['analytics'] })
      setWalletDialogOpen(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del(`/api/wallets/${id}`),
    onSuccess: () => {
      toast.success(t('common.delete'))
      qc.invalidateQueries({ queryKey: ['wallets'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['analytics'] })
      setDeleteTarget(null)
    },
  })

  const transferMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/api/transfers', body),
    onSuccess: () => {
      toast.success(t('transfer.created'))
      qc.invalidateQueries({ queryKey: ['wallets'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['analytics'] })
      setTransferOpen(false)
    },
  })

  const withdrawMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/api/withdrawals', body),
    onSuccess: () => {
      toast.success(t('withdraw.created'))
      qc.invalidateQueries({ queryKey: ['wallets'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['analytics'] })
      setWithdrawOpen(false)
    },
  })

  const adjustMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/api/adjustments', body),
    onSuccess: () => {
      toast.success(t('adjust.created'))
      qc.invalidateQueries({ queryKey: ['wallets'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['analytics'] })
      setAdjustOpen(false)
    },
  })

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  // Reset history pagination when filters change
  useEffect(() => {
    setHistoryPage(1)
  }, [historyFrom, historyTo, historySearch, historyWallet?.id])

  // Auto-clamp history page if drifted past last page
  const historyTotal = historyQuery.data?.total ?? 0
  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE))
  useEffect(() => {
    if (historyTotal > 0 && historyPage > historyTotalPages) {
      setHistoryPage(historyTotalPages)
    }
  }, [historyTotal, historyTotalPages, historyPage])

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const openCreate = () => {
    setEditing(null)
    setFormName('')
    setFormType('bank')
    setFormColor(DEFAULT_COLOR)
    setFormDescription('')
    setFormInitialBalance('0')
    setFormAllowOverdraft(false)
    setFormActive(true)
    setWalletDialogOpen(true)
  }

  const openEdit = (w: Wallet) => {
    setEditing(w)
    setFormName(w.name)
    setFormType(w.type)
    setFormColor(w.color ?? DEFAULT_COLOR)
    setFormDescription(w.description ?? '')
    setFormInitialBalance(w.initialBalance)
    setFormAllowOverdraft(w.allowOverdraft)
    setFormActive(w.active)
    setWalletDialogOpen(true)
  }

  const handleWalletSubmit = async () => {
    if (!formName.trim()) {
      toast.error(`${t('common.required')}: ${t('common.name')}`)
      return
    }
    const body: Record<string, unknown> = {
      name: formName.trim(),
      type: formType,
      color: formColor,
      allowOverdraft: formAllowOverdraft,
      active: formActive,
    }
    if (formDescription.trim()) body.description = formDescription.trim()

    setSubmittingWallet(true)
    try {
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, body })
      } else {
        const initBal = Number(formInitialBalance)
        if (!Number.isFinite(initBal)) {
          toast.error(`${t('common.required')}: ${t('wal.initialBalance')}`)
          return
        }
        body.initialBalance = initBal.toFixed(2)
        await createMutation.mutateAsync(body)
      }
    } catch {
      // useApi already toasted the error.
    } finally {
      setSubmittingWallet(false)
    }
  }

  const openTransfer = (w: Wallet) => {
    setTransferSource(w.id)
    setTransferDest('')
    setTransferAmount('')
    setTransferDate(todayLocal())
    setTransferComment('')
    setTransferOpen(true)
  }

  const handleTransferSubmit = async () => {
    if (!transferSource) {
      toast.error(`${t('common.required')}: ${t('transfer.source')}`)
      return
    }
    if (!transferDest) {
      toast.error(`${t('common.required')}: ${t('transfer.destination')}`)
      return
    }
    if (transferSource === transferDest) {
      toast.error(t('transfer.sameWallet'))
      return
    }
    const amt = Number(transferAmount)
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error(t('transfer.invalidAmount'))
      return
    }
    if (!transferDate) {
      toast.error(`${t('common.required')}: ${t('common.date')}`)
      return
    }
    const body: Record<string, unknown> = {
      sourceWalletId: transferSource,
      destWalletId: transferDest,
      amount: amt.toFixed(2),
      financialDate: transferDate,
    }
    if (transferComment.trim()) body.comment = transferComment.trim()
    setSubmittingTransfer(true)
    try {
      await transferMutation.mutateAsync(body)
    } catch {
      // useApi already toasted the error.
    } finally {
      setSubmittingTransfer(false)
    }
  }

  const openWithdraw = (w: Wallet) => {
    setWithdrawSource(w.id)
    setWithdrawType('external')
    setWithdrawDest('')
    setWithdrawAmount('')
    setWithdrawDate(todayLocal())
    setWithdrawComment('')
    setWithdrawOpen(true)
  }

  const handleWithdrawSubmit = async () => {
    if (!withdrawSource) {
      toast.error(`${t('common.required')}: ${t('transfer.source')}`)
      return
    }
    if (withdrawType === 'internal') {
      if (!withdrawDest) {
        toast.error(`${t('common.required')}: ${t('withdraw.destination')}`)
        return
      }
      if (withdrawSource === withdrawDest) {
        toast.error(t('transfer.sameWallet'))
        return
      }
    }
    const amt = Number(withdrawAmount)
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error(t('transfer.invalidAmount'))
      return
    }
    if (!withdrawDate) {
      toast.error(`${t('common.required')}: ${t('common.date')}`)
      return
    }
    const body: Record<string, unknown> = {
      sourceWalletId: withdrawSource,
      withdrawalType: withdrawType,
      amount: amt.toFixed(2),
      financialDate: withdrawDate,
    }
    if (withdrawType === 'internal') body.destWalletId = withdrawDest
    if (withdrawComment.trim()) body.comment = withdrawComment.trim()
    setSubmittingWithdraw(true)
    try {
      await withdrawMutation.mutateAsync(body)
    } catch {
      // useApi already toasted the error.
    } finally {
      setSubmittingWithdraw(false)
    }
  }

  const openAdjust = (w: Wallet) => {
    setAdjustWallet(w)
    setAdjustMode('actual')
    setAdjustActual('')
    setAdjustAdjustment('')
    setAdjustDate(todayLocal())
    setAdjustReason('')
    setAdjustOpen(true)
  }

  const handleAdjustSubmit = async () => {
    if (!adjustWallet) return
    if (!adjustDate) {
      toast.error(`${t('common.required')}: ${t('common.date')}`)
      return
    }
    if (!adjustReason.trim() || adjustReason.trim().length < 3) {
      toast.error(t('adjust.reasonRequired'))
      return
    }
    const body: Record<string, unknown> = {
      walletId: adjustWallet.id,
      financialDate: adjustDate,
      reason: adjustReason.trim(),
    }
    if (adjustMode === 'actual') {
      const actual = Number(adjustActual)
      if (!Number.isFinite(actual)) {
        toast.error(`${t('common.required')}: ${t('adjust.actualBalance')}`)
        return
      }
      body.actualBalance = actual.toFixed(2)
    } else {
      const adj = Number(adjustAdjustment)
      if (!Number.isFinite(adj)) {
        toast.error(`${t('common.required')}: ${t('adjust.adjustment')}`)
        return
      }
      body.adjustment = adj.toFixed(2)
    }
    setSubmittingAdjust(true)
    try {
      await adjustMutation.mutateAsync(body)
    } catch {
      // useApi already toasted the error.
    } finally {
      setSubmittingAdjust(false)
    }
  }

  const openHistory = (w: Wallet) => {
    setHistoryWallet(w)
    setHistoryPage(1)
    setHistoryFrom('')
    setHistoryTo('')
    setHistorySearch('')
    setHistoryOpen(true)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
    } catch {
      // useApi already toasted the error.
    }
  }

  const handleExportList = () => {
    window.location.href = '/api/wallets/export'
  }

  const handleExportHistory = () => {
    if (!historyWallet) return
    const params = new URLSearchParams()
    if (historyFrom) params.set('from', historyFrom)
    if (historyTo) params.set('to', historyTo)
    if (historySearch.trim()) params.set('search', historySearch.trim())
    const qs = params.toString()
    window.location.href = `/api/wallets/${historyWallet.id}/history/export${qs ? `?${qs}` : ''}`
  }

  // ---------------------------------------------------------------------------
  // Derived render helpers
  // ---------------------------------------------------------------------------

  const typeLabel = (type: WalletType) => t(`wal.${type}`)
  const operationLabel = (op: string) => t(`wal.operation.${op}`)

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('wal.title')}
        actions={
          <>
            <Button variant="outline" onClick={handleExportList} disabled={loading || wallets.length === 0}>
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">{t('common.exportCsv')}</span>
            </Button>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              {t('wal.add')}
            </Button>
          </>
        }
      />

      {/* Summary strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryStatCard
          label={t('wal.combined')}
          value={combined}
          icon={Scale}
          tone="info"
          loading={loading}
        />
        <SummaryStatCard
          label={t('wal.bankSubtotal')}
          value={bankSubtotal}
          icon={Landmark}
          tone="default"
          loading={loading}
        />
        <SummaryStatCard
          label={t('wal.cashSubtotal')}
          value={cashSubtotal}
          icon={Banknote}
          tone="default"
          loading={loading}
        />
      </div>

      {/* Wallet cards grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="mt-2 h-4 w-20" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-40" />
                <Skeleton className="mt-2 h-3 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : wallets.length === 0 ? (
        <EmptyState
          title={t('wal.empty')}
          action={
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              {t('wal.add')}
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {wallets.map((w) => {
            const TypeIcon = TYPE_ICON[w.type] ?? WalletIcon
            return (
              <Card
                key={w.id}
                className="overflow-hidden transition-shadow hover:shadow-md"
                style={{ borderTop: `4px solid ${w.color ?? DEFAULT_COLOR}` }}
              >
                <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                  <div className="space-y-1.5 pr-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md"
                        style={{ backgroundColor: `${w.color ?? DEFAULT_COLOR}20`, color: w.color ?? DEFAULT_COLOR }}
                        aria-hidden
                      >
                        <TypeIcon className="h-4 w-4" />
                      </span>
                      <CardTitle className="text-base leading-tight">{w.name}</CardTitle>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="outline" className="text-[10px]">
                        {typeLabel(w.type)}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px]',
                          w.active
                            ? 'border-income/30 text-income'
                            : 'border-expense/30 text-expense',
                        )}
                      >
                        {w.active ? t('common.active') : t('common.inactive')}
                      </Badge>
                      {w.allowOverdraft && (
                        <Badge variant="outline" className="text-[10px] border-warning/30 text-warning">
                          {t('wal.allowOverdraft')}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">{t('common.actions')}</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem onClick={() => openTransfer(w)}>
                        <ArrowRightLeft className="h-4 w-4" />
                        {t('wal.transfer')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openWithdraw(w)}>
                        <Banknote className="h-4 w-4" />
                        {t('wal.withdraw')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openAdjust(w)}>
                        <Scale className="h-4 w-4" />
                        {t('wal.adjust')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openHistory(w)}>
                        <HistoryIcon className="h-4 w-4" />
                        {t('wal.history')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => openEdit(w)}>
                        <Pencil className="h-4 w-4" />
                        {t('common.edit')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setDeleteTarget(w)}
                      >
                        <Trash2 className="h-4 w-4" />
                        {t('common.delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">{t('wal.currentBalance')}</p>
                    <p className="text-2xl font-bold tabular-nums">{money(walletBalance(w))}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('wal.initialBalance')}: {money(w.initialBalance)}
                    </p>
                    {w.description && (
                      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                        {w.description}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Create / Edit wallet dialog                                       */}
      {/* ----------------------------------------------------------------- */}
      <Dialog open={walletDialogOpen} onOpenChange={setWalletDialogOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>{editing ? t('wal.edit') : t('wal.add')}</DialogTitle>
            <DialogDescription>{t('wal.title')}</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="w-name">
                {t('common.name')} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="w-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder={t('common.name')}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="w-type">{t('common.type')}</Label>
                <Select value={formType} onValueChange={(v) => setFormType(v as WalletType)}>
                  <SelectTrigger id="w-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WALLET_TYPES.map((typ) => (
                      <SelectItem key={typ} value={typ}>
                        {typeLabel(typ)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="w-color">{t('common.color')}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="w-color"
                    type="color"
                    value={formColor}
                    onChange={(e) => setFormColor(e.target.value)}
                    className="h-9 w-14 cursor-pointer p-1"
                  />
                  <span className="text-xs text-muted-foreground tabular-nums">{formColor}</span>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="w-initial">{t('wal.initialBalance')}</Label>
              <Input
                id="w-initial"
                type="number"
                step="0.01"
                inputMode="decimal"
                value={formInitialBalance}
                onChange={(e) => setFormInitialBalance(e.target.value)}
                disabled={!!editing}
                placeholder="0.00"
              />
              {editing && (
                <p className="text-xs text-muted-foreground">
                  {t('wal.initialBalance')} —{' '}
                  <span className="text-warning">
                    {t('common.edit')}: {t('wal.adjust')}
                  </span>
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="w-desc">{t('common.description')}</Label>
              <Textarea
                id="w-desc"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                rows={2}
                placeholder={t('common.description')}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex items-center justify-between rounded-md border p-3">
                <div className="space-y-0.5 pr-3">
                  <Label htmlFor="w-overdraft" className="text-sm">
                    {t('wal.allowOverdraft')}
                  </Label>
                </div>
                <Switch
                  id="w-overdraft"
                  checked={formAllowOverdraft}
                  onCheckedChange={setFormAllowOverdraft}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div className="space-y-0.5 pr-3">
                  <Label htmlFor="w-active" className="text-sm">
                    {t('common.status')}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="w-active"
                    checked={formActive}
                    onCheckedChange={setFormActive}
                  />
                  <span className="text-xs text-muted-foreground">
                    {formActive ? t('common.active') : t('common.inactive')}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setWalletDialogOpen(false)}
              disabled={submittingWallet}
            >
              {t('common.cancel')}
            </Button>
            <Button onClick={handleWalletSubmit} disabled={submittingWallet}>
              {submittingWallet ? t('common.loading') : editing ? t('common.save') : t('common.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ----------------------------------------------------------------- */}
      {/* Transfer dialog                                                   */}
      {/* ----------------------------------------------------------------- */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{t('transfer.title')}</DialogTitle>
            <DialogDescription>{t('wal.transfer')}</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="t-source">
                  {t('transfer.source')} <span className="text-destructive">*</span>
                </Label>
                <Select value={transferSource} onValueChange={setTransferSource}>
                  <SelectTrigger id="t-source" className="w-full">
                    <SelectValue placeholder={t('common.wallet')} />
                  </SelectTrigger>
                  <SelectContent>
                    {wallets.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: w.color ?? DEFAULT_COLOR }}
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
                <Label htmlFor="t-dest">
                  {t('transfer.destination')} <span className="text-destructive">*</span>
                </Label>
                <Select value={transferDest} onValueChange={setTransferDest}>
                  <SelectTrigger id="t-dest" className="w-full">
                    <SelectValue placeholder={t('common.wallet')} />
                  </SelectTrigger>
                  <SelectContent>
                    {wallets
                      .filter((w) => w.id !== transferSource)
                      .map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          <span className="inline-flex items-center gap-2">
                            <span
                              className="inline-block h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: w.color ?? DEFAULT_COLOR }}
                              aria-hidden
                            />
                            {w.name}
                          </span>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="t-amount">
                  {t('common.amount')} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="t-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t-date">
                  {t('common.date')} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="t-date"
                  type="date"
                  value={transferDate}
                  onChange={(e) => setTransferDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="t-comment">{t('common.comment')}</Label>
              <Textarea
                id="t-comment"
                value={transferComment}
                onChange={(e) => setTransferComment(e.target.value)}
                rows={2}
                placeholder={t('common.comment')}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTransferOpen(false)}
              disabled={submittingTransfer}
            >
              {t('common.cancel')}
            </Button>
            <Button onClick={handleTransferSubmit} disabled={submittingTransfer}>
              {submittingTransfer ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ----------------------------------------------------------------- */}
      {/* Withdraw dialog                                                   */}
      {/* ----------------------------------------------------------------- */}
      <Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{t('withdraw.title')}</DialogTitle>
            <DialogDescription>{t('wal.withdraw')}</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-1.5">
              <Label>{t('withdraw.type')}</Label>
              <RadioGroup
                value={withdrawType}
                onValueChange={(v) => setWithdrawType(v as 'external' | 'internal')}
                className="grid grid-cols-1 gap-2 sm:grid-cols-2"
              >
                <Label
                  htmlFor="wt-external"
                  className="flex cursor-pointer items-center gap-2 rounded-md border p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
                >
                  <RadioGroupItem id="wt-external" value="external" />
                  <span className="text-sm">{t('withdraw.external')}</span>
                </Label>
                <Label
                  htmlFor="wt-internal"
                  className="flex cursor-pointer items-center gap-2 rounded-md border p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
                >
                  <RadioGroupItem id="wt-internal" value="internal" />
                  <span className="text-sm">{t('withdraw.internal')}</span>
                </Label>
              </RadioGroup>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="wd-source">
                  {t('transfer.source')} <span className="text-destructive">*</span>
                </Label>
                <Select value={withdrawSource} onValueChange={setWithdrawSource}>
                  <SelectTrigger id="wd-source" className="w-full">
                    <SelectValue placeholder={t('common.wallet')} />
                  </SelectTrigger>
                  <SelectContent>
                    {wallets.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: w.color ?? DEFAULT_COLOR }}
                            aria-hidden
                          />
                          {w.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {withdrawType === 'internal' && (
                <div className="space-y-1.5">
                  <Label htmlFor="wd-dest">
                    {t('withdraw.destination')} <span className="text-destructive">*</span>
                  </Label>
                  <Select value={withdrawDest} onValueChange={setWithdrawDest}>
                    <SelectTrigger id="wd-dest" className="w-full">
                      <SelectValue placeholder={t('common.wallet')} />
                    </SelectTrigger>
                    <SelectContent>
                      {wallets
                        .filter((w) => w.id !== withdrawSource)
                        .map((w) => (
                          <SelectItem key={w.id} value={w.id}>
                            <span className="inline-flex items-center gap-2">
                              <span
                                className="inline-block h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: w.color ?? DEFAULT_COLOR }}
                                aria-hidden
                              />
                              {w.name}
                            </span>
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="wd-amount">
                  {t('common.amount')} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="wd-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wd-date">
                  {t('common.date')} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="wd-date"
                  type="date"
                  value={withdrawDate}
                  onChange={(e) => setWithdrawDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="wd-comment">{t('common.comment')}</Label>
              <Textarea
                id="wd-comment"
                value={withdrawComment}
                onChange={(e) => setWithdrawComment(e.target.value)}
                rows={2}
                placeholder={t('common.comment')}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setWithdrawOpen(false)}
              disabled={submittingWithdraw}
            >
              {t('common.cancel')}
            </Button>
            <Button onClick={handleWithdrawSubmit} disabled={submittingWithdraw}>
              {submittingWithdraw ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ----------------------------------------------------------------- */}
      {/* Adjust dialog                                                     */}
      {/* ----------------------------------------------------------------- */}
      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{t('adjust.title')}</DialogTitle>
            <DialogDescription>
              {adjustWallet ? adjustWallet.name : ''}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 rounded-md border p-3">
                <p className="text-xs text-muted-foreground">{t('adjust.systemBalance')}</p>
                <p className="text-lg font-semibold tabular-nums">
                  {adjustDetailQuery.isLoading
                    ? '…'
                    : money(
                        adjustDetailQuery.data?.balance ??
                          adjustWallet?.balance ??
                          '0.00',
                      )}
                </p>
              </div>
              <div className="space-y-1 rounded-md border p-3">
                <p className="text-xs text-muted-foreground">{t('wal.initialBalance')}</p>
                <p className="text-lg font-semibold tabular-nums text-muted-foreground">
                  {money(adjustWallet?.initialBalance ?? '0.00')}
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{t('adjust.title')}</Label>
              <RadioGroup
                value={adjustMode}
                onValueChange={(v) => setAdjustMode(v as 'actual' | 'adjustment')}
                className="grid grid-cols-1 gap-2 sm:grid-cols-2"
              >
                <Label
                  htmlFor="am-actual"
                  className="flex cursor-pointer items-center gap-2 rounded-md border p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
                >
                  <RadioGroupItem id="am-actual" value="actual" />
                  <span className="text-sm">{t('adjust.actualBalance')}</span>
                </Label>
                <Label
                  htmlFor="am-adj"
                  className="flex cursor-pointer items-center gap-2 rounded-md border p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
                >
                  <RadioGroupItem id="am-adj" value="adjustment" />
                  <span className="text-sm">{t('adjust.adjustment')}</span>
                </Label>
              </RadioGroup>
            </div>

            {adjustMode === 'actual' ? (
              <div className="space-y-1.5">
                <Label htmlFor="a-actual">
                  {t('adjust.actualBalance')} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="a-actual"
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={adjustActual}
                  onChange={(e) => setAdjustActual(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="a-adj">
                  {t('adjust.adjustment')} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="a-adj"
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={adjustAdjustment}
                  onChange={(e) => setAdjustAdjustment(e.target.value)}
                  placeholder="-100.00"
                />
                <p className="text-xs text-muted-foreground">
                  {t('adjust.adjustment')} · +/−
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="a-date">
                {t('common.date')} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="a-date"
                type="date"
                value={adjustDate}
                onChange={(e) => setAdjustDate(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="a-reason">
                {t('common.reason')} <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="a-reason"
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                rows={3}
                placeholder={t('common.reason')}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAdjustOpen(false)}
              disabled={submittingAdjust}
            >
              {t('common.cancel')}
            </Button>
            <Button onClick={handleAdjustSubmit} disabled={submittingAdjust}>
              {submittingAdjust ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ----------------------------------------------------------------- */}
      {/* History dialog (full-width)                                       */}
      {/* ----------------------------------------------------------------- */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="sm:max-w-[900px]">
          <DialogHeader>
            <DialogTitle>
              {t('wal.history')}
              {historyWallet ? ` — ${historyWallet.name}` : ''}
            </DialogTitle>
            <DialogDescription>{t('wal.history')}</DialogDescription>
          </DialogHeader>

          {/* History filters */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="h-from" className="text-xs text-muted-foreground">
                {t('common.from')}
              </Label>
              <Input
                id="h-from"
                type="date"
                value={historyFrom}
                onChange={(e) => setHistoryFrom(e.target.value)}
                className="w-full"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="h-to" className="text-xs text-muted-foreground">
                {t('common.to')}
              </Label>
              <Input
                id="h-to"
                type="date"
                value={historyTo}
                onChange={(e) => setHistoryTo(e.target.value)}
                className="w-full"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="h-search" className="text-xs text-muted-foreground">
                {t('common.search')}
              </Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="h-search"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder={t('common.comment')}
                  className="pl-8"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportHistory}
              disabled={!historyWallet || historyQuery.isLoading || historyTotal === 0}
            >
              <Download className="h-4 w-4" />
              {t('common.exportCsv')}
            </Button>
          </div>

          {/* History table */}
          <div className="max-h-[460px] overflow-y-auto scrollbar-thin rounded-md border">
            {historyQuery.isLoading ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (historyQuery.data?.items ?? []).length === 0 ? (
              <div className="p-4">
                <EmptyState title={t('common.empty')} />
              </div>
            ) : (
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[110px]">{t('common.date')}</TableHead>
                    <TableHead className="w-[140px]">{t('common.type')}</TableHead>
                    <TableHead className="w-[90px]">{t('wal.direction.credit')}</TableHead>
                    <TableHead className="text-right">{t('common.amount')}</TableHead>
                    <TableHead>{t('common.comment')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(historyQuery.data?.items ?? []).map((e) => {
                    const signed = e.direction === 'credit' ? e.amount : fromCents(-toCents(e.amount))
                    return (
                      <TableRow key={e.id}>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {date(e.financialDate)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {operationLabel(e.operationType)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-[10px]',
                              e.direction === 'credit'
                                ? 'border-income/30 text-income'
                                : 'border-expense/30 text-expense',
                            )}
                          >
                            {t(`wal.direction.${e.direction}`)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <MoneyText
                            value={signed}
                            tone={e.direction === 'credit' ? 'income' : 'expense'}
                            className="text-sm"
                          />
                        </TableCell>
                        <TableCell className="max-w-[280px] text-sm text-muted-foreground">
                          <span className="line-clamp-1">{e.comment ?? '—'}</span>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </div>

          {/* History pagination */}
          {!historyQuery.isLoading && historyTotal > 0 && (
            <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
              <p className="text-xs text-muted-foreground">
                {t('common.page')} {clampPage(historyPage, historyTotalPages)}{' '}
                {t('common.of')} {historyTotalPages} · {historyTotal}
              </p>
              <Pagination className="mx-0 w-auto">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      href="#"
                      onClick={(e) => {
                        e.preventDefault()
                        setHistoryPage((p) => clampPage(p - 1, historyTotalPages))
                      }}
                      aria-disabled={historyPage <= 1}
                      className={cn(historyPage <= 1 && 'pointer-events-none opacity-50')}
                    />
                  </PaginationItem>
                  {buildPageList(historyPage, historyTotalPages).map((p, i) =>
                    p === 'ellipsis' ? (
                      <PaginationItem key={`e-${i}`}>
                        <PaginationEllipsis />
                      </PaginationItem>
                    ) : (
                      <PaginationItem key={p}>
                        <PaginationLink
                          href="#"
                          isActive={p === historyPage}
                          onClick={(e) => {
                            e.preventDefault()
                            setHistoryPage(p)
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
                        setHistoryPage((p) => clampPage(p + 1, historyTotalPages))
                      }}
                      aria-disabled={historyPage >= historyTotalPages}
                      className={cn(historyPage >= historyTotalPages && 'pointer-events-none opacity-50')}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryOpen(false)}>
              {t('common.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title={t('common.delete')}
        description={deleteTarget?.name ?? ''}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={handleDelete}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Local StatCard (uses money() from i18n; avoids prop type mismatch with shared StatCard)
// ---------------------------------------------------------------------------

function SummaryStatCard({
  label,
  value,
  icon: Icon,
  tone = 'default',
  loading,
}: {
  label: string
  value: string
  icon?: typeof WalletIcon
  tone?: 'default' | 'income' | 'expense' | 'warning' | 'info'
  loading?: boolean
}) {
  const { money } = useI18n()
  const toneText =
    tone === 'income'
      ? 'text-income'
      : tone === 'expense'
        ? 'text-expense'
        : tone === 'warning'
          ? 'text-warning'
          : tone === 'info'
            ? 'text-info'
            : 'text-foreground'
  const toneIconBg =
    tone === 'income'
      ? 'bg-income/15 text-income'
      : tone === 'expense'
        ? 'bg-expense/15 text-expense'
        : tone === 'warning'
          ? 'bg-warning/15 text-warning'
          : tone === 'info'
            ? 'bg-info/15 text-info'
            : 'bg-muted text-foreground'
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </CardTitle>
        {Icon && (
          <div className={cn('rounded-md p-1.5', toneIconBg)}>
            <Icon className="h-4 w-4" />
          </div>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-7 w-28" />
        ) : (
          <div className={cn('text-2xl font-bold tabular-nums', toneText)}>{money(value)}</div>
        )}
      </CardContent>
    </Card>
  )
}
