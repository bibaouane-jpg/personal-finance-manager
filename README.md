# Personal Finance Manager

A production-ready, bilingual (English / French) personal finance management web application built with Next.js 16, TypeScript, Tailwind CSS, and Prisma. Self-hostable on Coolify / any Docker-capable VPS.

## Features

### Modules (12)
1. **Dashboard** — period-filtered KPIs, income vs expenses bar chart, category donuts, wallet distribution, net cash flow trend, recent transactions, upcoming installments, alerts.
2. **Income** — full CRUD, article-based auto-fill, wallet crediting, CSV export, filters, pagination.
3. **Expenses** — full CRUD, overdraft protection, wallet debiting, CSV export.
4. **Wallets & Banks** — bank/cash/savings wallets, atomic transfers, cash withdrawals (external + tracked), manual adjustments with audit trail, full ledger history.
5. **Articles** — reusable income/expense templates with default amounts and categories.
6. **Categories** — income/expense categories with colors, archive (no destructive delete when referenced).
7. **Assets & Liabilities** — Excel-inspired unit allocation visualization, credit-linked progress, planning-only (does not debit wallets).
8. **Bank Credits** — installment schedule auto-generation, repayment tracking, progress-based card colors.
9. **Personal Loans** — money lent to others, disbursement/repayment/correction operations, outstanding tracking.
10. **Goals** — yearly goals with priorities, budgets, categories, progress, CSV export.
11. **Analytics** — 10 sections (income, expenses, wallets, withdrawals, transfers, net cash flow, allocations, credits, loans, goals).
12. **Settings** — customizable app name (EN/FR), language, currency, timezone, theme, financial defaults, password change, data exports.

### Financial Integrity
- **Exact decimal arithmetic** — all monetary values stored as strings, computed via integer cents (no floating-point drift).
- **Authoritative ledger** — wallet balances derived from `initialBalance + Σ(ledger entries)`, never independently mutated.
- **Atomic transfers** — source debit + destination credit in a single database transaction.
- **Reversal on edit/delete** — editing a transaction applies only the difference; deleting reverses the original effect exactly once.
- **Idempotency** — transfer idempotency keys prevent duplicate mutations on retry.
- **Internal transfers excluded** — transfers and internal withdrawals never counted as income or expenses in consolidated analytics.

### Security
- PBKDF2 password hashing (100k iterations, SHA-512, 32-byte key).
- Signed session tokens (HMAC-SHA256) stored in HTTP-only cookies.
- First-run admin setup (no public registration, no default password).
- Server-side authorization on every API route via `withAuth` wrapper.
- Input validation with Zod on every mutation.

### Internationalization
- Complete English + French translations (300+ keys).
- Language switch in header + Settings, persisted to the user record.
- Locale-aware date, number, and currency formatting (`Intl.NumberFormat`, `Intl.DateTimeFormat`).
- MAD (Moroccan Dirham) default currency, Africa/Casablanca default timezone.

### Branding
- Customizable application name (EN + FR) in Settings.
- Name updates sidebar, header, browser title, and login page live without redeployment.

## Technology Stack
- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript 5
- **Styling**: Tailwind CSS 4 + shadcn/ui (New York) + Lucide icons
- **Database**: Prisma ORM (SQLite for dev; PostgreSQL for production)
- **State**: Zustand (client), TanStack Query (server)
- **Validation**: Zod
- **Forms**: React Hook Form
- **Charts**: Custom lightweight SVG components (recharts removed due to React 19 rendering bug)

## Project Structure

```
├── prisma/
│   └── schema.prisma          # 19 models: User, Session, AppSettings, Wallet,
│                               # WalletLedgerEntry, WalletTransfer, CashWithdrawal,
│                               # WalletAdjustment, Category, Article,
│                               # IncomeTransaction, ExpenseTransaction,
│                               # Allocation, BankCredit, CreditInstallment,
│                               # CreditRepayment, PersonalLoan,
│                               # PersonalLoanOperation, GoalCategory, Goal, AuditLog
├── src/
│   ├── app/
│   │   ├── api/                # 40+ API route handlers
│   │   │   ├── auth/           # status, setup, login, logout, me, password, preferences
│   │   │   ├── settings/        # GET/PUT settings, branding-restore
│   │   │   ├── wallets/        # CRUD, history, export
│   │   │   ├── transfers/      # atomic transfers
│   │   │   ├── withdrawals/    # cash withdrawals
│   │   │   ├── adjustments/    # manual balance adjustments
│   │   │   ├── income/         # CRUD + export
│   │   │   ├── expenses/       # CRUD + export
│   │   │   ├── categories/     # CRUD
│   │   │   ├── articles/       # CRUD
│   │   │   ├── allocations/    # CRUD + summary
│   │   │   ├── bank-credits/   # CRUD + repayments
│   │   │   ├── personal-loans/ # CRUD + operations
│   │   │   ├── goals/          # CRUD + export
│   │   │   ├── goal-categories/# CRUD
│   │   │   ├── dashboard/      # aggregated dashboard data
│   │   │   └── analytics/      # 10-section analytics
│   │   ├── layout.tsx          # root layout with providers
│   │   ├── page.tsx            # SPA entry (boot → auth → app shell)
│   │   └── globals.css         # fintech theme (navy sidebar, semantic colors)
│   ├── components/
│   │   ├── ui/                 # shadcn/ui components
│   │   ├── views/              # 12 view components
│   │   ├── mini-charts.tsx     # custom SVG charts (bar, donut, hbar, area)
│   │   ├── app-shell.tsx       # sidebar + header + view router
│   │   ├── auth/auth-screen.tsx
│   │   ├── boot.tsx            # auth bootstrap
│   │   ├── providers.tsx       # theme + query providers
│   │   ├── shared.tsx          # StatCard, EmptyState, MoneyText, PageHeader
│   │   └── confirm-dialog.tsx
│   └── lib/
│       ├── db.ts               # Prisma client
│       ├── auth.ts             # sessions, password hashing
│       ├── money.ts            # exact decimal arithmetic + formatting
│       ├── ledger.ts           # wallet balance computation + debit checks
│       ├── i18n.ts             # EN/FR dictionaries
│       ├── store.ts            # Zustand (view nav, locale, theme)
│       ├── api.ts              # withAuth wrapper, serialization
│       ├── audit.ts            # audit log helper
│       ├── date-filter.ts      # period resolution (today/week/month/year/all/custom)
│       ├── use-i18n.ts         # client i18n hook
│       └── use-api.ts          # fetch wrapper with toast
└── .env                        # DATABASE_URL, SESSION_SECRET
```

## Development

```bash
# Install dependencies
bun install

# Push database schema
bun run db:push

# Start dev server (port 3000)
bun run dev

# Lint
bun run lint
```

### First Run
1. Open `http://localhost:3000`.
2. The setup screen appears (no users exist).
3. Create the admin account (email + password ≥ 10 chars).
4. You're signed in and can start managing finances.

## Deployment on Coolify (Ubuntu VPS)

### 1. Database (PostgreSQL)
Provision a PostgreSQL database in Coolify (or use an existing one). Note the connection string:
```
DATABASE_URL=postgresql://user:password@host:5432/finance
```

### 2. Swap Prisma provider
In `prisma/schema.prisma`, change:
```prisma
datasource db {
  provider = "postgresql"   # was "sqlite"
  url      = env("DATABASE_URL")
}
```
Then run `bun run db:push` (or `prisma migrate deploy` for production).

### 3. Environment variables
In Coolify, set:
```
DATABASE_URL=postgresql://user:password@host:5432/finance
SESSION_SECRET=<generate a 32+ char random string>
APP_URL=https://finance.yourdomain.com
NODE_ENV=production
```
Generate a session secret:
```bash
openssl rand -hex 32
```

### 4. Build & deploy
Coolify will:
- Run `bun install` / `npm install`
- Run `bun run build` (Next.js standalone build)
- Start the server on the configured port
- Configure HTTPS via your domain

### 5. First-run setup
After deployment, visit your domain. The first-run setup screen appears. Create the admin account. The app is ready.

## Backup & Restore

### PostgreSQL backup
```bash
# Backup
pg_dump "$DATABASE_URL" > finance_backup_$(date +%Y%m%d).sql

# Restore
psql "$DATABASE_URL" < finance_backup_YYYYMMDD.sql
```

### CSV exports
Available in each module (income, expenses, wallets, goals) and in Settings → Data Management. Exports respect active filters and are protected against formula injection.

### Dev database (SQLite)
The dev database is at `db/custom.db`. To back up:
```bash
cp db/custom.db db/custom_backup_$(date +%Y%m%d).db
```

## Limitations & Notes

1. **SQLite in development, PostgreSQL in production**: The Prisma schema uses SQLite for the dev environment. For production, switch the provider to `postgresql` (see deployment section). The schema is fully compatible — all monetary values use `String` for exact decimal storage, which works identically on both databases.

2. **Charts**: Custom lightweight SVG chart components are used instead of Recharts, due to a rendering incompatibility between Recharts 3.x and React 19 (Bar/Pie components create layer containers but never render the actual SVG shapes). The custom charts are fully functional and render reliably.

3. **Currency**: MAD (Moroccan Dirham) is the default and only supported currency. Multi-currency conversion is not implemented — all amounts are stored in MAD.

4. **Tests**: Automated tests are not included in this delivery. The financial integrity scenarios (Tests A–U from the spec) have been verified manually via browser testing:
   - Create income → balance increases ✓
   - Edit income → only the difference is applied ✓
   - Delete income → balance reverses ✓
   - Create/edit/delete expense → balances correct ✓
   - Atomic transfer → source decreases, destination increases, combined unchanged ✓
   - Wallet adjustments → recorded with reason ✓

5. **Authentication**: Uses PBKDF2 password hashing and signed session tokens. For production with Argon2id, install the `argon2` package and swap the `hashPassword`/`verifyPassword` functions in `src/lib/auth.ts`.

6. **Docker**: A Dockerfile is not included in this delivery. For Coolify deployment, use Next.js's standalone build output (`bun run build` produces `.next/standalone/`).

## License
Private — for personal use.
