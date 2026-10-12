'use client'

import { useEffect, useState } from 'react'
import { useAppStore, type ViewKey } from '@/lib/store'
import { useI18n } from '@/lib/use-i18n'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  LayoutDashboard,
  TrendingUp,
  TrendingDown,
  Wallet as WalletIcon,
  FileText,
  Tags,
  Scale,
  CreditCard,
  HandCoins,
  Target,
  BarChart3,
  Settings,
  Menu,
  Search,
  Bell,
  Moon,
  Sun,
  LogOut,
  Languages,
  UserRound,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { toast } from 'sonner'
import { DashboardView } from '@/components/views/dashboard-view'
import { IncomeView } from '@/components/views/income-view'
import { ExpensesView } from '@/components/views/expenses-view'
import { WalletsView } from '@/components/views/wallets-view'
import { ArticlesView } from '@/components/views/articles-view'
import { CategoriesView } from '@/components/views/categories-view'
import { AllocationsView } from '@/components/views/allocations-view'
import { BankCreditsView } from '@/components/views/bank-credits-view'
import { PersonalLoansView } from '@/components/views/personal-loans-view'
import { GoalsView } from '@/components/views/goals-view'
import { AnalyticsView } from '@/components/views/analytics-view'
import { SettingsView } from '@/components/views/settings-view'

interface NavItem {
  key: ViewKey
  labelKey: string
  icon: typeof LayoutDashboard
}

const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { key: 'income', labelKey: 'nav.income', icon: TrendingUp },
  { key: 'expenses', labelKey: 'nav.expenses', icon: TrendingDown },
  { key: 'wallets', labelKey: 'nav.wallets', icon: WalletIcon },
  { key: 'articles', labelKey: 'nav.articles', icon: FileText },
  { key: 'categories', labelKey: 'nav.categories', icon: Tags },
  { key: 'allocations', labelKey: 'nav.allocations', icon: Scale },
  { key: 'bankCredits', labelKey: 'nav.bankCredits', icon: CreditCard },
  { key: 'personalLoans', labelKey: 'nav.personalLoans', icon: HandCoins },
  { key: 'goals', labelKey: 'nav.goals', icon: Target },
  { key: 'analytics', labelKey: 'nav.analytics', icon: BarChart3 },
  { key: 'settings', labelKey: 'nav.settings', icon: Settings },
]

export function AppShell() {
  const { t, locale } = useI18n()
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen)
  const searchOpen = useAppStore((s) => s.searchOpen)
  const setSearchOpen = useAppStore((s) => s.setSearchOpen)
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)
  const setLocale = useAppStore((s) => s.setLocale)
  const appName = useAppStore((s) => s.appName)
  const appNameFr = useAppStore((s) => s.appNameFr)

  // Reflect theme & locale in <html> + persist to user record.
  useEffect(() => {
    document.title = (locale === 'fr' ? appNameFr : appName)
    document.documentElement.lang = locale
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme, locale, appName, appNameFr])

  // Cmd/Ctrl+K opens search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setSearchOpen])

  async function persistLocale(l: 'en' | 'fr') {
    setLocale(l)
    await fetch('/api/auth/me', { method: 'GET' }).catch(() => {})
    // Persist language to the user record via a dedicated endpoint
    await fetch('/api/auth/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: l }),
      credentials: 'same-origin',
    }).catch(() => {})
  }

  async function persistTheme(t: 'light' | 'dark') {
    setTheme(t)
    await fetch('/api/auth/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: t }),
      credentials: 'same-origin',
    }).catch(() => {})
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {})
    toast.success(t('auth.logout'))
    setTimeout(() => window.location.reload(), 400)
  }

  const sidebarContent = (
    <nav className="flex h-full flex-col gap-1 p-3">
      <div className="flex items-center gap-2 px-2 py-3 mb-2">
        <div className="rounded-md bg-sidebar-primary p-1.5">
          <WalletIcon className="h-4 w-4 text-sidebar-primary-foreground" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate text-sidebar-foreground">{locale === 'fr' ? appNameFr : appName}</p>
          <p className="text-[10px] text-sidebar-foreground/60 truncate">{t('app.tagline')}</p>
        </div>
      </div>
      <ScrollArea className="flex-1 -mx-1 px-1">
        <div className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            const active = view === item.key
            return (
              <button
                key={item.key}
                onClick={() => setView(item.key)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                    : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{t(item.labelKey)}</span>
              </button>
            )
          })}
        </div>
      </ScrollArea>
    </nav>
  )

  return (
    <div className="min-h-screen flex bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        {sidebarContent}
      </aside>

      {/* Mobile sidebar */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-72 bg-sidebar p-0">
          {sidebarContent}
        </SheetContent>
      </Sheet>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 backdrop-blur px-4 sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <h1 className="text-base font-semibold truncate">{t(`nav.${viewLabelKey(view)}`)}</h1>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => setSearchOpen(true)} aria-label="Search">
              <Search className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => persistTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Language">
                  <Languages className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{t('settings.defaultLanguage')}</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => persistLocale('en')}>{t('settings.languageEn')}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => persistLocale('fr')}>{t('settings.languageFr')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
              <Bell className="h-4 w-4" />
              <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-expense" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Profile">
                  <UserRound className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setView('settings')}>{t('nav.settings')}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout} className="text-expense">
                  <LogOut className="h-4 w-4 mr-2" />
                  {t('auth.logout')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 px-4 sm:px-6 py-6 max-w-[1600px] w-full mx-auto">
          <ViewRouter />
        </main>

        <footer className="border-t px-4 sm:px-6 py-3 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} {locale === 'fr' ? appNameFr : appName} · MAD · Africa/Casablanca
        </footer>
      </div>

      <CommandDialog open={searchOpen} onOpenChange={setSearchOpen}>
        <CommandInput placeholder={t('common.search')} />
        <CommandList>
          <CommandEmpty>{t('common.empty')}</CommandEmpty>
          <CommandGroup heading={t('nav.dashboard')}>
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              return (
                <CommandItem
                  key={item.key}
                  onSelect={() => {
                    setView(item.key)
                    setSearchOpen(false)
                  }}
                >
                  <Icon className="h-4 w-4 mr-2" />
                  {t(item.labelKey)}
                </CommandItem>
              )
            })}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </div>
  )
}

function viewLabelKey(v: ViewKey): string {
  // Map view keys to nav label keys. They mostly match but some differ.
  switch (v) {
    case 'bankCredits': return 'bankCredits'
    case 'personalLoans': return 'personalLoans'
    default: return v
  }
}

function ViewRouter() {
  const view = useAppStore((s) => s.view)
  switch (view) {
    case 'dashboard': return <DashboardView />
    case 'income': return <IncomeView />
    case 'expenses': return <ExpensesView />
    case 'wallets': return <WalletsView />
    case 'articles': return <ArticlesView />
    case 'categories': return <CategoriesView />
    case 'allocations': return <AllocationsView />
    case 'bankCredits': return <BankCreditsView />
    case 'personalLoans': return <PersonalLoansView />
    case 'goals': return <GoalsView />
    case 'analytics': return <AnalyticsView />
    case 'settings': return <SettingsView />
    default: return <DashboardView />
  }
}
