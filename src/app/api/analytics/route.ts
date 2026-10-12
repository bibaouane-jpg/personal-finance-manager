import { db } from '@/lib/db'
import { withAuth, ok, serialize } from '@/lib/api'
import { resolvePeriod, ymKey } from '@/lib/date-filter'
import {
  toCents,
  fromCents,
  addMoney,
  subMoney,
  pct,
} from '@/lib/money'
import { getWalletBalance, getWalletBalanceAt } from '@/lib/ledger'
import {
  computeCreditSummary,
  computeLoanSummary,
} from '@/lib/credit-summary'

type Section =
  | 'income'
  | 'expenses'
  | 'wallets'
  | 'cash_withdrawals'
  | 'transfers'
  | 'net_cash_flow'
  | 'allocations'
  | 'bank_credits'
  | 'personal_loans'
  | 'goals'

const ALL_SECTIONS: Section[] = [
  'income',
  'expenses',
  'wallets',
  'cash_withdrawals',
  'transfers',
  'net_cash_flow',
  'allocations',
  'bank_credits',
  'personal_loans',
  'goals',
]

interface AnalyticsContext {
  userId: string
  start: Date
  end: Date
}

/** Compute income section analytics. */
async function incomeSection(ctx: AnalyticsContext) {
  const { userId, start, end } = ctx
  const dateRange = { gte: start, lte: end }

  const [rows, allCats, allArticles, allWallets] = await Promise.all([
    db.incomeTransaction.findMany({
      where: { userId, financialDate: dateRange },
      include: { category: true, article: true, wallet: true },
    }),
    db.category.findMany({
      where: { userId, type: 'income' },
      select: { id: true, name: true, color: true, archived: true },
    }),
    db.article.findMany({
      where: { userId, type: 'income' },
      select: { id: true, name: true, active: true },
    }),
    db.wallet.findMany({
      where: { userId },
      select: { id: true, name: true, color: true, active: true, type: true },
    }),
  ])

  const total = rows.reduce((acc, r) => addMoney(acc, r.amount), '0.00')
  const totalCents = toCents(total)

  // byCategory
  const byCatMap = new Map<
    string,
    { categoryId: string; name: string; color: string; amount: number }
  >()
  for (const r of rows) {
    if (!r.categoryId) continue
    const cat = allCats.find((c) => c.id === r.categoryId)
    if (!cat || cat.archived) continue
    const e = byCatMap.get(cat.id) ?? {
      categoryId: cat.id,
      name: cat.name,
      color: cat.color,
      amount: 0,
    }
    e.amount += toCents(r.amount)
    byCatMap.set(cat.id, e)
  }
  const byCategory = Array.from(byCatMap.values())
    .map((e) => ({ ...e, amount: fromCents(e.amount) }))
    .sort((a, b) => toCents(b.amount) - toCents(a.amount))

  // byArticle
  const byArtMap = new Map<
    string,
    { articleId: string; name: string; amount: number }
  >()
  for (const r of rows) {
    if (!r.articleId) continue
    const art = allArticles.find((a) => a.id === r.articleId)
    if (!art || !art.active) continue
    const e = byArtMap.get(art.id) ?? {
      articleId: art.id,
      name: art.name,
      amount: 0,
    }
    e.amount += toCents(r.amount)
    byArtMap.set(art.id, e)
  }
  const byArticle = Array.from(byArtMap.values())
    .map((e) => ({ ...e, amount: fromCents(e.amount) }))
    .sort((a, b) => toCents(b.amount) - toCents(a.amount))

  // byWallet
  const byWalletMap = new Map<
    string,
    { walletId: string; name: string; color: string; amount: number }
  >()
  for (const r of rows) {
    const wlt = allWallets.find((w) => w.id === r.walletId)
    if (!wlt) continue
    const e = byWalletMap.get(wlt.id) ?? {
      walletId: wlt.id,
      name: wlt.name,
      color: wlt.color,
      amount: 0,
    }
    e.amount += toCents(r.amount)
    byWalletMap.set(wlt.id, e)
  }
  const byWallet = Array.from(byWalletMap.values())
    .map((e) => ({ ...e, amount: fromCents(e.amount) }))
    .sort((a, b) => toCents(b.amount) - toCents(a.amount))

  // monthly (12 months ending at end-of-period)
  const endMonth = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1, 0, 0, 0, 0)
  )
  const monthly: { month: string; amount: string }[] = []
  for (let i = 11; i >= 0; i--) {
    const bStart = new Date(
      Date.UTC(endMonth.getUTCFullYear(), endMonth.getUTCMonth() - i, 1, 0, 0, 0, 0)
    )
    const bEnd = new Date(
      Date.UTC(bStart.getUTCFullYear(), bStart.getUTCMonth() + 1, 0, 23, 59, 59, 999)
    )
    const cents = rows
      .filter((r) => {
        const d =
          r.financialDate instanceof Date ? r.financialDate : new Date(r.financialDate)
        return d >= bStart && d <= bEnd
      })
      .reduce((s, r) => s + toCents(r.amount), 0)
    monthly.push({ month: ymKey(bStart), amount: fromCents(cents) })
  }

  // average per month over the period
  const periodMonths = Math.max(
    1,
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      (end.getUTCMonth() - start.getUTCMonth()) +
      1
  )
  const average = fromCents(Math.round(totalCents / periodMonths))

  // largest single income transaction
  const largestRow = rows.reduce(
    (best: null | (typeof rows)[number], r) =>
      best === null || toCents(r.amount) > toCents(best.amount) ? r : best,
    null
  )
  const largest = largestRow
    ? {
        id: largestRow.id,
        name: largestRow.name,
        amount: largestRow.amount,
        date: largestRow.financialDate,
        categoryName: largestRow.category?.name ?? null,
      }
    : null

  // source concentration: share of the largest source bucket in total income.
  const topCatAmount = byCategory[0]?.amount ?? '0.00'
  const sourceConcentration = pct(topCatAmount, total)

  return {
    total,
    byCategory,
    byArticle,
    byWallet,
    monthly,
    average,
    largest,
    sourceConcentration: Math.round(sourceConcentration * 100) / 100,
  }
}

/** Compute expense section analytics. */
async function expenseSection(ctx: AnalyticsContext) {
  const { userId, start, end } = ctx
  const dateRange = { gte: start, lte: end }

  const [rows, allCats, allArticles, allWallets, incomeRows] = await Promise.all([
    db.expenseTransaction.findMany({
      where: { userId, financialDate: dateRange },
      include: { category: true, article: true, wallet: true },
    }),
    db.category.findMany({
      where: { userId, type: 'expense' },
      select: { id: true, name: true, color: true, archived: true },
    }),
    db.article.findMany({
      where: { userId, type: 'expense' },
      select: { id: true, name: true, active: true },
    }),
    db.wallet.findMany({
      where: { userId },
      select: { id: true, name: true, color: true, active: true, type: true },
    }),
    db.incomeTransaction.findMany({
      where: { userId, financialDate: dateRange },
      select: { amount: true },
    }),
  ])

  const total = rows.reduce((acc, r) => addMoney(acc, r.amount), '0.00')
  const totalCents = toCents(total)

  const byCatMap = new Map<
    string,
    { categoryId: string; name: string; color: string; amount: number }
  >()
  for (const r of rows) {
    if (!r.categoryId) continue
    const cat = allCats.find((c) => c.id === r.categoryId)
    if (!cat || cat.archived) continue
    const e = byCatMap.get(cat.id) ?? {
      categoryId: cat.id,
      name: cat.name,
      color: cat.color,
      amount: 0,
    }
    e.amount += toCents(r.amount)
    byCatMap.set(cat.id, e)
  }
  const byCategory = Array.from(byCatMap.values())
    .map((e) => ({ ...e, amount: fromCents(e.amount) }))
    .sort((a, b) => toCents(b.amount) - toCents(a.amount))

  const byArtMap = new Map<
    string,
    { articleId: string; name: string; amount: number }
  >()
  for (const r of rows) {
    if (!r.articleId) continue
    const art = allArticles.find((a) => a.id === r.articleId)
    if (!art || !art.active) continue
    const e = byArtMap.get(art.id) ?? {
      articleId: art.id,
      name: art.name,
      amount: 0,
    }
    e.amount += toCents(r.amount)
    byArtMap.set(art.id, e)
  }
  const byArticle = Array.from(byArtMap.values())
    .map((e) => ({ ...e, amount: fromCents(e.amount) }))
    .sort((a, b) => toCents(b.amount) - toCents(a.amount))

  const byWalletMap = new Map<
    string,
    { walletId: string; name: string; color: string; amount: number }
  >()
  for (const r of rows) {
    const wlt = allWallets.find((w) => w.id === r.walletId)
    if (!wlt) continue
    const e = byWalletMap.get(wlt.id) ?? {
      walletId: wlt.id,
      name: wlt.name,
      color: wlt.color,
      amount: 0,
    }
    e.amount += toCents(r.amount)
    byWalletMap.set(wlt.id, e)
  }
  const byWallet = Array.from(byWalletMap.values())
    .map((e) => ({ ...e, amount: fromCents(e.amount) }))
    .sort((a, b) => toCents(b.amount) - toCents(a.amount))

  const endMonth = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1, 0, 0, 0, 0)
  )
  const monthly: { month: string; amount: string }[] = []
  for (let i = 11; i >= 0; i--) {
    const bStart = new Date(
      Date.UTC(endMonth.getUTCFullYear(), endMonth.getUTCMonth() - i, 1, 0, 0, 0, 0)
    )
    const bEnd = new Date(
      Date.UTC(bStart.getUTCFullYear(), bStart.getUTCMonth() + 1, 0, 23, 59, 59, 999)
    )
    const cents = rows
      .filter((r) => {
        const d =
          r.financialDate instanceof Date ? r.financialDate : new Date(r.financialDate)
        return d >= bStart && d <= bEnd
      })
      .reduce((s, r) => s + toCents(r.amount), 0)
    monthly.push({ month: ymKey(bStart), amount: fromCents(cents) })
  }

  const periodMonths = Math.max(
    1,
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      (end.getUTCMonth() - start.getUTCMonth()) +
      1
  )
  const average = fromCents(Math.round(totalCents / periodMonths))

  const largestRow = rows.reduce(
    (best: null | (typeof rows)[number], r) =>
      best === null || toCents(r.amount) > toCents(best.amount) ? r : best,
    null
  )
  const largest = largestRow
    ? {
        id: largestRow.id,
        name: largestRow.name,
        amount: largestRow.amount,
        date: largestRow.financialDate,
        categoryName: largestRow.category?.name ?? null,
      }
    : null

  const incomeTotal = incomeRows.reduce(
    (acc, r) => addMoney(acc, r.amount),
    '0.00'
  )
  const savingsRate = pct(subMoney(incomeTotal, total), incomeTotal)

  // No wallet-level budgets in schema; expose a structural placeholder.
  const budgetComparison = { hasBudgets: false, message: 'No budgets configured.' }

  return {
    total,
    byCategory,
    byArticle,
    byWallet,
    largest,
    monthly,
    average,
    savingsRate: Math.round(savingsRate * 100) / 100,
    budgetComparison,
  }
}

/** Compute wallets section analytics. */
async function walletsSection(ctx: AnalyticsContext) {
  const { userId, start, end } = ctx

  const wallets = await db.wallet.findMany({
    where: { userId },
    orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
  })

  const enriched = await Promise.all(
    wallets.map(async (w) => ({
      wallet: w,
      balance: await getWalletBalance(w.id),
    }))
  )

  const currentByWallet = enriched.map((e) => ({
    walletId: e.wallet.id,
    name: e.wallet.name,
    type: e.wallet.type,
    color: e.wallet.color,
    active: e.wallet.active,
    balance: e.balance,
  }))

  // Bank vs cash summary (matches /api/wallets behavior — include all wallets,
  // active or not — the wallet's balance still exists even if archived).
  const bankVsCash = {
    bank: enriched
      .filter((e) => e.wallet.type === 'bank')
      .reduce((acc, e) => addMoney(acc, e.balance), '0.00'),
    cash: enriched
      .filter((e) => e.wallet.type === 'cash')
      .reduce((acc, e) => addMoney(acc, e.balance), '0.00'),
    savings: enriched
      .filter((e) => e.wallet.type === 'savings')
      .reduce((acc, e) => addMoney(acc, e.balance), '0.00'),
    other: enriched
      .filter((e) => e.wallet.type === 'other')
      .reduce((acc, e) => addMoney(acc, e.balance), '0.00'),
  }

  // Historical evolution: total balance at each month-end for the last 12 months.
  const today = new Date()
  const evolution: { date: string; total: string }[] = []
  for (let i = 11; i >= 0; i--) {
    const monthEnd = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i + 1, 0, 23, 59, 59, 999)
    )
    if (monthEnd > today) {
      // Future month-end; use today's date instead.
      // (Only happens for the current month bucket — we want balance "as of now".)
    }
    const asOf = monthEnd > today ? today : monthEnd
    let total = 0
    for (const w of wallets) {
      const bal = await getWalletBalanceAt(w.id, asOf)
      total += toCents(bal)
    }
    evolution.push({
      date: monthEnd.toISOString().slice(0, 10),
      total: fromCents(total),
    })
  }

  // Ledger inflows/outflows/transfers/withdrawals/adjustments in period.
  // IMPORTANT: exclude transfer_in/transfer_out and withdrawal_internal from
  // the "inflows"/"outflows" totals so internal movements don't double-count.
  const ledger = await db.walletLedgerEntry.findMany({
    where: {
      walletId: { in: wallets.map((w) => w.id) },
      financialDate: { gte: start, lte: end },
    },
    select: { amount: true, operationType: true, direction: true, walletId: true },
  })

  const inflowsByWallet = new Map<string, number>()
  const outflowsByWallet = new Map<string, number>()
  const inflowOpTypes = new Set(['income'])
  const outflowOpTypes = new Set(['expense', 'withdrawal_external'])

  let transfersCount = 0
  let withdrawalsExternalCount = 0
  let withdrawalsInternalCount = 0
  let adjustmentsCount = 0
  let transfersTotal = 0
  let withdrawalsExternalTotal = 0
  let withdrawalsInternalTotal = 0
  let adjustmentsTotal = 0

  for (const e of ledger) {
    const cents = toCents(e.amount)
    if (e.operationType === 'transfer_in' || e.operationType === 'transfer_out') {
      transfersCount++
      transfersTotal += Math.abs(cents)
    } else if (e.operationType === 'withdrawal_internal') {
      withdrawalsInternalCount++
      withdrawalsInternalTotal += Math.abs(cents)
    } else if (e.operationType === 'withdrawal_external') {
      withdrawalsExternalCount++
      withdrawalsExternalTotal += Math.abs(cents)
    } else if (e.operationType === 'adjustment') {
      adjustmentsCount++
      adjustmentsTotal += Math.abs(cents)
    } else if (inflowOpTypes.has(e.operationType)) {
      inflowsByWallet.set(
        e.walletId,
        (inflowsByWallet.get(e.walletId) ?? 0) + Math.max(0, cents)
      )
    } else if (outflowOpTypes.has(e.operationType)) {
      outflowsByWallet.set(
        e.walletId,
        (outflowsByWallet.get(e.walletId) ?? 0) + Math.max(0, -cents)
      )
    }
  }

  const inflows = wallets.map((w) => ({
    walletId: w.id,
    name: w.name,
    amount: fromCents(inflowsByWallet.get(w.id) ?? 0),
  }))
  const outflows = wallets.map((w) => ({
    walletId: w.id,
    name: w.name,
    amount: fromCents(outflowsByWallet.get(w.id) ?? 0),
  }))

  return {
    currentByWallet,
    bankVsCash,
    historicalEvolution: evolution,
    inflows,
    outflows,
    transfers: {
      count: transfersCount,
      total: fromCents(Math.round(transfersTotal / 2)), // two ledger entries per transfer
    },
    withdrawals: {
      external: {
        count: withdrawalsExternalCount,
        total: fromCents(withdrawalsExternalTotal),
      },
      internal: {
        count: withdrawalsInternalCount,
        total: fromCents(Math.round(withdrawalsInternalTotal / 2)), // two entries per internal withdrawal
      },
    },
    adjustments: {
      count: adjustmentsCount,
      total: fromCents(adjustmentsTotal),
    },
  }
}

/** Compute cash withdrawals section analytics. */
async function cashWithdrawalsSection(ctx: AnalyticsContext) {
  const { userId, start, end } = ctx
  const dateRange = { gte: start, lte: end }

  const [withdrawals, wallets] = await Promise.all([
    db.cashWithdrawal.findMany({
      where: { userId, financialDate: dateRange },
      include: { sourceWallet: true },
    }),
    db.wallet.findMany({
      where: { userId },
      select: { id: true, name: true, color: true },
    }),
  ])

  const total = withdrawals.reduce(
    (acc, w) => addMoney(acc, w.amount),
    '0.00'
  )

  const byWalletMap = new Map<
    string,
    { walletId: string; name: string; color: string; amount: number }
  >()
  for (const w of withdrawals) {
    const wlt = wallets.find((x) => x.id === w.sourceWalletId)
    if (!wlt) continue
    const e = byWalletMap.get(wlt.id) ?? {
      walletId: wlt.id,
      name: wlt.name,
      color: wlt.color,
      amount: 0,
    }
    e.amount += toCents(w.amount)
    byWalletMap.set(wlt.id, e)
  }
  const byWallet = Array.from(byWalletMap.values())
    .map((e) => ({ ...e, amount: fromCents(e.amount) }))
    .sort((a, b) => toCents(b.amount) - toCents(a.amount))

  return {
    total,
    byWallet,
    count: withdrawals.length,
  }
}

/** Compute transfers section analytics. */
async function transfersSection(ctx: AnalyticsContext) {
  const { userId, start, end } = ctx
  const dateRange = { gte: start, lte: end }

  const [transfers, wallets] = await Promise.all([
    db.walletTransfer.findMany({
      where: { userId, financialDate: dateRange },
      include: { sourceWallet: true, destWallet: true },
    }),
    db.wallet.findMany({
      where: { userId },
      select: { id: true, name: true, color: true },
    }),
  ])

  const total = transfers.reduce((acc, t) => addMoney(acc, t.amount), '0.00')

  const bySourceMap = new Map<
    string,
    { walletId: string; name: string; color: string; amount: number; count: number }
  >()
  const byDestMap = new Map<
    string,
    { walletId: string; name: string; color: string; amount: number; count: number }
  >()

  for (const t of transfers) {
    const src = wallets.find((w) => w.id === t.sourceWalletId)
    if (src) {
      const e = bySourceMap.get(src.id) ?? {
        walletId: src.id,
        name: src.name,
        color: src.color,
        amount: 0,
        count: 0,
      }
      e.amount += toCents(t.amount)
      e.count += 1
      bySourceMap.set(src.id, e)
    }
    const dst = wallets.find((w) => w.id === t.destWalletId)
    if (dst) {
      const e = byDestMap.get(dst.id) ?? {
        walletId: dst.id,
        name: dst.name,
        color: dst.color,
        amount: 0,
        count: 0,
      }
      e.amount += toCents(t.amount)
      e.count += 1
      byDestMap.set(dst.id, e)
    }
  }

  const bySource = Array.from(bySourceMap.values())
    .map((e) => ({ ...e, amount: fromCents(e.amount) }))
    .sort((a, b) => toCents(b.amount) - toCents(a.amount))
  const byDest = Array.from(byDestMap.values())
    .map((e) => ({ ...e, amount: fromCents(e.amount) }))
    .sort((a, b) => toCents(b.amount) - toCents(a.amount))

  return {
    total,
    count: transfers.length,
    bySource,
    byDest,
  }
}

/** Compute net cash flow section analytics. */
async function netCashFlowSection(ctx: AnalyticsContext) {
  const { userId, start, end } = ctx
  const dateRange = { gte: start, lte: end }

  const [incomeRows, expenseRows] = await Promise.all([
    db.incomeTransaction.findMany({
      where: { userId, financialDate: dateRange },
      select: { amount: true, financialDate: true },
    }),
    db.expenseTransaction.findMany({
      where: { userId, financialDate: dateRange },
      select: { amount: true, financialDate: true },
    }),
  ])

  const income = incomeRows.reduce((acc, r) => addMoney(acc, r.amount), '0.00')
  const expenses = expenseRows.reduce((acc, r) => addMoney(acc, r.amount), '0.00')
  const net = subMoney(income, expenses)
  const savingsRate = pct(net, income)

  // Monthly buckets for 12 months ending at end-of-period.
  const endMonth = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1, 0, 0, 0, 0)
  )
  const monthly: { month: string; income: string; expenses: string; net: string }[] =
    []
  for (let i = 11; i >= 0; i--) {
    const bStart = new Date(
      Date.UTC(endMonth.getUTCFullYear(), endMonth.getUTCMonth() - i, 1, 0, 0, 0, 0)
    )
    const bEnd = new Date(
      Date.UTC(bStart.getUTCFullYear(), bStart.getUTCMonth() + 1, 0, 23, 59, 59, 999)
    )
    const incCents = incomeRows
      .filter((r) => {
        const d =
          r.financialDate instanceof Date ? r.financialDate : new Date(r.financialDate)
        return d >= bStart && d <= bEnd
      })
      .reduce((s, r) => s + toCents(r.amount), 0)
    const expCents = expenseRows
      .filter((r) => {
        const d =
          r.financialDate instanceof Date ? r.financialDate : new Date(r.financialDate)
        return d >= bStart && d <= bEnd
      })
      .reduce((s, r) => s + toCents(r.amount), 0)
    monthly.push({
      month: ymKey(bStart),
      income: fromCents(incCents),
      expenses: fromCents(expCents),
      net: fromCents(incCents - expCents),
    })
  }

  return {
    income,
    expenses,
    net,
    monthly,
    savingsRate: Math.round(savingsRate * 100) / 100,
  }
}

/** Compute allocations section analytics. */
async function allocationsSection(ctx: AnalyticsContext) {
  const { userId } = ctx

  const [allocations, settings] = await Promise.all([
    db.allocation.findMany({
      where: { userId },
      include: { bankCredit: true, category: true },
    }),
    db.appSettings.upsert({
      where: { id: 'singleton' },
      update: {},
      create: { id: 'singleton' },
    }),
  ])

  let totalActive = 0
  let totalPassive = 0
  const byClassificationMap = new Map<
    string,
    { classification: string; count: number; amount: number }
  >()

  for (const a of allocations) {
    const cents = toCents(a.amount)
    if (a.allocType === 'active') totalActive += cents
    else totalPassive += cents
    const e = byClassificationMap.get(a.classification) ?? {
      classification: a.classification,
      count: 0,
      amount: 0,
    }
    e.count += 1
    e.amount += cents
    byClassificationMap.set(a.classification, e)
  }

  const referenceIncome = settings.referenceMonthlyIncome
  const totalAllocated = totalActive + totalPassive
  const unallocated = Math.max(0, toCents(referenceIncome) - totalActive)
  const utilization = pct(fromCents(totalActive), referenceIncome)
  const available = unallocated

  const byClassification = Array.from(byClassificationMap.values())
    .map((e) => ({ ...e, amount: fromCents(e.amount) }))
    .sort((a, b) => toCents(b.amount) - toCents(a.amount))

  return {
    referenceIncome,
    totalActive: fromCents(totalActive),
    totalPassive: fromCents(totalPassive),
    totalAllocated: fromCents(totalAllocated),
    unallocated: fromCents(unallocated),
    utilization: Math.round(utilization * 100) / 100,
    available: fromCents(available),
    byClassification,
  }
}

/** Compute bank credits section analytics. */
async function bankCreditsSection(ctx: AnalyticsContext) {
  const { userId } = ctx
  const credits = await db.bankCredit.findMany({
    where: { userId },
    include: { repayments: { select: { amount: true } } },
  })

  let originalDebtCents = 0
  let totalRepaidCents = 0
  for (const c of credits) {
    originalDebtCents += toCents(c.originalPrincipal)
    totalRepaidCents += c.repayments.reduce(
      (sum, r) => sum + toCents(r.amount),
      0
    )
  }
  const outstanding = Math.max(0, originalDebtCents - totalRepaidCents)
  const progressPct = pct(fromCents(totalRepaidCents), fromCents(originalDebtCents))

  // Upcoming installments (next 10 pending, dueDate >= today).
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const upcomingInstallments = await db.creditInstallment.findMany({
    where: {
      bankCredit: { userId },
      status: 'pending',
      dueDate: { gte: today },
    },
    include: { bankCredit: true },
    orderBy: { dueDate: 'asc' },
    take: 10,
  })

  const summary = await Promise.all(
    credits.map(async (c) => ({
      id: c.id,
      creditName: c.creditName,
      lender: c.lender,
      ...(await computeCreditSummary(c)),
    }))
  )

  return {
    originalDebt: fromCents(originalDebtCents),
    totalRepaid: fromCents(totalRepaidCents),
    outstanding: fromCents(outstanding),
    progressPct: Math.round(progressPct * 100) / 100,
    upcomingInstallments: upcomingInstallments.map((ins) => ({
      creditId: ins.bankCreditId,
      creditName: ins.bankCredit?.creditName ?? '',
      installmentNumber: ins.installmentNumber,
      dueDate: ins.dueDate,
      amount: ins.amount,
      status: ins.status,
    })),
    byCredit: summary,
  }
}

/** Compute personal loans section analytics. */
async function personalLoansSection(ctx: AnalyticsContext) {
  const { userId } = ctx
  const loans = await db.personalLoan.findMany({
    where: { userId },
    include: {
      operations: { select: { operationType: true, amount: true } },
    },
  })

  let totalLentCents = 0
  let totalRepaidCents = 0

  const byBorrower = await Promise.all(
    loans.map(async (l) => {
      const summary = await computeLoanSummary(l)
      totalLentCents += toCents(summary.totalLent)
      totalRepaidCents += toCents(summary.totalRepaid)
      return {
        loanId: l.id,
        borrowerName: l.borrowerName,
        lent: summary.totalLent,
        repaid: summary.totalRepaid,
        outstanding: summary.outstanding,
        progressPct: summary.progressPct,
      }
    })
  )

  const totalOutstanding = Math.max(0, totalLentCents - totalRepaidCents)
  const overallProgress = pct(
    fromCents(totalRepaidCents),
    fromCents(totalLentCents)
  )

  return {
    totalLent: fromCents(totalLentCents),
    totalRepaid: fromCents(totalRepaidCents),
    outstanding: fromCents(totalOutstanding),
    progressPct: Math.round(overallProgress * 100) / 100,
    progressByBorrower: byBorrower.sort(
      (a, b) => toCents(b.outstanding) - toCents(a.outstanding)
    ),
  }
}

/** Compute goals section analytics. */
async function goalsSection(ctx: AnalyticsContext) {
  const { userId } = ctx

  const [goals, goalCats] = await Promise.all([
    db.goal.findMany({
      where: { userId },
      include: {
        goalCategory: { select: { id: true, name: true, color: true } },
      },
    }),
    db.goalCategory.findMany({
      where: { userId },
      select: { id: true, name: true, color: true },
    }),
  ])

  // progressByYear
  const byYearMap = new Map<
    number,
    { year: number; count: number; completed: number; progressSum: number }
  >()
  for (const g of goals) {
    const e = byYearMap.get(g.year) ?? {
      year: g.year,
      count: 0,
      completed: 0,
      progressSum: 0,
    }
    e.count += 1
    if (g.status === 'completed') e.completed += 1
    e.progressSum += g.progress
    byYearMap.set(g.year, e)
  }
  const progressByYear = Array.from(byYearMap.values())
    .map((e) => ({
      year: e.year,
      count: e.count,
      completed: e.completed,
      overallProgress:
        e.count > 0
          ? Math.round((e.progressSum / e.count) * 100) / 100
          : 0,
    }))
    .sort((a, b) => b.year - a.year)

  const totalGoals = goals.length
  const completedGoals = goals.filter((g) => g.status === 'completed').length
  const completionRate = totalGoals > 0 ? (completedGoals / totalGoals) * 100 : 0

  // budgetProgress: aggregate required vs saved across all goals.
  let requiredCents = 0
  let savedCents = 0
  for (const g of goals) {
    requiredCents += toCents(g.requiredBudget ?? '0')
    savedCents += toCents(g.savedBudget ?? '0')
  }
  const budgetProgress = {
    required: fromCents(requiredCents),
    saved: fromCents(savedCents),
    remaining: fromCents(Math.max(0, requiredCents - savedCents)),
  }

  // categoryComparison: aggregate per category.
  const byCatMap = new Map<
    string,
    { categoryName: string; color: string; count: number; progressSum: number }
  >()
  for (const g of goals) {
    const catId = g.goalCategoryId ?? 'uncategorized'
    const catName = g.goalCategory?.name ?? 'Uncategorized'
    const catColor = g.goalCategory?.color ?? '#64748b'
    const e = byCatMap.get(catId) ?? {
      categoryName: catName,
      color: catColor,
      count: 0,
      progressSum: 0,
    }
    e.count += 1
    e.progressSum += g.progress
    e.categoryName = catName
    e.color = catColor
    byCatMap.set(catId, e)
  }
  const categoryComparison = Array.from(byCatMap.values())
    .map((e) => ({
      categoryName: e.categoryName,
      color: e.color,
      count: e.count,
      avgProgress:
        e.count > 0 ? Math.round((e.progressSum / e.count) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.count - a.count)

  void goalCats

  return {
    progressByYear,
    completionRate: Math.round(completionRate * 100) / 100,
    totalGoals,
    completedGoals,
    budgetProgress,
    categoryComparison,
  }
}

const SECTION_BUILDERS: Record<
  Section,
  (ctx: AnalyticsContext) => Promise<unknown>
> = {
  income: incomeSection,
  expenses: expenseSection,
  wallets: walletsSection,
  cash_withdrawals: cashWithdrawalsSection,
  transfers: transfersSection,
  net_cash_flow: netCashFlowSection,
  allocations: allocationsSection,
  bank_credits: bankCreditsSection,
  personal_loans: personalLoansSection,
  goals: goalsSection,
}

/** GET /api/analytics — multi-section analytics. */
export async function GET(req: Request) {
  return withAuth(async ({ userId }) => {
    const url = new URL(req.url)
    const filter = url.searchParams.get('filter') || 'this_month'
    const from = url.searchParams.get('from') || undefined
    const to = url.searchParams.get('to') || undefined
    const { start, end } = resolvePeriod(filter, from, to)

    const sectionParam = url.searchParams.get('section')
    let sections: Section[]
    if (sectionParam) {
      const requested = sectionParam
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s): s is Section => (ALL_SECTIONS as string[]).includes(s))
      sections = requested.length > 0 ? requested : ALL_SECTIONS
    } else {
      sections = ALL_SECTIONS
    }

    const ctx: AnalyticsContext = { userId, start, end }

    const result: Record<string, unknown> = {
      period: { filter, start, end },
    }
    for (const section of sections) {
      result[section] = await SECTION_BUILDERS[section](ctx)
    }

    return ok(serialize(result))
  })(req)
}
