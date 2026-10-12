import { db } from '@/lib/db'
import { withAuth, ok, serialize } from '@/lib/api'
import { resolvePeriod, ymKey, ymdKey } from '@/lib/date-filter'
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

/** GET /api/dashboard — consolidated dashboard data. */
export async function GET(req: Request) {
  return withAuth(async ({ userId }) => {
    const url = new URL(req.url)
    const filter = url.searchParams.get('filter') || 'this_month'
    const from = url.searchParams.get('from') || undefined
    const to = url.searchParams.get('to') || undefined
    const { start, end } = resolvePeriod(filter, from, to)

    // ------------------------------------------------------------------
    // Wallets
    // ------------------------------------------------------------------
    const wallets = await db.wallet.findMany({
      where: { userId },
      orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
    })
    const activeWallets = wallets.filter((w) => w.active)

    const walletBalances = await Promise.all(
      wallets.map(async (w) => ({
        wallet: w,
        balance: await getWalletBalance(w.id),
      }))
    )

    const totalWalletBalance = walletBalances.reduce(
      (acc, w) => addMoney(acc, w.balance),
      '0.00'
    )

    // Subtotals per type (matches /api/wallets behavior: include all wallets,
    // active or not — the wallet's balance still exists even if archived).
    const subtotalByType = (type: string) =>
      walletBalances
        .filter((w) => w.wallet.type === type)
        .reduce((acc, w) => addMoney(acc, w.balance), '0.00')

    const bankBalance = subtotalByType('bank')
    const cashBalance = subtotalByType('cash')
    const savingsBalance = subtotalByType('savings')

    // ------------------------------------------------------------------
    // Income & expenses in period (using canonical transaction tables —
    // transfers/withdrawals are NOT income/expense rows by design, so
    // they are automatically excluded from these totals).
    // ------------------------------------------------------------------
    const dateRange = { gte: start, lte: end }

    const [incomeRows, expenseRows] = await Promise.all([
      db.incomeTransaction.findMany({
        where: { userId, financialDate: dateRange },
        include: { category: true, wallet: true },
      }),
      db.expenseTransaction.findMany({
        where: { userId, financialDate: dateRange },
        include: { category: true, wallet: true },
      }),
    ])

    const incomeTotal = incomeRows.reduce(
      (acc, r) => addMoney(acc, r.amount),
      '0.00'
    )
    const expenseTotal = expenseRows.reduce(
      (acc, r) => addMoney(acc, r.amount),
      '0.00'
    )
    const netCashFlow = subMoney(incomeTotal, expenseTotal)
    const savingsRate = pct(netCashFlow, incomeTotal)

    // ------------------------------------------------------------------
    // Outstanding debts (bank credits) and outstanding lent (personal loans)
    // ------------------------------------------------------------------
    const [bankCredits, personalLoans] = await Promise.all([
      db.bankCredit.findMany({
        where: { userId },
        include: { repayments: { select: { amount: true } } },
      }),
      db.personalLoan.findMany({
        where: { userId },
        include: {
          operations: { select: { operationType: true, amount: true } },
        },
      }),
    ])

    let outstandingBankDebtCents = 0
    for (const c of bankCredits) {
      const repaid = c.repayments.reduce(
        (sum, r) => sum + toCents(r.amount),
        0
      )
      const principal = toCents(c.originalPrincipal)
      outstandingBankDebtCents += Math.max(0, principal - repaid)
    }

    let outstandingLentCents = 0
    for (const l of personalLoans) {
      const summary = await computeLoanSummary(l)
      outstandingLentCents += toCents(summary.outstanding)
    }

    // ------------------------------------------------------------------
    // Goals (current year)
    // ------------------------------------------------------------------
    const currentYear = new Date().getUTCFullYear()
    const currentYearGoals = await db.goal.findMany({
      where: { userId, year: currentYear },
      select: { id: true, title: true, progress: true, status: true, year: true },
    })
    const goalsProgress =
      currentYearGoals.length > 0
        ? Math.round(
            (currentYearGoals.reduce((s, g) => s + g.progress, 0) /
              currentYearGoals.length) *
              100
          ) / 100
        : 0

    // ------------------------------------------------------------------
    // Charts
    // ------------------------------------------------------------------
    // 12 months ending at end-of-period month (inclusive).
    const endMonth = new Date(
      Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1, 0, 0, 0, 0)
    )
    const monthlyBuckets: { month: string; income: string; expenses: string }[] =
      []
    for (let i = 11; i >= 0; i--) {
      const bucketStart = new Date(
        Date.UTC(
          endMonth.getUTCFullYear(),
          endMonth.getUTCMonth() - i,
          1,
          0,
          0,
          0,
          0
        )
      )
      const bucketEnd = new Date(
        Date.UTC(
          bucketStart.getUTCFullYear(),
          bucketStart.getUTCMonth() + 1,
          0,
          23,
          59,
          59,
          999
        )
      )
      const incCents = incomeRows
        .filter((r) => {
          const d = r.financialDate instanceof Date ? r.financialDate : new Date(r.financialDate)
          return d >= bucketStart && d <= bucketEnd
        })
        .reduce((s, r) => s + toCents(r.amount), 0)
      const expCents = expenseRows
        .filter((r) => {
          const d = r.financialDate instanceof Date ? r.financialDate : new Date(r.financialDate)
          return d >= bucketStart && d <= bucketEnd
        })
        .reduce((s, r) => s + toCents(r.amount), 0)
      monthlyBuckets.push({
        month: ymKey(bucketStart),
        income: fromCents(incCents),
        expenses: fromCents(expCents),
      })
    }

    // Trend by day within the period.
    const dayBuckets: string[] = []
    const cursor = new Date(
      Date.UTC(
        start.getUTCFullYear(),
        start.getUTCMonth(),
        start.getUTCDate(),
        0,
        0,
        0,
        0
      )
    )
    // Cap to 400 buckets to avoid pathological expansion on 'all_time' over many years.
    for (let i = 0; i < 400; i++) {
      dayBuckets.push(ymdKey(cursor))
      cursor.setUTCDate(cursor.getUTCDate() + 1)
      if (cursor > end) break
    }

    const incomeTrend: { date: string; value: string }[] = []
    const expenseTrend: { date: string; value: string }[] = []
    const netCashFlowTrend: { date: string; value: string }[] = []
    let cumulative = 0
    for (const bucket of dayBuckets) {
      const incCents = incomeRows
        .filter(
          (r) =>
            ymdKey(
              r.financialDate instanceof Date
                ? r.financialDate
                : new Date(r.financialDate)
            ) === bucket
        )
        .reduce((s, r) => s + toCents(r.amount), 0)
      const expCents = expenseRows
        .filter(
          (r) =>
            ymdKey(
              r.financialDate instanceof Date
                ? r.financialDate
                : new Date(r.financialDate)
            ) === bucket
        )
        .reduce((s, r) => s + toCents(r.amount), 0)
      incomeTrend.push({ date: bucket, value: fromCents(incCents) })
      expenseTrend.push({ date: bucket, value: fromCents(expCents) })
      cumulative += incCents - expCents
      netCashFlowTrend.push({ date: bucket, value: fromCents(cumulative) })
    }

    // Expense by category (active, non-archived).
    const expenseCats = await db.category.findMany({
      where: { userId, type: 'expense' },
      select: { id: true, name: true, color: true, archived: true },
    })
    const expenseByCategoryMap = new Map<
      string,
      { categoryId: string; name: string; color: string; amount: number }
    >()
    for (const r of expenseRows) {
      if (!r.categoryId) continue
      const cat = expenseCats.find((c) => c.id === r.categoryId)
      if (!cat || cat.archived) continue
      const entry = expenseByCategoryMap.get(cat.id) ?? {
        categoryId: cat.id,
        name: cat.name,
        color: cat.color,
        amount: 0,
      }
      entry.amount += toCents(r.amount)
      expenseByCategoryMap.set(cat.id, entry)
    }
    const expenseByCategory = Array.from(expenseByCategoryMap.values())
      .map((e) => ({ ...e, amount: fromCents(e.amount) }))
      .sort((a, b) => toCents(b.amount) - toCents(a.amount))

    // Income by category.
    const incomeCats = await db.category.findMany({
      where: { userId, type: 'income' },
      select: { id: true, name: true, color: true, archived: true },
    })
    const incomeByCategoryMap = new Map<
      string,
      { categoryId: string; name: string; color: string; amount: number }
    >()
    for (const r of incomeRows) {
      if (!r.categoryId) continue
      const cat = incomeCats.find((c) => c.id === r.categoryId)
      if (!cat || cat.archived) continue
      const entry = incomeByCategoryMap.get(cat.id) ?? {
        categoryId: cat.id,
        name: cat.name,
        color: cat.color,
        amount: 0,
      }
      entry.amount += toCents(r.amount)
      incomeByCategoryMap.set(cat.id, entry)
    }
    const incomeByCategory = Array.from(incomeByCategoryMap.values())
      .map((e) => ({ ...e, amount: fromCents(e.amount) }))
      .sort((a, b) => toCents(b.amount) - toCents(a.amount))

    // Wallet distribution (active wallets only).
    const walletDistribution = walletBalances
      .filter((w) => w.wallet.active)
      .map((w) => ({
        walletId: w.wallet.id,
        name: w.wallet.name,
        color: w.wallet.color,
        balance: w.balance,
      }))
      .sort((a, b) => toCents(b.balance) - toCents(a.balance))

    // Goals completion (current year).
    const goalsCompletionMap = new Map<string, number>()
    for (const g of currentYearGoals) {
      goalsCompletionMap.set(g.status, (goalsCompletionMap.get(g.status) ?? 0) + 1)
    }
    const goalsCompletion = Array.from(goalsCompletionMap.entries()).map(
      ([status, count]) => ({ status, count })
    )

    // ------------------------------------------------------------------
    // Widgets
    // ------------------------------------------------------------------
    // Recent transactions (combined income + expense, last 8).
    const recentTransactions = [
      ...incomeRows.map((r) => ({
        id: r.id,
        name: r.name,
        amount: r.amount,
        type: 'income' as const,
        date: r.financialDate,
        categoryName: r.category?.name ?? null,
        categoryColor: r.category?.color ?? null,
        walletName: r.wallet?.name ?? null,
        createdAt: r.createdAt,
      })),
      ...expenseRows.map((r) => ({
        id: r.id,
        name: r.name,
        amount: r.amount,
        type: 'expense' as const,
        date: r.financialDate,
        categoryName: r.category?.name ?? null,
        categoryColor: r.category?.color ?? null,
        walletName: r.wallet?.name ?? null,
        createdAt: r.createdAt,
      })),
    ]
      .sort((a, b) => {
        const da = a.date instanceof Date ? a.date : new Date(a.date)
        const db = b.date instanceof Date ? b.date : new Date(b.date)
        if (db.getTime() !== da.getTime()) return db.getTime() - da.getTime()
        const ca = a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt)
        const cb = b.createdAt instanceof Date ? b.createdAt : new Date(b.createdAt)
        return cb.getTime() - ca.getTime()
      })
      .slice(0, 8)
      .map(({ createdAt: _ct, ...rest }) => rest)

    // Top expense categories (top 5 in period).
    const topExpenseCategories = expenseByCategory.slice(0, 5)

    // Recent transfers (last 5 — any date).
    const recentTransferRows = await db.walletTransfer.findMany({
      where: { userId },
      include: { sourceWallet: true, destWallet: true },
      orderBy: [{ financialDate: 'desc' }, { createdAt: 'desc' }],
      take: 5,
    })
    const recentTransfers = recentTransferRows.map((t) => ({
      id: t.id,
      sourceName: t.sourceWallet?.name ?? '',
      destName: t.destWallet?.name ?? '',
      amount: t.amount,
      date: t.financialDate,
      comment: t.comment,
    }))

    // Upcoming installments (next 5 due, pending, dueDate >= today).
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    const upcomingInstallmentRows = await db.creditInstallment.findMany({
      where: {
        bankCredit: { userId },
        status: 'pending',
        dueDate: { gte: today },
      },
      include: { bankCredit: true },
      orderBy: { dueDate: 'asc' },
      take: 5,
    })
    const upcomingInstallments = upcomingInstallmentRows.map((ins) => ({
      creditId: ins.bankCreditId,
      creditName: ins.bankCredit?.creditName ?? '',
      installmentNumber: ins.installmentNumber,
      dueDate: ins.dueDate,
      amount: ins.amount,
      status: ins.status,
    }))

    // Budget usage (optional — empty array if no budgets configured).
    // We don't track explicit wallet budgets in the schema; expose as empty
    // so the dashboard widget degrades gracefully.
    const budgetUsage: {
      walletId: string
      walletName: string
      used: string
      limit: string
    }[] = []

    // Alerts.
    const alerts: { level: 'warning' | 'error' | 'info'; message: string }[] =
      []

    // Low balance warning (active wallets below 100 MAD).
    for (const w of activeWallets) {
      const bal =
        walletBalances.find((b) => b.wallet.id === w.id)?.balance ?? '0.00'
      if (toCents(bal) < 0) {
        alerts.push({
          level: 'error',
          message: `Wallet "${w.name}" has a negative balance (${bal}).`,
        })
      } else if (toCents(bal) < 10000) {
        // < 100 MAD (10000 cents)
        alerts.push({
          level: 'warning',
          message: `Wallet "${w.name}" is running low (${bal}).`,
        })
      }
    }

    // Overdue installments.
    const overdueInstallments = await db.creditInstallment.findMany({
      where: {
        bankCredit: { userId },
        status: 'pending',
        dueDate: { lt: today },
      },
      include: { bankCredit: true },
      take: 50,
    })
    if (overdueInstallments.length > 0) {
      alerts.push({
        level: 'error',
        message: `${overdueInstallments.length} overdue bank credit installment(s) need attention.`,
      })
    }

    // Overdue personal loan repayments.
    const overdueLoans = personalLoans.filter((l) => {
      const expected = l.expectedRepayDate
        ? l.expectedRepayDate instanceof Date
          ? l.expectedRepayDate
          : new Date(l.expectedRepayDate)
        : null
      if (!expected) return false
      return expected < today
    })
    for (const l of overdueLoans) {
      const summary = await computeLoanSummary(l)
      if (toCents(summary.outstanding) > 0) {
        const expectedDate = l.expectedRepayDate
          ? l.expectedRepayDate instanceof Date
            ? l.expectedRepayDate.toISOString().slice(0, 10)
            : String(l.expectedRepayDate).slice(0, 10)
          : 'N/A'
        alerts.push({
          level: 'error',
          message: `Loan to "${l.borrowerName}" has an overdue repayment (expected ${expectedDate}).`,
        })
      }
    }

    // Goals near completion (progress >= 75 and < 100, current year).
    const goalsNearCompletion = currentYearGoals
      .filter((g) => g.progress >= 75 && g.progress < 100)
      .map((g) => ({
        id: g.id,
        title: g.title,
        progress: g.progress,
        year: g.year,
      }))

    // Current wallet balances (active wallets only).
    const currentWalletBalances = walletBalances
      .filter((w) => w.wallet.active)
      .map((w) => ({
        walletId: w.wallet.id,
        name: w.wallet.name,
        type: w.wallet.type,
        color: w.wallet.color,
        balance: w.balance,
      }))

    // silence unused imports — these are used by analytics, but kept here for
    // potential extension; the void operator marks them intentionally unused.
    void getWalletBalanceAt
    void computeCreditSummary

    const result = {
      period: { filter, start, end },
      cards: {
        totalWalletBalance,
        income: incomeTotal,
        expenses: expenseTotal,
        netCashFlow,
        bankBalance,
        cashBalance,
        savingsBalance,
        outstandingBankDebt: fromCents(outstandingBankDebtCents),
        outstandingLent: fromCents(outstandingLentCents),
        savingsRate: Math.round(savingsRate * 100) / 100,
        goalsProgress,
      },
      charts: {
        monthlyIncomeVsExpenses: monthlyBuckets,
        incomeTrend,
        expenseTrend,
        expenseByCategory,
        incomeByCategory,
        walletDistribution,
        netCashFlowTrend,
        goalsCompletion,
      },
      widgets: {
        recentTransactions,
        topExpenseCategories,
        recentTransfers,
        upcomingInstallments,
        budgetUsage,
        alerts,
        goalsNearCompletion,
        currentWalletBalances,
      },
    }

    return ok(serialize(result))
  })(req)
}
