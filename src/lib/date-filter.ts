// Date period resolver for analytics / dashboard filters.
// Uses Africa/Casablanca timezone semantics: "today" is the local date in
// Africa/Casablanca, but expressed as a UTC Date so it round-trips cleanly
// through Prisma's DateTime columns (which we always write/read in UTC).

export type PeriodFilter =
  | 'today'
  | 'this_week'
  | 'this_month'
  | 'this_year'
  | 'all_time'
  | 'custom'

export interface ResolvedPeriod {
  start: Date
  end: Date
}

const TZ = 'Africa/Casablanca'

/** Convert a Date to its local date parts (Y, M, D) in the configured timezone. */
function getLocalParts(date: Date, timezone: string = TZ): {
  year: number
  month: number // 0-based
  day: number
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const y = parseInt(parts.find((p) => p.type === 'year')?.value ?? '0', 10)
  const m = parseInt(parts.find((p) => p.type === 'month')?.value ?? '0', 10) - 1
  const d = parseInt(parts.find((p) => p.type === 'day')?.value ?? '0', 10)
  return { year: y, month: m, day: d }
}

/** Monday of the current week (local time). Returns the start-of-week date at midnight UTC. */
export function WeekStart(date: Date = new Date()): Date {
  const { year, month, day } = getLocalParts(date)
  // Local-midnight UTC (matches parseLocalDate convention).
  const localMidnight = new Date(Date.UTC(year, month, day, 0, 0, 0, 0))
  // JS getDay: 0=Sun, 1=Mon, ..., 6=Sat. We want Monday=0.
  const dow = localMidnight.getUTCDay() // 0..6, Sunday=0
  const offset = dow === 0 ? 6 : dow - 1 // days since Monday
  const ms = localMidnight.getTime() - offset * 24 * 60 * 60 * 1000
  return new Date(ms)
}

/** End of the current week (Sunday, 23:59:59.999 UTC). */
export function WeekEnd(date: Date = new Date()): Date {
  const start = WeekStart(date)
  return new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000 - 1)
}

/** Parse a "YYYY-MM-DD" string into a midnight-UTC Date. */
function parseYMD(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const y = parseInt(m[1], 10)
  const mo = parseInt(m[2], 10) - 1
  const d = parseInt(m[3], 10)
  if (Number.isNaN(y) || Number.isNaN(mo) || Number.isNaN(d)) return null
  const dt = new Date(Date.UTC(y, mo, d, 0, 0, 0, 0))
  if (isNaN(dt.getTime())) return null
  return dt
}

/**
 * Resolve a filter string into a {start, end} Date range.
 * `end` is inclusive of end-of-day (23:59:59.999 UTC) for day/month/year/week
 * filters, except for 'all_time' where it's `new Date(Date.now())`.
 * For 'custom', both `from` and `to` must be provided; if `to` is omitted,
 * end defaults to now; if `from` is omitted, start defaults to epoch.
 */
export function resolvePeriod(
  filter: string,
  from?: string,
  to?: string
): ResolvedPeriod {
  const now = new Date()
  const f = (filter || 'this_month').toLowerCase()

  switch (f) {
    case 'today': {
      const { year, month, day } = getLocalParts(now)
      const start = new Date(Date.UTC(year, month, day, 0, 0, 0, 0))
      const end = new Date(Date.UTC(year, month, day, 23, 59, 59, 999))
      return { start, end }
    }
    case 'this_week': {
      const start = WeekStart(now)
      const end = WeekEnd(now)
      return { start, end }
    }
    case 'this_month': {
      const { year, month } = getLocalParts(now)
      const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0))
      // Last day of month (local).
      const lastDay = new Date(Date.UTC(year, month + 1, 0))
      const end = new Date(
        Date.UTC(
          lastDay.getUTCFullYear(),
          lastDay.getUTCMonth(),
          lastDay.getUTCDate(),
          23,
          59,
          59,
          999
        )
      )
      return { start, end }
    }
    case 'this_year': {
      const { year } = getLocalParts(now)
      const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0))
      const end = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999))
      return { start, end }
    }
    case 'all_time': {
      return { start: new Date(0), end: new Date(Date.now()) }
    }
    case 'custom': {
      const startD = from ? parseYMD(from) : null
      const endD = to ? parseYMD(to) : null
      const start = startD ?? new Date(0)
      const end = endD
        ? new Date(
            Date.UTC(
              endD.getUTCFullYear(),
              endD.getUTCMonth(),
              endD.getUTCDate(),
              23,
              59,
              59,
              999
            )
          )
        : new Date(Date.now())
      return { start, end }
    }
    default: {
      // Unknown filter: fall back to this_month.
      const { year, month } = getLocalParts(now)
      const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0))
      const lastDay = new Date(Date.UTC(year, month + 1, 0))
      const end = new Date(
        Date.UTC(
          lastDay.getUTCFullYear(),
          lastDay.getUTCMonth(),
          lastDay.getUTCDate(),
          23,
          59,
          59,
          999
        )
      )
      return { start, end }
    }
  }
}

/** Format a Date as YYYY-MM (used for monthly buckets). */
export function ymKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Format a Date as YYYY-MM-DD (UTC). */
export function ymdKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate()
  ).padStart(2, '0')}`
}
