import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, ok, fail, zodError, serialize } from '@/lib/api'
import { appendLedgerEntry, assertDebitAllowed, getWalletBalance } from '@/lib/ledger'
import { audit } from '@/lib/audit'
import { parseLocalDate, isPositiveMoney, toCents, fromCents } from '@/lib/money'

const UpdateExpenseSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(120).optional(),
  categoryId: z.string().min(1).nullable().optional(),
  articleId: z.string().min(1).nullable().optional(),
  amount: z
    .string()
    .refine((v) => v !== '' && !isNaN(Number(v)), 'Invalid amount')
    .optional(),
  walletId: z.string().min(1).optional(),
  financialDate: z.string().min(1).optional(),
  comment: z.string().max(280).nullable().optional(),
})

type Params = { params: Promise<{ id: string }> }

/** GET /api/expenses/[id] — return one expense with relations. */
export async function GET(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const expense = await db.expenseTransaction.findFirst({
      where: { id, userId },
      include: { category: true, article: true, wallet: true },
    })
    if (!expense) {
      return fail('Expense transaction not found.', 404)
    }
    return ok(serialize(expense))
  })(req)
}

/** PUT /api/expenses/[id] — update expense with ledger reconciliation. */
export async function PUT(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const existing = await db.expenseTransaction.findFirst({
      where: { id, userId },
      include: { wallet: true },
    })
    if (!existing) {
      return fail('Expense transaction not found.', 404)
    }

    const parsed = UpdateExpenseSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return fail(zodError(parsed.error), 400)
    }
    const data = parsed.data

    if (data.amount !== undefined && !isPositiveMoney(data.amount)) {
      return fail('Amount must be greater than zero.', 400)
    }

    let result: { expense: any; walletId: string } | null = null
    try {
      result = await db.$transaction(async (tx) => {
        const oldAmount = existing.amount
        const oldWalletId = existing.walletId

        const newAmount = data.amount ?? oldAmount
        const newWalletId = data.walletId ?? oldWalletId
        const newFinancialDate = data.financialDate
          ? parseLocalDate(data.financialDate)
          : existing.financialDate

        // Resolve category.
        let categoryId =
          data.categoryId === undefined ? existing.categoryId : data.categoryId
        if (data.articleId !== undefined) {
          const newArticleId = data.articleId
          if (newArticleId) {
            const article = await tx.article.findFirst({
              where: { id: newArticleId, userId },
            })
            if (!article) throw new Error('Article not found.')
            if (!categoryId && article.defaultCategoryId) {
              categoryId = article.defaultCategoryId
            }
          }
        }
        if (categoryId) {
          const cat = await tx.category.findFirst({ where: { id: categoryId, userId } })
          if (!cat) throw new Error('Category not found.')
          if (cat.type !== 'expense') {
            throw new Error('Category must be of type expense.')
          }
        }

        // Validate target wallet.
        const targetWallet = await tx.wallet.findFirst({
          where: { id: newWalletId, userId },
        })
        if (!targetWallet) throw new Error('Wallet not found.')
        if (!targetWallet.active) throw new Error('Wallet is not active.')

        const walletChanged = newWalletId !== oldWalletId
        const amountChanged = toCents(newAmount) !== toCents(oldAmount)

        if (walletChanged) {
          // Reverse the FULL old debit on the old wallet (credit) ...
          await appendLedgerEntry(tx, {
            walletId: oldWalletId,
            userId,
            amount: fromCents(toCents(oldAmount)), // positive
            operationType: 'adjustment',
            direction: 'credit',
            referenceType: 'expense',
            referenceId: id,
            financialDate: newFinancialDate,
            comment: `Reversal for expense edit (${existing.name})`,
          })
          // ... and apply the FULL new amount as a debit on the new wallet.
          // Pre-check the new wallet has enough funds.
          await assertDebitAllowed(tx, newWalletId, newAmount)
          await appendLedgerEntry(tx, {
            walletId: newWalletId,
            userId,
            amount: fromCents(-toCents(newAmount)), // negative
            operationType: 'expense',
            direction: 'debit',
            referenceType: 'expense',
            referenceId: id,
            financialDate: newFinancialDate,
            comment: data.comment ?? existing.comment ?? undefined,
          })
        } else if (amountChanged) {
          // Same wallet: append a single signed adjustment for the difference.
          // expense reduces balance: original was -old; new is -new; delta = -(new - old) = old - new.
          const diffCents = toCents(oldAmount) - toCents(newAmount) // credit if new<old, debit if new>old
          const diffStr = fromCents(diffCents)
          // Verify funds if the change is an increase in expense (further debit).
          if (diffCents < 0) {
            await assertDebitAllowed(tx, oldWalletId, fromCents(-diffCents))
          }
          await appendLedgerEntry(tx, {
            walletId: oldWalletId,
            userId,
            amount: diffStr,
            operationType: 'adjustment',
            direction: diffCents >= 0 ? 'credit' : 'debit',
            referenceType: 'expense',
            referenceId: id,
            financialDate: newFinancialDate,
            comment: `Expense adjustment (${existing.name})`,
          })
        }

        const updated = await tx.expenseTransaction.update({
          where: { id },
          data: {
            name: data.name ?? undefined,
            categoryId:
              categoryId === undefined ? undefined : categoryId ?? null,
            articleId:
              data.articleId === undefined ? undefined : (data.articleId ?? null),
            amount: newAmount,
            walletId: newWalletId,
            financialDate: newFinancialDate,
            comment:
              data.comment === undefined ? undefined : (data.comment ?? null),
          },
          include: { category: true, article: true, wallet: true },
        })

        return { expense: updated, walletId: newWalletId }
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to update expense.'
      return fail(message, 400)
    }

    await audit({
      userId,
      entityType: 'ExpenseTransaction',
      entityId: id,
      operation: 'update',
      previousValues: serialize(existing),
      newValues: serialize(result.expense),
      reason: `Expense updated: ${result.expense.name}`,
    })

    // Compute the wallet balance AFTER the transaction commits so the read
    // reflects the just-applied ledger entry.
    const walletBalance = await getWalletBalance(result.walletId)

    return ok(serialize({ expense: result.expense, walletBalance }))
  })(req)
}

/** DELETE /api/expenses/[id] — reverse the debit then hard-delete the expense row. */
export async function DELETE(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const existing = await db.expenseTransaction.findFirst({
      where: { id, userId },
    })
    if (!existing) {
      return fail('Expense transaction not found.', 404)
    }

    let walletBalance = '0.00'
    try {
      // Transaction only does writes; the wallet balance is recomputed AFTER
      // commit so the read reflects the just-applied reversal ledger entry.
      await db.$transaction(async (tx) => {
        // Reverse the original debit with a credit of the same magnitude.
        await appendLedgerEntry(tx, {
          walletId: existing.walletId,
          userId,
          amount: fromCents(toCents(existing.amount)), // positive
          operationType: 'adjustment',
          direction: 'credit',
          referenceType: 'expense',
          referenceId: id,
          financialDate: existing.financialDate,
          comment: `Reversal on expense deletion (${existing.name})`,
        })

        await tx.expenseTransaction.delete({ where: { id } })
      })
      walletBalance = await getWalletBalance(existing.walletId)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to delete expense.'
      return fail(message, 400)
    }

    await audit({
      userId,
      entityType: 'ExpenseTransaction',
      entityId: id,
      operation: 'delete',
      previousValues: serialize(existing),
      reason: `Expense deleted: ${existing.name}`,
    })

    return ok(serialize({ ok: true, walletBalance }))
  })(req)
}
