'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  HandCoins,
  CalendarDays,
  History,
  ArrowDownCircle,
  ArrowUpCircle,
  PlusCircle,
  RefreshCw,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState, PageHeader } from '@/components/shared'
import { ConfirmDialog } from '@/components/confirm-dialog'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LoanStatus = 'active' | 'settled' | 'cancelled'
type OperationType = 'disbursement' | 'repayment' | 'additional' | 'correction'

interface LoanOperation {
  id: string
  operationType: OperationType
  amount: string
  operationDate: string
  comment: string | null
  walletId: string | null
}

interface PersonalLoan {
  id: string
  borrowerName: string
  description: string | null
  originalAmount: string
  loanDate: string
  expectedRepayDate: string | null
  comment: string | null
  status: string
  createdAt: string
  updatedAt: string
  operations: LoanOperation[]
  // computed summary
  totalLent: string
  totalRepaid: string
  outstanding: string
  progressPct: number
}

interface LoansListResponse {
  items: PersonalLoan[]
}

interface OperationsResponse {
  items: LoanOperation[]
}

interface Wallet {
  id: string
  name: string
  type: string
}

interface WalletsResponse {
  wallets: Wallet[]
}

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const LOAN_STATUSES: LoanStatus[] = ['active', 'settled', 'cancelled']
const OPERATION_TYPES: OperationType[] = [
  'disbursement',
  'repayment',
  'additional',
  'correction',
]

const OP_ICON: Record<OperationType, typeof HandCoins> = {
  disbursement: ArrowDownCircle,
  repayment: ArrowUpCircle,
  additional: PlusCircle,
  correction: RefreshCw,
}

function todayLocal(): string {
  return toLocalDateString(new Date())
}

/** Map a repayment progress percent to a loan-card color palette.
 *  <50% red, 50-<70% orange, 70-<90% dark green, 90-100% green. */
function loanCardColor(progressPct: number): {
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

function statusLabelKey(status: string): string {
  if (status === 'settled') return 'goal.status.completed'
  if (status === 'cancelled') return 'goal.status.cancelled'
  return 'common.active'
}

function statusToneClass(status: string): string {
  if (status === 'settled') return 'border-income/30 text-income'
  if (status === 'cancelled') return 'border-expense/30 text-expense'
  return 'border-info/30 text-info'
}

function opTypeLabelKey(t: OperationType): string {
  return `loan.op.${t}`
}

function opTypeToneClass(t: OperationType): string {
  if (t === 'disbursement') return 'border-info/30 text-info'
  if (t === 'repayment') return 'border-income/30 text-income'
  if (t === 'additional') return 'border-warning/30 text-warning'
  return 'border-expense/30 text-expense'
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PersonalLoansView() {
  const { t, money, date } = useI18n()
  const api = useApi()
  const qc = useQueryClient()

  // ---- Loans list ----
  const loansQuery = useQuery<LoansListResponse>({
    queryKey: ['personal-loans'],
    queryFn: () => api.get<LoansListResponse>('/api/personal-loans'),
  })

  const loans = loansQuery.data?.items ?? []
  const loading = loansQuery.isLoading

  // ---- Create / Edit dialog state ----
  const [loanDialogOpen, setLoanDialogOpen] = useState(false)
  const [editing, setEditing] = useState<PersonalLoan | null>(null)
  const [submittingLoan, setSubmittingLoan] = useState(false)

  const [formBorrower, setFormBorrower] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formOriginalAmount, setFormOriginalAmount] = useState('')
  const [formLoanDate, setFormLoanDate] = useState(todayLocal())
  const [formExpectedRepayDate, setFormExpectedRepayDate] = useState('')
  const [formComment, setFormComment] = useState('')
  const [formStatus, setFormStatus] = useState<LoanStatus>('active')

  // ---- Operations dialog state ----
  const [opsLoan, setOpsLoan] = useState<PersonalLoan | null>(null)
  const [opsOpen, setOpsOpen] = useState(false)

  const opsQuery = useQuery<OperationsResponse>({
    queryKey: ['personal-loan-operations', opsLoan?.id],
    queryFn: () =>
      api.get<OperationsResponse>(
        `/api/personal-loans/${opsLoan!.id}/operations`
      ),
    enabled: !!opsLoan && opsOpen,
  })

  // ---- Add operation dialog state ----
  const [addOpOpen, setAddOpOpen] = useState(false)
  const [opType, setOpType] = useState<OperationType>('repayment')
  const [opAmount, setOpAmount] = useState('')
  const [opDate, setOpDate] = useState(todayLocal())
  const [opComment, setOpComment] = useState('')
  const [opWalletId, setOpWalletId] = useState<string>('__none__')
  const [submittingOp, setSubmittingOp] = useState(false)

  const walletsQuery = useQuery<WalletsResponse>({
    queryKey: ['wallets'],
    queryFn: () => api.get<WalletsResponse>('/api/wallets'),
    enabled: addOpOpen,
  })

  // ---- Delete state ----
  const [deleteTarget, setDeleteTarget] = useState<PersonalLoan | null>(null)

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post('/api/personal-loans', body),
    onSuccess: () => {
      toast.success(t('loan.created'))
      qc.invalidateQueries({ queryKey: ['personal-loans'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['analytics'] })
      setLoanDialogOpen(false)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.put(`/api/personal-loans/${id}`, body),
    onSuccess: () => {
      toast.success(t('common.save'))
      qc.invalidateQueries({ queryKey: ['personal-loans'] })
      qc.invalidateQueries({ queryKey: ['personal-loan-operations', editing?.id] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['analytics'] })
      setLoanDialogOpen(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del(`/api/personal-loans/${id}`),
    onSuccess: () => {
      toast.success(t('common.delete'))
      qc.invalidateQueries({ queryKey: ['personal-loans'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['analytics'] })
      setDeleteTarget(null)
    },
  })

  const operationMutation = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string
      body: Record<string, unknown>
    }) => api.post(`/api/personal-loans/${id}/operations`, body),
    onSuccess: () => {
      toast.success(t('loan.operationAdded'))
      qc.invalidateQueries({ queryKey: ['personal-loans'] })
      if (opsLoan) {
        qc.invalidateQueries({
          queryKey: ['personal-loan-operations', opsLoan.id],
        })
      }
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['analytics'] })
      setAddOpOpen(false)
    },
  })

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const openCreate = () => {
    setEditing(null)
    setFormBorrower('')
    setFormDescription('')
    setFormOriginalAmount('')
    setFormLoanDate(todayLocal())
    setFormExpectedRepayDate('')
    setFormComment('')
    setFormStatus('active')
    setLoanDialogOpen(true)
  }

  const openEdit = (l: PersonalLoan) => {
    setEditing(l)
    setFormBorrower(l.borrowerName)
    setFormDescription(l.description ?? '')
    setFormOriginalAmount(l.originalAmount)
    setFormLoanDate(toLocalDateString(l.loanDate))
    setFormExpectedRepayDate(
      l.expectedRepayDate ? toLocalDateString(l.expectedRepayDate) : ''
    )
    setFormComment(l.comment ?? '')
    setFormStatus((l.status as LoanStatus) || 'active')
    setLoanDialogOpen(true)
  }

  const handleLoanSubmit = async () => {
    if (!formBorrower.trim()) {
      toast.error(`${t('common.required')}: ${t('loan.borrower')}`)
      return
    }
    const amount = Number(formOriginalAmount)
    if (!editing) {
      if (!Number.isFinite(amount) || amount <= 0) {
        toast.error(`${t('common.required')}: ${t('loan.originalAmount')}`)
        return
      }
    }
    if (!formLoanDate) {
      toast.error(`${t('common.required')}: ${t('loan.loanDate')}`)
      return
    }

    const body: Record<string, unknown> = {
      borrowerName: formBorrower.trim(),
      status: formStatus,
    }
    if (formDescription.trim()) body.description = formDescription.trim()
    else body.description = null
    if (formComment.trim()) body.comment = formComment.trim()
    else body.comment = null
    if (formExpectedRepayDate) {
      body.expectedRepayDate = formExpectedRepayDate
    } else {
      body.expectedRepayDate = null
    }

    if (editing) {
      // PUT endpoint does not accept originalAmount or loanDate.
      setSubmittingLoan(true)
      try {
        await updateMutation.mutateAsync({ id: editing.id, body })
      } catch {
        // useApi already toasted the error.
      } finally {
        setSubmittingLoan(false)
      }
      return
    }

    body.originalAmount = amount.toFixed(2)
    body.loanDate = formLoanDate

    setSubmittingLoan(true)
    try {
      await createMutation.mutateAsync(body)
    } catch {
      // useApi already toasted the error.
    } finally {
      setSubmittingLoan(false)
    }
  }

  const openOperations = (l: PersonalLoan) => {
    setOpsLoan(l)
    setOpsOpen(true)
  }

  const openAddOp = (l: PersonalLoan | null) => {
    if (l) setOpsLoan(l)
    setOpType('repayment')
    setOpAmount('')
    setOpDate(todayLocal())
    setOpComment('')
    setOpWalletId('__none__')
    setAddOpOpen(true)
  }

  const handleOpSubmit = async () => {
    if (!opsLoan) return
    const amt = Number(opAmount)
    if (!Number.isFinite(amt)) {
      toast.error(`${t('common.required')}: ${t('common.amount')}`)
      return
    }
    if (opType !== 'correction' && amt <= 0) {
      toast.error(`${t('common.required')}: ${t('common.amount')}`)
      return
    }
    if (!opDate) {
      toast.error(`${t('common.required')}: ${t('common.date')}`)
      return
    }
    if (opType === 'correction' && !opComment.trim()) {
      toast.error(`${t('common.required')}: ${t('common.comment')}`)
      return
    }

    const body: Record<string, unknown> = {
      operationType: opType,
      amount: amt.toFixed(2),
      operationDate: opDate,
    }
    if (opComment.trim()) body.comment = opComment.trim()
    if (opWalletId !== '__none__') body.walletId = opWalletId
    else body.walletId = null

    setSubmittingOp(true)
    try {
      await operationMutation.mutateAsync({ id: opsLoan.id, body })
    } catch {
      // useApi already surfaced the message (e.g. "Repayment exceeds the
      // outstanding amount." on 400). Dialog stays open so user can retry.
    } finally {
      setSubmittingOp(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
    } catch {
      // useApi already toasted the error (e.g. 409 conflict when the loan
      // has operations beyond the initial disbursement).
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
        title={t('loan.title')}
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            {t('loan.add')}
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
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {Array.from({ length: 4 }).map((__, j) => (
                    <Skeleton key={j} className="h-14 w-full" />
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : loans.length === 0 ? (
        <EmptyState
          title={t('loan.empty')}
          action={
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              {t('loan.add')}
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {loans.map((l) => {
            const colors = loanCardColor(l.progressPct ?? 0)
            const ops = [...(l.operations ?? [])]
            ops.sort(
              (a, b) =>
                new Date(b.operationDate).getTime() -
                new Date(a.operationDate).getTime()
            )
            const recentOps = ops.slice(0, 3)
            return (
              <LoanCard
                key={l.id}
                loan={l}
                colors={colors}
                recentOps={recentOps}
                money={money}
                date={date}
                statusLabel={statusLabel}
                onViewOps={() => openOperations(l)}
                onAddOp={() => openAddOp(l)}
                onEdit={() => openEdit(l)}
                onDelete={() => setDeleteTarget(l)}
              />
            )
          })}
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Create / Edit loan dialog                                         */}
      {/* ----------------------------------------------------------------- */}
      <Dialog open={loanDialogOpen} onOpenChange={setLoanDialogOpen}>
        <DialogContent className="sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle>
              {editing ? t('loan.edit') : t('loan.add')}
            </DialogTitle>
            <DialogDescription>{t('loan.title')}</DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[70vh] pr-3">
            <div className="grid grid-cols-1 gap-4 p-1">
              <div className="space-y-1.5">
                <Label htmlFor="pl-borrower">
                  {t('loan.borrower')} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="pl-borrower"
                  value={formBorrower}
                  onChange={(e) => setFormBorrower(e.target.value)}
                  placeholder={t('loan.borrower')}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pl-amount">
                    {t('loan.originalAmount')}{' '}
                    {!editing && <span className="text-destructive">*</span>}
                  </Label>
                  <Input
                    id="pl-amount"
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    value={formOriginalAmount}
                    onChange={(e) => setFormOriginalAmount(e.target.value)}
                    placeholder="0.00"
                    disabled={!!editing}
                  />
                  {editing && (
                    <p className="text-[11px] text-muted-foreground">
                      {t('common.optional')}: {t('loan.originalAmount')}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pl-loan-date">
                    {t('loan.loanDate')}{' '}
                    {!editing && <span className="text-destructive">*</span>}
                  </Label>
                  <Input
                    id="pl-loan-date"
                    type="date"
                    value={formLoanDate}
                    onChange={(e) => setFormLoanDate(e.target.value)}
                    disabled={!!editing}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pl-expected">{t('loan.expectedRepayDate')}</Label>
                  <Input
                    id="pl-expected"
                    type="date"
                    value={formExpectedRepayDate}
                    onChange={(e) => setFormExpectedRepayDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pl-status">{t('common.status')}</Label>
                  <Select
                    value={formStatus}
                    onValueChange={(v) => setFormStatus(v as LoanStatus)}
                  >
                    <SelectTrigger id="pl-status" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LOAN_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {t(statusLabelKey(s))}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pl-description">{t('common.description')}</Label>
                <Textarea
                  id="pl-description"
                  rows={2}
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder={t('common.description')}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pl-comment">{t('common.comment')}</Label>
                <Textarea
                  id="pl-comment"
                  rows={2}
                  value={formComment}
                  onChange={(e) => setFormComment(e.target.value)}
                  placeholder={t('common.comment')}
                />
              </div>
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setLoanDialogOpen(false)}
              disabled={submittingLoan}
            >
              {t('common.cancel')}
            </Button>
            <Button onClick={handleLoanSubmit} disabled={submittingLoan}>
              {submittingLoan ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ----------------------------------------------------------------- */}
      {/* Operations history dialog                                         */}
      {/* ----------------------------------------------------------------- */}
      <Dialog open={opsOpen} onOpenChange={setOpsOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {t('loan.operations')}
              {opsLoan ? ` — ${opsLoan.borrowerName}` : ''}
            </DialogTitle>
            <DialogDescription>
              {opsLoan
                ? `${t('loan.outstanding')}: ${money(opsLoan.outstanding)} · ${t(
                    'common.progress'
                  )}: ${opsLoan.progressPct ?? 0}%`
                : ''}
            </DialogDescription>
          </DialogHeader>

          <OperationsTable
            query={opsQuery}
            money={money}
            date={date}
            t={t}
          />

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              onClick={() => opsLoan && openAddOp(opsLoan)}
              disabled={opsQuery.isLoading}
            >
              <Plus className="h-4 w-4" />
              {t('loan.addOperation')}
            </Button>
            <Button variant="outline" onClick={() => setOpsOpen(false)}>
              {t('common.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ----------------------------------------------------------------- */}
      {/* Add operation dialog                                              */}
      {/* ----------------------------------------------------------------- */}
      <Dialog open={addOpOpen} onOpenChange={setAddOpOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>
              {t('loan.addOperation')}
              {opsLoan ? ` — ${opsLoan.borrowerName}` : ''}
            </DialogTitle>
            <DialogDescription>
              {opsLoan
                ? `${t('loan.outstanding')}: ${money(opsLoan.outstanding)}`
                : ''}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="op-type">
                  {t('common.type')} <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={opType}
                  onValueChange={(v) => setOpType(v as OperationType)}
                >
                  <SelectTrigger id="op-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OPERATION_TYPES.map((ty) => {
                      const Icon = OP_ICON[ty]
                      return (
                        <SelectItem key={ty} value={ty}>
                          <span className="flex items-center gap-2">
                            <Icon className="h-3.5 w-3.5" />
                            {t(opTypeLabelKey(ty))}
                          </span>
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="op-amount">
                  {t('common.amount')} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="op-amount"
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={opAmount}
                  onChange={(e) => setOpAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="op-date">
                  {t('common.date')} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="op-date"
                  type="date"
                  value={opDate}
                  onChange={(e) => setOpDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="op-wallet">{t('common.wallet')}</Label>
                <Select value={opWalletId} onValueChange={setOpWalletId}>
                  <SelectTrigger id="op-wallet" className="w-full">
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
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="op-comment">
                {t('common.comment')}
                {opType === 'correction' && (
                  <span className="text-destructive"> *</span>
                )}
              </Label>
              <Textarea
                id="op-comment"
                rows={3}
                value={opComment}
                onChange={(e) => setOpComment(e.target.value)}
                placeholder={t('common.comment')}
              />
              {opType === 'correction' && (
                <p className="text-[11px] text-muted-foreground">
                  {t('common.required')}: {t('common.comment')}
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddOpOpen(false)}
              disabled={submittingOp}
            >
              {t('common.cancel')}
            </Button>
            <Button onClick={handleOpSubmit} disabled={submittingOp}>
              {submittingOp ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title={t('common.delete')}
        description={deleteTarget?.borrowerName ?? ''}
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

function LoanCard({
  loan,
  colors,
  recentOps,
  money,
  date,
  statusLabel,
  onViewOps,
  onAddOp,
  onEdit,
  onDelete,
}: {
  loan: PersonalLoan
  colors: { stripe: string; text: string; tint: string }
  recentOps: LoanOperation[]
  money: (v: string | number | null | undefined) => string
  date: (d: Date | string | null | undefined) => string
  statusLabel: (s: string) => string
  onViewOps: () => void
  onAddOp: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useI18n()
  const progress = Math.max(0, Math.min(100, loan.progressPct ?? 0))

  return (
    <Card
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
              <HandCoins className="h-4 w-4" />
            </span>
            <CardTitle className="text-base leading-tight">
              {loan.borrowerName}
            </CardTitle>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className={cn('text-[10px]', statusToneClass(loan.status))}
            >
              {statusLabel(loan.status)}
            </Badge>
            <Badge variant="outline" className="text-[10px] gap-1">
              <CalendarDays className="h-3 w-3" />
              {date(loan.loanDate)}
            </Badge>
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
            <DropdownMenuItem onClick={onViewOps}>
              <History className="h-4 w-4" />
              {t('loan.operations')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onAddOp}>
              <Plus className="h-4 w-4" />
              {t('loan.addOperation')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="h-4 w-4" />
              {t('common.edit')}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={onDelete}
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
            {t('loan.outstanding')}
          </p>
          <p
            className="text-3xl font-bold tabular-nums"
            style={{ color: colors.text }}
          >
            {money(loan.outstanding)}
          </p>
        </div>

        {/* Quick row: Total lent / Total repaid / Progress % / Expected repay date */}
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div>
            <p className="text-muted-foreground">{t('loan.totalLent')}</p>
            <p className="font-medium tabular-nums">
              {money(loan.totalLent)}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">{t('loan.totalRepaid')}</p>
            <p className="font-medium tabular-nums text-income">
              {money(loan.totalRepaid)}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">{t('common.progress')}</p>
            <p className="font-medium tabular-nums">{progress}%</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t('loan.expectedRepayDate')}</p>
            <p className="font-medium tabular-nums">
              {loan.expectedRepayDate ? date(loan.expectedRepayDate) : '—'}
            </p>
          </div>
        </div>

        {/* Progress bar (custom so we can tint with the card color) */}
        <div
          className="relative h-2 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${progress}%`,
              backgroundColor: colors.stripe,
            }}
          />
        </div>

        {/* Operations preview (last 3) */}
        {recentOps.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t('loan.operations')}
            </p>
            <div className="space-y-1">
              {recentOps.map((op) => {
                const Icon = OP_ICON[op.operationType]
                const isCredit =
                  op.operationType === 'repayment' ||
                  op.operationType === 'correction'
                return (
                  <div
                    key={op.id}
                    className="flex items-center justify-between gap-2 rounded-md border bg-card/60 px-2.5 py-1.5 text-xs"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[9px] shrink-0',
                          opTypeToneClass(op.operationType)
                        )}
                      >
                        {t(opTypeLabelKey(op.operationType))}
                      </Badge>
                      <span className="truncate text-muted-foreground">
                        {date(op.operationDate)}
                      </span>
                    </div>
                    <span
                      className={cn(
                        'shrink-0 font-medium tabular-nums',
                        isCredit ? 'text-income' : 'text-foreground'
                      )}
                    >
                      {money(op.amount)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t('common.empty')}</p>
        )}

        {loan.description && (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {loan.description}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function OperationsTable({
  query,
  money,
  date,
  t,
}: {
  query: ReturnType<typeof useQuery<OperationsResponse>>
  money: (v: string | number | null | undefined) => string
  date: (d: Date | string | null | undefined) => string
  t: (k: string) => string
}) {
  const items = query.data?.items ?? []
  const isLoading = query.isLoading

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    )
  }

  if (items.length === 0) {
    return <EmptyState title={t('common.empty')} />
  }

  // Sort by operation date descending (most recent first) for the table view.
  const sorted = [...items].sort(
    (a, b) =>
      new Date(b.operationDate).getTime() -
      new Date(a.operationDate).getTime()
  )

  return (
    <ScrollArea className="max-h-[55vh] pr-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('common.date')}</TableHead>
            <TableHead>{t('common.type')}</TableHead>
            <TableHead className="text-right">{t('common.amount')}</TableHead>
            <TableHead>{t('common.comment')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((op) => {
            const Icon = OP_ICON[op.operationType]
            const isCredit =
              op.operationType === 'repayment' ||
              op.operationType === 'correction'
            return (
              <TableRow key={op.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {date(op.operationDate)}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn('gap-1', opTypeToneClass(op.operationType))}
                  >
                    <Icon className="h-3 w-3" />
                    {t(opTypeLabelKey(op.operationType))}
                  </Badge>
                </TableCell>
                <TableCell
                  className={cn(
                    'text-right whitespace-nowrap font-medium tabular-nums',
                    isCredit ? 'text-income' : 'text-foreground'
                  )}
                >
                  {money(op.amount)}
                </TableCell>
                <TableCell className="max-w-[220px] truncate text-muted-foreground">
                  {op.comment ?? '—'}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </ScrollArea>
  )
}
