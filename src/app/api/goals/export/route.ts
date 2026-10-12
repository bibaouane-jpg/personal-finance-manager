import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/api'
import { audit } from '@/lib/audit'
import { subMoney } from '@/lib/money'

function escapeCsvCell(value: string | null | undefined): string {
  if (value === null || value === undefined) return ''
  let v = String(value)
  // Formula-injection guard.
  if (/^[=+\-@]/.test(v)) {
    v = `'${v}`
  }
  // Wrap in quotes and escape embedded quotes/newlines.
  if (/[",\n\r]/.test(v)) {
    v = `"${v.replace(/"/g, '""')}"`
  }
  return v
}

function dateToYmd(date: Date | string | null | undefined): string {
  if (!date) return ''
  const d = date instanceof Date ? date : new Date(date)
  if (isNaN(d.getTime())) return ''
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(
    2,
    '0'
  )}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** GET /api/goals/export — export filtered goals as CSV. */
export async function GET(req: Request) {
  return withAuth(async ({ userId }) => {
    const url = new URL(req.url)
    const yearParam = url.searchParams.get('year')

    const where: Record<string, unknown> = { userId }
    if (yearParam) where.year = parseInt(yearParam, 10)

    const items = await db.goal.findMany({
      where,
      include: { goalCategory: true },
      orderBy: [{ year: 'desc' }, { priority: 'asc' }, { createdAt: 'desc' }],
    })

    const header = [
      'Year',
      'Title',
      'Category',
      'Priority',
      'Status',
      'Progress',
      'RequiredBudget',
      'SavedBudget',
      'RemainingBudget',
      'TargetDate',
      'Note',
    ]

    const rows = items.map((g) => {
      const remaining = subMoney(g.requiredBudget ?? '0', g.savedBudget ?? '0')
      return [
        escapeCsvCell(String(g.year)),
        escapeCsvCell(g.title),
        escapeCsvCell(g.goalCategory?.name ?? ''),
        escapeCsvCell(String(g.priority)),
        escapeCsvCell(g.status),
        escapeCsvCell(`${g.progress}%`),
        escapeCsvCell(g.requiredBudget ?? ''),
        escapeCsvCell(g.savedBudget ?? ''),
        escapeCsvCell(remaining),
        escapeCsvCell(dateToYmd(g.targetDate)),
        escapeCsvCell(g.note ?? ''),
      ].join(',')
    })

    const csv = [header.join(','), ...rows].join('\r\n')

    await audit({
      userId,
      entityType: 'Goal',
      entityId: 'export',
      operation: 'update',
      newValues: { count: items.length, filters: Object.fromEntries(url.searchParams) },
      reason: `Exported ${items.length} goals to CSV`,
    })

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="goals.csv"',
      },
    })
  })(req)
}
