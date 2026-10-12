'use client'

import { useAppStore } from './store'
import { translate, type Locale } from './i18n'
import { formatMoney, formatNumber, formatDate, formatDateTime } from './money'

export function useI18n() {
  const locale = useAppStore((s) => s.locale)
  const t = (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars)
  const money = (value: string | number | null | undefined, currency = 'MAD', withCurrency = true) =>
    formatMoney(value, locale, currency, { withCurrency })
  const num = (value: number) => formatNumber(value, locale)
  const date = (d: Date | string | null | undefined) => formatDate(d, locale)
  const dateTime = (d: Date | string | null | undefined) => formatDateTime(d, locale)
  return { locale, t, money, num, date, dateTime }
}

export type { Locale }
