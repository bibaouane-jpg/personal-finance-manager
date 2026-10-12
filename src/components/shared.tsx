'use client'

import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LucideIcon } from 'lucide-react'
import { useI18n } from '@/lib/use-i18n'
import { Skeleton } from '@/components/ui/skeleton'

interface StatCardProps {
  label: string
  value: string
  icon?: LucideIcon
  tone?: 'default' | 'income' | 'expense' | 'warning' | 'info'
  hint?: string
  loading?: boolean
  className?: string
}

const toneClasses: Record<NonNullable<StatCardProps['tone']>, string> = {
  default: 'text-foreground',
  income: 'text-income',
  expense: 'text-expense',
  warning: 'text-warning',
  info: 'text-info',
}

const toneIconBg: Record<NonNullable<StatCardProps['tone']>, string> = {
  default: 'bg-muted text-foreground',
  income: 'bg-income/15 text-income',
  expense: 'bg-expense/15 text-expense',
  warning: 'bg-warning/15 text-warning',
  info: 'bg-info/15 text-info',
}

// Subtle gradient + accent border per tone for a modern fintech look.
const toneCardStyle: Record<NonNullable<StatCardProps['tone']>, React.CSSProperties> = {
  default: {},
  income: { background: 'linear-gradient(135deg, hsl(0 0% 100 / 0.6), hsl(140 60% 96% / 0.8))', borderTop: '3px solid var(--income)' },
  expense: { background: 'linear-gradient(135deg, hsl(0 0% 100 / 0.6), hsl(0 70% 97% / 0.8))', borderTop: '3px solid var(--expense)' },
  warning: { background: 'linear-gradient(135deg, hsl(0 0% 100 / 0.6), hsl(40 70% 97% / 0.8))', borderTop: '3px solid var(--warning)' },
  info: { background: 'linear-gradient(135deg, hsl(0 0% 100 / 0.6), hsl(220 60% 97% / 0.8))', borderTop: '3px solid var(--info)' },
}

const toneCardStyleDark: Record<NonNullable<StatCardProps['tone']>, React.CSSProperties> = {
  default: {},
  income: { background: 'linear-gradient(135deg, hsl(0 0% 12% / 0.4), hsl(140 30% 15% / 0.6))', borderTop: '3px solid var(--income)' },
  expense: { background: 'linear-gradient(135deg, hsl(0 0% 12% / 0.4), hsl(0 30% 15% / 0.6))', borderTop: '3px solid var(--expense)' },
  warning: { background: 'linear-gradient(135deg, hsl(0 0% 12% / 0.4), hsl(40 30% 15% / 0.6))', borderTop: '3px solid var(--warning)' },
  info: { background: 'linear-gradient(135deg, hsl(0 0% 12% / 0.4), hsl(220 30% 15% / 0.6))', borderTop: '3px solid var(--info)' },
}

export function StatCard({ label, value, icon: Icon, tone = 'default', hint, loading, className }: StatCardProps) {
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  const style = tone === 'default' ? {} : (isDark ? toneCardStyleDark[tone] : toneCardStyle[tone])
  return (
    <Card className={cn('overflow-hidden transition-shadow hover:shadow-md', className)} style={style}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</CardTitle>
        {Icon && (
          <div className={cn('rounded-md p-1.5', toneIconBg[tone])}>
            <Icon className="h-4 w-4" />
          </div>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-7 w-28" />
        ) : (
          <div className={cn('text-2xl font-bold tabular-nums', toneClasses[tone])}>{value}</div>
        )}
        {hint && !loading && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
      </CardContent>
    </Card>
  )
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-10 text-center">
      <p className="text-base font-medium">{title}</p>
      {description && <p className="mt-1 text-sm text-muted-foreground max-w-md">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function MoneyText({ value, tone, className }: { value: string; tone?: 'income' | 'expense' | 'default'; className?: string }) {
  const { money } = useI18n()
  const cls = tone === 'income' ? 'text-income' : tone === 'expense' ? 'text-expense' : ''
  return <span className={cn('tabular-nums font-medium', cls, className)}>{money(value)}</span>
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
