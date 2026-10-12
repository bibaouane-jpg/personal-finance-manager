'use client'

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Plus,
  MoreHorizontal,
  Eye,
  Pencil,
  Trash2,
  Landmark,
  CalendarClock,
  CalendarDays,
  HandCoins,
  Flag,
  CheckCircle2,
  Clock,
} from 'lucide-react'

import { useI18n } from '@/lib/use-i18n'
import { useApi } from '@/lib/use-api'
import { toLocalDateString } from '@/lib/money'
import { cn } from '@/lib/utils'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState, PageHeader } from '@/components/shared'
import { ConfirmDialog } from '@/components/confirm-dialog'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CreditStatus = 'active' | 'completed' | 'on_hold'
type InstallmentStatus = 'pending' | 'paid'

interface CreditInstallment {
  id: string
  installmentNumber: number
  dueDate: string
  amount: string
  status: InstallmentStatus
}

interface CreditRepayment {
  id: string
  amount: string
  paymentDate: string
  comment: string | null
  walletId: string | null
}

interface BankCredit {
  id: string
  creditName: string
  lender: string
  originalPrincipal: string
  durationMonths: number
  startDate: string
  monthlyInstallment: string
  interestRate: string | null
  fees: string | null
  paymentDay: number
  description: string | null
  status: string
  createdAt: string
  updatedAt: string
  // list endpoint returns repayments: [{ amount }] only; detail returns full rows
  repayments: { amount: string }[] | CreditRepayment[]
  // summary
  totalRepaid: string
  outstanding: string
  paidInstallments: number
  remainingInstallments: number
  progressPct: number
  nextDueDate: string | null
  expectedEndDate: string
}

interface BankCreditDetail extends BankCredit {
  installments: CreditInstallment[]
  repayments: CreditRepayment[]
}

interface BankCreditsListResponse {
  items: BankCredit[]
}

interface Wallet {
  id: string
  name: string
  type: string
  balance: string
}

interface WalletsResponse {
  wallets: Wallet[]
}

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const CREDIT_STATUSES: CreditStatus[] = ['active', 'completed', 'on_hold']

function todayLocal(): string {
  return toLocalDateString(new Date())
}

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/** Map a repayment progress percent to a credit-card color palette.
 *  <50% red, 50-<70% orange, 70-<90% dark green, 90-100% green. */
function creditCardColor(progressPct: number): {
  stripe: string
  text: string
  tint: string
} {
  if (progressPct < 50) {
    return { stripe: '#ef4444', text: '#b91c1c', tint: 'rgba(239,68,68,0.08)' }
  }
  if (progressPct < 70) {
    return { stripe: '#f97316', text: '#c2410c', tint: 'rgba(249,115,22,0.08)' }
  }
  if (progressPct < 90) {
    return { stripe: '#15803d', text: '#15803d', tint: 'rgba(21,128,61,0.10)' }
  }
  return { stripe: '#22c55e', text: '#15803d', tint: 'rgba(34,197,94,0.10)' }
}

/** Classify an installment segment color for the schedule grid. */
function installmentSegment(inst: CreditInstallment): {
  bg: string
  border: string
  text: string
  kind: 'paid' | 'overdue' | 'pending'
} {
  if (inst.status === 'paid') {
    return {
      bg: 'rgba(34,197,94,0.15)',
      border: 'rgba(34,197,94,0.55)',
      text: '#15803d',
      kind: 'paid',
    }
  }
  const due = new Date(inst.dueDate)
  if (!isNaN(due.getTime()) && due < startOfToday()) {
    return {
      bg: 'rgba(239,68,68,0.15)',
      border: 'rgba(239,68,68,0.55)',
      text: '#b91c1c',
      kind: 'overdue',
    }
  }
  return {
    bg: 'rgba(245,158,11,0.15)',
    border: 'rgba(245,158,11,0.45)',
    text: '#a16207',
    kind: 'pending',
  }
}

function statusLabelKey(status: string): string {
  if (status === 'completed') return 'goal.status.completed'
  if (status === 'on_hold') return 'goal.status.on_hold'
  return 'common.active'
}

function statusToneClass(status: string): string {
  if (status === 'completed') return 'border-income/30 text-income'
  if (status === 'on_hold') return 'border-warning/30 text-warning'
  return 'border-info/30 text-info'
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BankCreditsView() {
  const { t, money, date } = useI18n()
  const api = useApi()
  const qc = useQueryClient()

  // ---- Credits list ----
  const creditsQuery = useQuery<BankCreditsListResponse>({
    queryKey: ['bank-credits'],
    queryFn: () => api.get<BankCreditsListResponse>('/api/bank-credits'),
  })

  const credits = creditsQuery.data?.items ?? []
  const loading = creditsQuery.isLoading

  // ---- Create / Edit dialog state ----
  const [creditDialogOpen, setCreditDialogOpen] = useState(false)
  const [editing, setEditing] = useState<BankCredit | null>(null)
  const [submittingCredit, setSubmittingCredit] = useState(false)

  const [formCreditName, setFormCreditName] = useState('')
  const [formLender, setFormLender] = useState('')
  const [formOriginalPrincipal, setFormOriginalPrincipal] = useState('')
  const [formDurationMonths, setFormDurationMonths] = useState('12')
  const [formStartDate, setFormStartDate] = useState(todayLocal())
  const [formMonthlyInstallment, setFormMonthlyInstallment] = useState('')
  const [formInterestRate, setFormInterestRate] = useState('')
  const [formFees, setFormFees] = useState('')
  const [formPaymentDay, setFormPaymentDay] = useState('1')
  const [formDescription, setFormDescription] = useState('')
  const [formStatus, setFormStatus] = useState<CreditStatus>('active')

  // ---- Schedule dialog state ----
  const [scheduleCredit, setScheduleCredit] = useState<BankCredit | null>(null)
  const [scheduleOpen, setScheduleOpen] = useState(false)

  const scheduleQuery = useQuery<BankCreditDetail>({
    queryKey: ['bank-credit', scheduleCredit?.id],
    queryFn: () => api.get<BankCreditDetail>(`/api/bank-credits/${scheduleCredit!.id}`),
    enabled: !!scheduleCredit && scheduleOpen,
  })

  // ---- Add repayment dialog state ----
  const [repayCredit, setRepayCredit] = useState<BankCredit | null>(null)
  const [repayOpen, setRepayOpen] = useState(false)
  const [repayAmount, setRepayAmount] = useState('')
  const [repayDate, setRepayDate] = useState(todayLocal())
  const [repayComment, setRepayComment] = useState('')
  const [repayWalletId, setRepayWalletId] = useState<string>('__none__')
  const [submittingRepay, setSubmittingRepay] = useState(false)

  const walletsQuery = useQuery<WalletsResponse>({
    queryKey: ['wallets'],
    queryFn: () => api.get<WalletsResponse>('/api/wallets'),
    enabled: repayOpen,
  })

  // ---- Delete state ----
  const [deleteTarget, setDeleteTarget] = useState<BankCredit | null>(null)

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post('/api/bank-credits', body),
    onSuccess: () => {
      toast.success(t('credit.created'))
      qc.invalidateQueries({ queryKey: ['bank-credits'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['analytics'] })
      setCreditDialogOpen(false)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.put(`/api/bank-credits/${id}`, body),
    onSuccess: () => {
      toast.success(t('credit.updated'))
      qc.invalidateQueries({ queryKey: ['bank-credits'] })
      qc.invalidateQueries({ queryKey: ['bank-credit', editing?.id] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['analytics'] })
      setCreditDialogOpen(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del(`/api/bank-credits/${id}`),
    onSuccess: () => {
      toast.success(t('common.delete'))
      qc.invalidateQueries({ queryKey: ['bank-credits'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['analytics'] })
      setDeleteTarget(null)
    },
  })

  const repaymentMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.post(`/api/bank-credits/${id}/repayments`, body),
    onSuccess: () => {
      toast.success(t('credit.repaymentAdded'))
      qc.invalidateQueries({ queryKey: ['bank-credits'] })
      qc.invalidateQueries({ queryKey: ['bank-credit', repayCredit?.id] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['analytics'] })
      setRepayOpen(false)
    },
  })

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const openCreate = () => {
    setEditing(null)
    setFormCreditName('')
    setFormLender('')
    setFormOriginalPrincipal('')
    setFormDurationMonths('12')
    setFormStartDate(todayLocal())
    setFormMonthlyInstallment('')
    setFormInterestRate('')
    setFormFees('')
    setFormPaymentDay('1')
    setFormDescription('')
    setFormStatus('active')
    setCreditDialogOpen(true)
  }

  const openEdit = (c: BankCredit) => {
    setEditing(c)
    setFormCreditName(c.creditName)
    setFormLender(c.lender)
    setFormOriginalPrincipal(c.originalPrincipal)
    setFormDurationMonths(String(c.durationMonths))
    setFormStartDate(toLocalDateString(c.startDate))
    setFormMonthlyInstallment(c.monthlyInstallment)
    setFormInterestRate(c.interestRate ?? '')
    setFormFees(c.fees ?? '')
    setFormPaymentDay(String(c.paymentDay))
    setFormDescription(c.description ?? '')
    setFormStatus((c.status as CreditStatus) || 'active')
    setCreditDialogOpen(true)
  }

  const handleCreditSubmit = async () => {
    if (!formCreditName.trim()) {
      toast.error(`${t('common.required')}: ${t('credit.creditName')}`)
      return
    }
    if (!formLender.trim()) {
      toast.error(`${t('common.required')}: ${t('credit.lender')}`)
      return
    }
    const principal = Number(formOriginalPrincipal)
    if (!Number.isFinite(principal) || principal <= 0) {
      toast.error(`${t('common.required')}: ${t('credit.originalPrincipal')}`)
      return
    }
    const duration = Number(formDurationMonths)
    if (!Number.isFinite(duration) || duration < 1 || !Number.isInteger(duration)) {
      toast.error(`${t('common.required')}: ${t('credit.durationMonths')}`)
      return
    }
    if (!formStartDate) {
      toast.error(`${t('common.required')}: ${t('credit.startDate')}`)
      return
    }
    const installment = Number(formMonthlyInstallment)
    if (!Number.isFinite(installment) || installment <= 0) {
      toast.error(`${t('common.required')}: ${t('credit.monthlyInstallment')}`)
      return
    }
    const payDay = Number(formPaymentDay)
    if (!Number.isFinite(payDay) || payDay < 1 || payDay > 31 || !Number.isInteger(payDay)) {
      toast.error(`${t('common.required')}: ${t('credit.paymentDay')}`)
      return
    }

    const body: Record<string, unknown> = {
      creditName: formCreditName.trim(),
      lender: formLender.trim(),
      originalPrincipal: principal.toFixed(2),
      durationMonths: duration,
      startDate: formStartDate,
      monthlyInstallment: installment.toFixed(2),
      paymentDay: payDay,
      status: formStatus,
    }
    if (formInterestRate.trim() !== '') {
      const ir = Number(formInterestRate)
      if (!Number.isFinite(ir)) {
        toast.error(`${t('common.required')}: ${t('credit.interestRate')}`)
        return
      }
      body.interestRate = ir.toFixed(2)
    } else {
      body.interestRate = null
    }
    if (formFees.trim() !== '') {
      const fees = Number(formFees)
      if (!Number.isFinite(fees)) {
        toast.error(`${t('common.required')}: ${t('credit.fees')}`)
        return
      }
      body.fees = fees.toFixed(2)
    } else {
      body.fees = null
    }
    if (formDescription.trim()) body.description = formDescription.trim()

    setSubmittingCredit(true)
    try {
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, body })
      } else {
        await createMutation.mutateAsync(body)
      }
    } catch {
      // useApi already toasted the error.
    } finally {
      setSubmittingCredit(false)
    }
  }

  const openSchedule = (c: BankCredit) => {
    setScheduleCredit(c)
    setScheduleOpen(true)
  }

  const openRepay = (c: BankCredit) => {
    setRepayCredit(c)
    setRepayAmount('')
    setRepayDate(todayLocal())
    setRepayComment('')
    setRepayWalletId('__none__')
    setRepayOpen(true)
  }

  const handleRepaySubmit = async () => {
    if (!repayCredit) return
    const amt = Number(repayAmount)
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error(`${t('common.required')}: ${t('common.amount')}`)
      return
    }
    if (!repayDate) {
      toast.error(`${t('common.required')}: ${t('common.date')}`)
      return
    }
    const body: Record<string, unknown> = {
      amount: amt.toFixed(2),
      paymentDate: repayDate,
    }
    if (repayComment.trim()) body.comment = repayComment.trim()
    if (repayWalletId !== '__none__') body.walletId = repayWalletId
    else body.walletId = null

    setSubmittingRepay(true)
    try {
      await repaymentMutation.mutateAsync({ id: repayCredit.id, body })
    } catch {
      // useApi already toasted the error.
    } finally {
      setSubmittingRepay(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
    } catch {
      // useApi already toasted the error. ConfirmDialog will remain open
      // because onConfirm throws before onOpenChange(false) is invoked.
    }
  }

  // ---------------------------------------------------------------------------
  // Derived helpers
  // ---------------------------------------------------------------------------

  const statusLabel = (s: string) => t(statusLabelKey(s))

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('credit.title')}
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            {t('credit.add')}
          </Button>
        }
      />

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="mt-2 h-4 w-24" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-9 w-48" />
                <Skeleton className="h-2 w-full" />
                <div className="grid grid-cols-2 gap-3">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : credits.length === 0 ? (
        <EmptyState
          title={t('credit.empty')}
          action={
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              {t('credit.add')}
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {credits.map((c) => {
            const colors = creditCardColor(c.progressPct ?? 0)
            return (
              <Card
                key={c.id}
                className="relative overflow-hidden transition-shadow hover:shadow-md"
                style={{
                  borderTop: `4px solid ${colors.stripe}`,
                  backgroundImage: `linear-gradient(135deg, ${colors.tint}, transparent 60%)`,
                }}
              >
                <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                  <div className="space-y-1.5 pr-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md"
                        style={{
                          backgroundColor: `${colors.stripe}22`,
                          color: colors.stripe,
                        }}
                        aria-hidden
                      >
                        <Landmark className="h-4 w-4" />
                      </span>
                      <CardTitle className="text-base leading-tight">
                        {c.creditName}
                      </CardTitle>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px]">
                        {c.lender}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={cn('text-[10px]', statusToneClass(c.status))}
                      >
                        {statusLabel(c.status)}
                      </Badge>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">{t('common.actions')}</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem onClick={() => openSchedule(c)}>
                        <Eye className="h-4 w-4" />
                        {t('credit.schedule')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openRepay(c)}>
                        <HandCoins className="h-4 w-4" />
                        {t('credit.addRepayment')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => openEdit(c)}>
                        <Pencil className="h-4 w-4" />
                        {t('common.edit')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setDeleteTarget(c)}
                      >
                        <Trash2 className="h-4 w-4" />
                        {t('common.delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* Outstanding hero */}
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t('credit.outstanding')}
                    </p>
                    <p
                      className="text-3xl font-bold tabular-nums"
                      style={{ color: colors.text }}
                    >
                      {money(c.outstanding)}
                    </p>
                  </div>

                  {/* Quick row: principal / installment / duration / progress */}
                  <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <div>
                      <p className="text-muted-foreground">
                        {t('credit.originalPrincipal')}
                      </p>
                      <p className="font-medium tabular-nums">
                        {money(c.originalPrincipal, undefined, false)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">
                        {t('credit.monthlyInstallment')}
                      </p>
                      <p className="font-medium tabular-nums">
                        {money(c.monthlyInstallment, undefined, false)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">
                        {t('credit.durationMonths')}
                      </p>
                      <p className="font-medium tabular-nums">
                        {c.durationMonths}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">
                        {t('common.progress')}
                      </p>
                      <p className="font-medium tabular-nums">
                        {c.progressPct ?? 0}%
                      </p>
                    </div>
                  </div>

                  {/* Progress bar (custom so we can tint with the card color) */}
                  <div className="space-y-1">
                    <div
                      className="relative h-2 w-full overflow-hidden rounded-full bg-muted"
                      role="progressbar"
                      aria-valuenow={c.progressPct ?? 0}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.max(0, Math.min(100, c.progressPct ?? 0))}%`,
                          backgroundColor: colors.stripe,
                        }}
                      />
                    </div>
                  </div>

                  {/* Stat tiles */}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <MiniStat
                      icon={CheckCircle2}
                      label={t('credit.totalRepaid')}
                      value={money(c.totalRepaid, undefined, false)}
                      tone="income"
                    />
                    <MiniStat
                      icon={Clock}
                      label={t('credit.paidInstallments')}
                      value={`${c.paidInstallments ?? 0} / ${c.paidInstallments + c.remainingInstallments}`}
                      tone="info"
                    />
                    <MiniStat
                      icon={CalendarClock}
                      label={t('credit.nextDueDate')}
                      value={c.nextDueDate ? date(c.nextDueDate) : '—'}
                      tone="default"
                    />
                    <MiniStat
                      icon={CalendarDays}
                      label={t('credit.expectedEndDate')}
                      value={c.expectedEndDate ? date(c.expectedEndDate) : '—'}
                      tone="default"
                    />
                  </div>

                  {c.description && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {c.description}
                    </p>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Create / Edit credit dialog                                       */}
      {/* ----------------------------------------------------------------- */}
      <Dialog open={creditDialogOpen} onOpenChange={setCreditDialogOpen}>
        <DialogContent className="sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle>
              {editing ? t('credit.edit') : t('credit.add')}
            </DialogTitle>
            <DialogDescription>{t('credit.title')}</DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[70vh] pr-3">
            <div className="grid grid-cols-1 gap-4 p-1">
              <div className="space-y-1.5">
                <Label htmlFor="bc-name">
                  {t('credit.creditName')} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="bc-name"
                  value={formCreditName}
                  onChange={(e) => setFormCreditName(e.target.value)}
                  placeholder={t('credit.creditName')}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="bc-lender">
                    {t('credit.lender')} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="bc-lender"
                    value={formLender}
                    onChange={(e) => setFormLender(e.target.value)}
                    placeholder={t('credit.lender')}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bc-payment-day">
                    {t('credit.paymentDay')} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="bc-payment-day"
                    type="number"
                    min={1}
                    max={31}
                    step={1}
                    inputMode="numeric"
                    value={formPaymentDay}
                    onChange={(e) => setFormPaymentDay(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="bc-principal">
                    {t('credit.originalPrincipal')}{' '}
                    <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="bc-principal"
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    value={formOriginalPrincipal}
                    onChange={(e) => setFormOriginalPrincipal(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bc-installment">
                    {t('credit.monthlyInstallment')}{' '}
                    <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="bc-installment"
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    value={formMonthlyInstallment}
                    onChange={(e) => setFormMonthlyInstallment(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="bc-duration">
                    {t('credit.durationMonths')}{' '}
                    <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="bc-duration"
                    type="number"
                    min={1}
                    max={600}
                    step={1}
                    inputMode="numeric"
                    value={formDurationMonths}
                    onChange={(e) => setFormDurationMonths(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bc-start">
                    {t('credit.startDate')} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="bc-start"
                    type="date"
                    value={formStartDate}
                    onChange={(e) => setFormStartDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="bc-rate">{t('credit.interestRate')}</Label>
                  <Input
                    id="bc-rate"
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    value={formInterestRate}
                    onChange={(e) => setFormInterestRate(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bc-fees">{t('credit.fees')}</Label>
                  <Input
                    id="bc-fees"
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    value={formFees}
                    onChange={(e) => setFormFees(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="bc-status">{t('common.status')}</Label>
                  <Select
                    value={formStatus}
                    onValueChange={(v) => setFormStatus(v as CreditStatus)}
                  >
                    <SelectTrigger id="bc-status" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CREDIT_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {t(statusLabelKey(s))}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="bc-description">{t('common.description')}</Label>
                <Textarea
                  id="bc-description"
                  rows={3}
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder={t('common.description')}
                />
              </div>
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreditDialogOpen(false)}
              disabled={submittingCredit}
            >
              {t('common.cancel')}
            </Button>
            <Button onClick={handleCreditSubmit} disabled={submittingCredit}>
              {submittingCredit ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ----------------------------------------------------------------- */}
      {/* Schedule dialog                                                   */}
      {/* ----------------------------------------------------------------- */}
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="sm:max-w-[760px]">
          <DialogHeader>
            <DialogTitle>
              {t('credit.schedule')}
              {scheduleCredit ? ` — ${scheduleCredit.creditName}` : ''}
            </DialogTitle>
            <DialogDescription>
              {scheduleCredit?.lender} · {scheduleCredit?.durationMonths}{' '}
              {t('credit.durationMonths')}
            </DialogDescription>
          </DialogHeader>

          {/* Schedule grid (with legend, grouped by year when many installments) */}
          <ScheduleGrid query={scheduleQuery} />

          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleOpen(false)}>
              {t('common.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ----------------------------------------------------------------- */}
      {/* Add repayment dialog                                              */}
      {/* ----------------------------------------------------------------- */}
      <Dialog open={repayOpen} onOpenChange={setRepayOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>
              {t('credit.addRepayment')}
              {repayCredit ? ` — ${repayCredit.creditName}` : ''}
            </DialogTitle>
            <DialogDescription>
              {t('credit.outstanding')}: {repayCredit ? money(repayCredit.outstanding) : ''}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rp-amount">
                  {t('common.amount')} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="rp-amount"
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={repayAmount}
                  onChange={(e) => setRepayAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rp-date">
                  {t('common.date')} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="rp-date"
                  type="date"
                  value={repayDate}
                  onChange={(e) => setRepayDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rp-wallet">{t('common.wallet')}</Label>
              <Select value={repayWalletId} onValueChange={setRepayWalletId}>
                <SelectTrigger id="rp-wallet" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t('common.none')}</SelectItem>
                  {walletsQuery.data?.wallets.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rp-comment">{t('common.comment')}</Label>
              <Textarea
                id="rp-comment"
                rows={3}
                value={repayComment}
                onChange={(e) => setRepayComment(e.target.value)}
                placeholder={t('common.comment')}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRepayOpen(false)}
              disabled={submittingRepay}
            >
              {t('common.cancel')}
            </Button>
            <Button onClick={handleRepaySubmit} disabled={submittingRepay}>
              {submittingRepay ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title={t('common.delete')}
        description={deleteTarget?.creditName ?? ''}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={handleDelete}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Local sub-components
// ---------------------------------------------------------------------------

function MiniStat({
  icon: Icon,
  label,
  value,
  tone = 'default',
}: {
  icon: typeof Landmark
  label: string
  value: string
  tone?: 'default' | 'income' | 'expense' | 'warning' | 'info'
}) {
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
  return (
    <div className="rounded-md border bg-card/60 p-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" />
        <span className="truncate">{label}</span>
      </div>
      <p className={cn('mt-1 text-sm font-semibold tabular-nums truncate', toneText)}>
        {value}
      </p>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-block h-3 w-3 rounded-sm"
        style={{ backgroundColor: color }}
      />
      <span className="text-muted-foreground">{label}</span>
    </div>
  )
}

function ScheduleGrid({
  query,
}: {
  query: ReturnType<typeof useQuery<BankCreditDetail>>
}) {
  const { t, date, money } = useI18n()

  const installments = query.data?.installments ?? []
  const isLoading = query.isLoading

  const paidLabel = useMemo(
    () => t('credit.paidInstallments').split(' ')[0] || 'Paid',
    [t],
  )
  const remainingLabel = t('credit.remainingInstallments')
  const overdueLabel = t('common.remaining')

  // Group installments by year (ascending).
  const grouped = useMemo(() => {
    const map = new Map<number, CreditInstallment[]>()
    for (const inst of installments) {
      const d = new Date(inst.dueDate)
      const y = isNaN(d.getTime()) ? 0 : d.getFullYear()
      if (!map.has(y)) map.set(y, [])
      map.get(y)!.push(inst)
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0])
  }, [installments])

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    )
  }

  if (installments.length === 0) {
    return <EmptyState title={t('common.empty')} />
  }

  return (
    <ScrollArea className="max-h-[55vh] pr-3">
      <div className="space-y-5 p-1">
        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <LegendDot color="rgba(34,197,94,0.55)" label={paidLabel} />
          <LegendDot color="rgba(239,68,68,0.55)" label={overdueLabel} />
          <LegendDot color="rgba(245,158,11,0.45)" label={remainingLabel} />
        </div>

        {grouped.map(([year, items]) => (
          <div key={year} className="space-y-2">
            {grouped.length > 1 && (
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Flag className="h-3 w-3" />
                <span>
                  {t('common.year')} {year}
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {items.map((inst) => {
                const seg = installmentSegment(inst)
                const label =
                  inst.status === 'paid'
                    ? paidLabel
                    : seg.kind === 'overdue'
                      ? overdueLabel
                      : remainingLabel
                return (
                  <div
                    key={inst.id}
                    className="rounded-md border p-2.5 text-xs"
                    style={{
                      backgroundColor: seg.bg,
                      borderColor: seg.border,
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className="font-semibold"
                        style={{ color: seg.text }}
                      >
                        #{inst.installmentNumber}
                      </span>
                      <Badge
                        variant="outline"
                        className="text-[9px]"
                        style={{
                          borderColor: seg.border,
                          color: seg.text,
                        }}
                      >
                        {label}
                      </Badge>
                    </div>
                    <p className="mt-1.5 text-muted-foreground">
                      {date(inst.dueDate)}
                    </p>
                    <p className="mt-0.5 font-medium tabular-nums">
                      {money(inst.amount, undefined, false)}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}
