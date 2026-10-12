'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Search, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'

import { useI18n } from '@/lib/use-i18n'
import { useApi } from '@/lib/use-api'

import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import { EmptyState, PageHeader } from '@/components/shared'
import { ConfirmDialog } from '@/components/confirm-dialog'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ArticleType = 'income' | 'expense'

interface CategoryLite {
  id: string
  name: string
  color: string | null
}

interface Article {
  id: string
  name: string
  type: ArticleType
  description: string | null
  defaultAmount: string | null
  defaultCategoryId: string | null
  defaultCategory: CategoryLite | null
  active: boolean
  createdAt: string
  updatedAt: string
}

interface ArticleListResponse {
  items: Article[]
}

interface CategoryListResponse {
  items: CategoryLite[]
}

const NONE_VALUE = '__none__'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ArticlesView() {
  const { t, money } = useI18n()
  const api = useApi()
  const qc = useQueryClient()

  // ---- Filter state ----
  const [typeTab, setTypeTab] = useState<ArticleType>('expense')
  const [activeOnly, setActiveOnly] = useState(false)
  const [search, setSearch] = useState('')

  // ---- Dialog state ----
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Article | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Article | null>(null)

  // ---- Form state ----
  const [formName, setFormName] = useState('')
  const [formType, setFormType] = useState<ArticleType>('expense')
  const [formDefaultAmount, setFormDefaultAmount] = useState('')
  const [formDefaultCategoryId, setFormDefaultCategoryId] = useState<string>('')
  const [formDescription, setFormDescription] = useState('')
  const [formActive, setFormActive] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // ---- List query ----
  const listQuery = useQuery<ArticleListResponse>({
    queryKey: ['articles', typeTab, activeOnly ? 'active' : 'all', search.trim()],
    queryFn: () =>
      api.get<ArticleListResponse>('/api/articles', {
        query: {
          type: typeTab,
          active: activeOnly ? true : undefined,
          search: search.trim() || undefined,
        },
      }),
  })

  const articles = listQuery.data?.items ?? []
  const loading = listQuery.isLoading

  // ---- Categories available as default for the form (matches formType).
  // Refetched when the article type tab changes (because openCreate seeds
  // formType from typeTab) or when the user changes the type Select.
  const formCategoriesQuery = useQuery<CategoryListResponse>({
    queryKey: ['categories', formType, 'articles-form'],
    queryFn: () =>
      api.get<CategoryListResponse>('/api/categories', { query: { type: formType } }),
    enabled: dialogOpen,
  })
  const formCategories = formCategoriesQuery.data?.items ?? []

  // ---- Mutations ----
  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/api/articles', body),
    onSuccess: () => {
      toast.success(t('art.created'))
      qc.invalidateQueries({ queryKey: ['articles'] })
      setDialogOpen(false)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.put(`/api/articles/${id}`, body),
    onSuccess: () => {
      toast.success(t('art.updated'))
      qc.invalidateQueries({ queryKey: ['articles'] })
      setDialogOpen(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del(`/api/articles/${id}`),
    onSuccess: () => {
      toast.success(t('common.delete'))
      qc.invalidateQueries({ queryKey: ['articles'] })
      setDeleteTarget(null)
    },
  })

  // ---- Handlers ----
  const openCreate = () => {
    setEditing(null)
    setFormName('')
    setFormType(typeTab)
    setFormDefaultAmount('')
    setFormDefaultCategoryId('')
    setFormDescription('')
    setFormActive(true)
    setDialogOpen(true)
  }

  const openEdit = (a: Article) => {
    setEditing(a)
    setFormName(a.name)
    setFormType(a.type)
    setFormDefaultAmount(a.defaultAmount ?? '')
    setFormDefaultCategoryId(a.defaultCategoryId ?? '')
    setFormDescription(a.description ?? '')
    setFormActive(a.active)
    setDialogOpen(true)
  }

  const handleSubmit = async () => {
    if (!formName.trim()) {
      toast.error(`${t('common.required')}: ${t('common.name')}`)
      return
    }
    const amountNum = Number(formDefaultAmount)
    const body: Record<string, unknown> = {
      name: formName.trim(),
      type: formType,
      defaultAmount: Number.isFinite(amountNum) ? amountNum.toFixed(2) : '0',
      active: formActive,
    }
    if (formDescription.trim()) body.description = formDescription.trim()
    if (formDefaultCategoryId) body.defaultCategoryId = formDefaultCategoryId

    setSubmitting(true)
    try {
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, body })
      } else {
        await createMutation.mutateAsync(body)
      }
    } catch {
      // useApi already toasted the error (including 409 conflict messages).
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
    } catch {
      // 409 already toasted by useApi.
    }
  }

  // ---- Render helpers ----
  const typeBadge = (tp: ArticleType) =>
    tp === 'income' ? (
      <Badge variant="outline" className="border-transparent bg-income/15 text-income">
        {t('cat.incomeType')}
      </Badge>
    ) : (
      <Badge variant="outline" className="border-transparent bg-expense/15 text-expense">
        {t('cat.expenseType')}
      </Badge>
    )

  const categoryBadge = (cat: CategoryLite | null) => {
    if (!cat) return <span className="text-muted-foreground">—</span>
    const color = cat.color ?? '#6b7280'
    return (
      <Badge
        variant="outline"
        className="border-transparent text-white"
        style={{ backgroundColor: color }}
      >
        <span
          className="inline-block size-2 rounded-full bg-white/80"
          aria-hidden
        />
        {cat.name}
      </Badge>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('art.title')}
        actions={
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            {t('art.add')}
          </Button>
        }
      />

      {/* Filter bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={typeTab} onValueChange={(v) => setTypeTab(v as ArticleType)}>
          <TabsList>
            <TabsTrigger value="expense">{t('cat.expenseType')}</TabsTrigger>
            <TabsTrigger value="income">{t('cat.incomeType')}</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5">
            <Switch
              checked={activeOnly}
              onCheckedChange={setActiveOnly}
              id="articles-active-only"
            />
            <Label
              htmlFor="articles-active-only"
              className="cursor-pointer text-sm"
            >
              {t('common.active')}
            </Label>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('common.search')}
              className="pl-8 sm:w-64"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : articles.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title={t('art.empty')}
                action={
                  <Button onClick={openCreate}>
                    <Plus className="size-4" />
                    {t('art.add')}
                  </Button>
                }
              />
            </div>
          ) : (
            <ScrollArea className="max-h-[600px] scrollbar-thin">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t('common.name')}</TableHead>
                    <TableHead>{t('common.type')}</TableHead>
                    <TableHead className="text-right">
                      {t('art.defaultAmount')}
                    </TableHead>
                    <TableHead>{t('art.defaultCategory')}</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                    <TableHead className="min-w-[200px]">
                      {t('common.description')}
                    </TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {articles.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.name}</TableCell>
                      <TableCell>{typeBadge(a.type)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {a.defaultAmount ? money(a.defaultAmount) : '—'}
                      </TableCell>
                      <TableCell>{categoryBadge(a.defaultCategory)}</TableCell>
                      <TableCell>
                        {a.active ? (
                          <Badge
                            variant="outline"
                            className="border-transparent bg-income/15 text-income"
                          >
                            {t('common.active')}
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-transparent bg-muted text-muted-foreground"
                          >
                            {t('common.inactive')}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell
                        className="max-w-[260px]"
                        title={a.description ?? ''}
                      >
                        <span className="line-clamp-1 text-sm text-muted-foreground">
                          {a.description || '—'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8">
                              <MoreHorizontal className="size-4" />
                              <span className="sr-only">
                                {t('common.actions')}
                              </span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(a)}>
                              <Pencil className="size-4" />
                              {t('common.edit')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setDeleteTarget(a)}
                            >
                              <Trash2 className="size-4" />
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

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? t('art.edit') : t('art.add')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="art-name">{t('common.name')}</Label>
              <Input
                id="art-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder={t('common.name')}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="art-type">{t('common.type')}</Label>
                <Select
                  value={formType}
                  onValueChange={(v) => {
                    setFormType(v as ArticleType)
                    // Reset default category when type changes — the previous
                    // category may not belong to the new type.
                    setFormDefaultCategoryId('')
                  }}
                >
                  <SelectTrigger id="art-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="expense">
                      {t('cat.expenseType')}
                    </SelectItem>
                    <SelectItem value="income">{t('cat.incomeType')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="art-amount">{t('art.defaultAmount')}</Label>
                <Input
                  id="art-amount"
                  type="number"
                  step="0.01"
                  value={formDefaultAmount}
                  onChange={(e) => setFormDefaultAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="art-cat">{t('art.defaultCategory')}</Label>
              <Select
                value={formDefaultCategoryId || NONE_VALUE}
                onValueChange={(v) =>
                  setFormDefaultCategoryId(v === NONE_VALUE ? '' : v)
                }
              >
                <SelectTrigger id="art-cat">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>{t('common.none')}</SelectItem>
                  {formCategories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="art-desc">{t('common.description')}</Label>
              <Textarea
                id="art-desc"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label htmlFor="art-active" className="cursor-pointer">
                  {t('common.active')}
                </Label>
                <p className="text-xs text-muted-foreground">{t('common.status')}</p>
              </div>
              <Switch
                id="art-active"
                checked={formActive}
                onCheckedChange={setFormActive}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={submitting}
            >
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

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
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
