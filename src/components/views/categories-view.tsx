'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Plus,
  Search,
  MoreHorizontal,
  Pencil,
  Trash2,
  Archive,
  ArchiveRestore,
} from 'lucide-react'

import { useI18n } from '@/lib/use-i18n'
import { useApi } from '@/lib/use-api'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
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

type CategoryType = 'income' | 'expense'

interface Category {
  id: string
  name: string
  type: CategoryType
  color: string | null
  description: string | null
  archived: boolean
  createdAt: string
  updatedAt: string
}

interface CategoryListResponse {
  items: Category[]
}

const DEFAULT_COLOR = '#64748b'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CategoriesView() {
  const { t } = useI18n()
  const api = useApi()
  const qc = useQueryClient()

  // ---- Filter state ----
  const [typeTab, setTypeTab] = useState<CategoryType>('expense')
  const [archivedOnly, setArchivedOnly] = useState(false)
  const [search, setSearch] = useState('')

  // ---- Dialog state ----
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Category | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null)

  // ---- Form state ----
  const [formName, setFormName] = useState('')
  const [formType, setFormType] = useState<CategoryType>('expense')
  const [formColor, setFormColor] = useState(DEFAULT_COLOR)
  const [formDescription, setFormDescription] = useState('')
  const [formArchived, setFormArchived] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // ---- List query ----
  const listQuery = useQuery<CategoryListResponse>({
    queryKey: [
      'categories',
      typeTab,
      archivedOnly ? 'archived' : 'active',
      search.trim(),
    ],
    queryFn: () =>
      api.get<CategoryListResponse>('/api/categories', {
        query: {
          type: typeTab,
          archived: archivedOnly ? true : false,
          search: search.trim() || undefined,
        },
      }),
  })

  const categories = listQuery.data?.items ?? []
  const loading = listQuery.isLoading

  // ---- Mutations ----
  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/api/categories', body),
    onSuccess: () => {
      toast.success(t('cat.created'))
      qc.invalidateQueries({ queryKey: ['categories'] })
      qc.invalidateQueries({ queryKey: ['articles'] })
      setDialogOpen(false)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.put(`/api/categories/${id}`, body),
    onSuccess: (_data, vars) => {
      // Archive toggle vs full edit use different messages.
      if (vars.body.archived !== undefined && Object.keys(vars.body).length === 1) {
        toast.success(t('cat.archivedMsg'))
      } else {
        toast.success(t('cat.updated'))
      }
      qc.invalidateQueries({ queryKey: ['categories'] })
      qc.invalidateQueries({ queryKey: ['articles'] })
      setDialogOpen(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del(`/api/categories/${id}`),
    onSuccess: () => {
      toast.success(t('common.delete'))
      qc.invalidateQueries({ queryKey: ['categories'] })
      qc.invalidateQueries({ queryKey: ['articles'] })
      setDeleteTarget(null)
    },
  })

  // ---- Handlers ----
  const openCreate = () => {
    setEditing(null)
    setFormName('')
    setFormType(typeTab)
    setFormColor(DEFAULT_COLOR)
    setFormDescription('')
    setFormArchived(false)
    setDialogOpen(true)
  }

  const openEdit = (c: Category) => {
    setEditing(c)
    setFormName(c.name)
    setFormType(c.type)
    setFormColor(c.color ?? DEFAULT_COLOR)
    setFormDescription(c.description ?? '')
    setFormArchived(c.archived)
    setDialogOpen(true)
  }

  const handleSubmit = async () => {
    if (!formName.trim()) {
      toast.error(`${t('common.required')}: ${t('common.name')}`)
      return
    }
    const body: Record<string, unknown> = {
      name: formName.trim(),
      type: formType,
      color: formColor,
      archived: formArchived,
    }
    if (formDescription.trim()) body.description = formDescription.trim()
    else body.description = null

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

  const toggleArchive = async (c: Category) => {
    try {
      await updateMutation.mutateAsync({
        id: c.id,
        body: { archived: !c.archived },
      })
    } catch {
      // 409 already toasted by useApi.
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
  const typeBadge = (tp: CategoryType) =>
    tp === 'income' ? (
      <Badge variant="outline" className="border-transparent bg-income/15 text-income">
        {t('cat.incomeType')}
      </Badge>
    ) : (
      <Badge variant="outline" className="border-transparent bg-expense/15 text-expense">
        {t('cat.expenseType')}
      </Badge>
    )

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('cat.title')}
        actions={
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            {t('cat.add')}
          </Button>
        }
      />

      {/* Filter bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={typeTab} onValueChange={(v) => setTypeTab(v as CategoryType)}>
          <TabsList>
            <TabsTrigger value="expense">{t('cat.expenseType')}</TabsTrigger>
            <TabsTrigger value="income">{t('cat.incomeType')}</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5">
            <Switch
              checked={archivedOnly}
              onCheckedChange={setArchivedOnly}
              id="categories-archived-only"
            />
            <Label
              htmlFor="categories-archived-only"
              className="cursor-pointer text-sm"
            >
              {t('cat.archived')}
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

      {/* Grid of category cards */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : categories.length === 0 ? (
        <EmptyState
          title={t('cat.empty')}
          action={
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              {t('cat.add')}
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {categories.map((c) => (
            <Card key={c.id} className="relative overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 w-1.5"
                style={{ backgroundColor: c.color ?? DEFAULT_COLOR }}
                aria-hidden
              />
              <CardHeader className="pl-6">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="truncate">{c.name}</CardTitle>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {typeBadge(c.type)}
                      {c.archived && (
                        <Badge
                          variant="outline"
                          className="border-transparent bg-warning/15 text-warning"
                        >
                          {t('cat.archived')}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-8 shrink-0">
                        <MoreHorizontal className="size-4" />
                        <span className="sr-only">{t('common.actions')}</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(c)}>
                        <Pencil className="size-4" />
                        {t('common.edit')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => toggleArchive(c)}>
                        {c.archived ? (
                          <ArchiveRestore className="size-4" />
                        ) : (
                          <Archive className="size-4" />
                        )}
                        {c.archived ? t('common.active') : t('cat.archived')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setDeleteTarget(c)}
                      >
                        <Trash2 className="size-4" />
                        {t('common.delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent className="pl-6">
                <p
                  className="line-clamp-2 min-h-[2.5rem] text-sm text-muted-foreground"
                  title={c.description ?? ''}
                >
                  {c.description || '—'}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? t('cat.edit') : t('cat.add')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cat-name">{t('common.name')}</Label>
              <Input
                id="cat-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder={t('common.name')}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cat-type">{t('common.type')}</Label>
                <Select
                  value={formType}
                  onValueChange={(v) => setFormType(v as CategoryType)}
                >
                  <SelectTrigger id="cat-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="expense">{t('cat.expenseType')}</SelectItem>
                    <SelectItem value="income">{t('cat.incomeType')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cat-color">{t('common.color')}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="cat-color"
                    type="color"
                    value={formColor}
                    onChange={(e) => setFormColor(e.target.value)}
                    className="h-10 w-16 cursor-pointer p-1"
                  />
                  <Input
                    value={formColor}
                    onChange={(e) => setFormColor(e.target.value)}
                    className="flex-1 font-mono text-sm"
                    placeholder={DEFAULT_COLOR}
                  />
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cat-desc">{t('common.description')}</Label>
              <Textarea
                id="cat-desc"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label htmlFor="cat-archived" className="cursor-pointer">
                  {t('cat.archived')}
                </Label>
                <p className="text-xs text-muted-foreground">{t('common.status')}</p>
              </div>
              <Switch
                id="cat-archived"
                checked={formArchived}
                onCheckedChange={setFormArchived}
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
