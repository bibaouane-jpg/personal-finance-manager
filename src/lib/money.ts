// Decimal-safe monetary arithmetic helpers.
// All monetary values are stored in the DB as strings to avoid floating point drift.
// We use a lightweight, dependency-free decimal implementation that operates on
// integer cents under the hood, giving us exact arithmetic for MAD.

export type Money = string // canonical string form e.g. "25000.00"

/**
 * Convert a decimal string/number to an integer number of minor units (cents).
 * Returns 0 for invalid input.
 */
export function toCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  const s = typeof value === 'number' ? String(value) : String(value).trim()
  if (s === '') return 0
  const negative = s.startsWith('-')
  const clean = negative ? s.slice(1) : s
  // accept "1,234.56" or "1 234,56" -> normalize to "1234.56"
  const withoutThousands = clean.replace(/[\s]/g, '').replace(/,(?=\d{3}(\D|$))/g, '')
  // if there is a comma followed by exactly 2 digits at the end, treat comma as decimal separator
  let normalized: string
  if (/,\d{2}$/.test(withoutThousands)) {
    normalized = withoutThousands.replace(/,(\d{2})$/, '.$1')
  } else {
    normalized = withoutThousands.replace(/,/g, '')
  }
  const n = Number(normalized)
  if (!Number.isFinite(n)) return 0
  const cents = Math.round(n * 100)
  return negative ? -cents : cents
}

/** Convert cents back to a canonical decimal string with 2 decimal places. */
export function fromCents(cents: number): string {
  const negative = cents < 0
  const abs = Math.abs(cents)
  const intPart = Math.floor(abs / 100)
  const frac = abs % 100
  const sign = negative ? '-' : ''
  return `${sign}${intPart}.${frac.toString().padStart(2, '0')}`
}

/** Add two monetary strings. */
export function addMoney(a: string | number | null | undefined, b: string | number | null | undefined): string {
  return fromCents(toCents(a) + toCents(b))
}

/** Subtract b from a. */
export function subMoney(a: string | number | null | undefined, b: string | number | null | undefined): string {
  return fromCents(toCents(a) - toCents(b))
}

/** Multiply money by a scalar (integer or decimal). */
export function mulMoney(money: string | number | null | undefined, factor: number): string {
  return fromCents(Math.round(toCents(money) * factor))
}

/** Compare two money values: -1 if a<b, 0 if equal, 1 if a>b. */
export function compareMoney(a: string | number | null | undefined, b: string | number | null | undefined): number {
  const diff = toCents(a) - toCents(b)
  if (diff < 0) return -1
  if (diff > 0) return 1
  return 0
}

/** True if a >= b. */
export function gteMoney(a: string | number | null | undefined, b: string | number | null | undefined): boolean {
  return compareMoney(a, b) >= 0
}

/** True if a > 0. */
export function isPositiveMoney(a: string | number | null | undefined): boolean {
  return toCents(a) > 0
}

/** Percentage of a over b (0-100). Returns 0 when b is 0. */
export function pct(a: string | number | null | undefined, b: string | number | null | undefined): number {
  const bc = toCents(b)
  if (bc === 0) return 0
  return (toCents(a) / bc) * 100
}

/** Format money for display in a given locale and currency. */
export function formatMoney(
  value: string | number | null | undefined,
  locale: 'en' | 'fr' = 'en',
  currency: string = 'MAD',
  opts: { withCurrency?: boolean } = { withCurrency: true }
): string {
  const cents = toCents(value)
  const amount = cents / 100
  const withCurrency = opts.withCurrency ?? true
  if (withCurrency) {
    try {
      return new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-US', {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount)
    } catch {
      // fallback if currency code unsupported
      const num = new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount)
      return locale === 'fr' ? `${num} ${currency}` : `${currency} ${num}`
    }
  }
  return new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

/** Format a number as a plain locale string without currency. */
export function formatNumber(value: number, locale: 'en' | 'fr' = 'en'): string {
  return new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-US').format(value)
}

/** Format a date for display, using the Africa/Casablanca timezone by default. */
export function formatDate(date: Date | string | null | undefined, locale: 'en' | 'fr' = 'en', timezone = 'Africa/Casablanca'): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: timezone,
  }).format(d)
}

/** Format a date with time. */
export function formatDateTime(date: Date | string | null | undefined, locale: 'en' | 'fr' = 'en', timezone = 'Africa/Casablanca'): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  }).format(d)
}

/**
 * Convert an ISO date string or Date to a "YYYY-MM-DD" string in the configured timezone,
 * so financial dates don't shift across timezone boundaries.
 */
export function toLocalDateString(date: Date | string, timezone = 'Africa/Casablanca'): string {
  const d = typeof date === 'string' ? new Date(date) : date
  // Use Intl to get the parts in the target timezone
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const y = parts.find(p => p.type === 'year')?.value ?? ''
  const m = parts.find(p => p.type === 'month')?.value ?? ''
  const day = parts.find(p => p.type === 'day')?.value ?? ''
  return `${y}-${m}-${day}`
}

/** Parse a "YYYY-MM-DD" string as a Date at local midnight in the configured timezone. */
export function parseLocalDate(s: string, timezone = 'Africa/Casablanca'): Date {
  // We store the date as midnight UTC so it round-trips; we display using timezone.
  const [y, m, d] = s.split('-').map(Number)
  if (!y || !m || !d) return new Date(s)
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0))
}
