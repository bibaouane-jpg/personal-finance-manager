'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Settings as SettingsIcon,
  Sun,
  Moon,
  Save,
  RotateCcw,
  KeyRound,
  Database,
  Download,
  LogOut,
  Mail,
  User as UserIcon,
  ExternalLink,
  PiggyBank,
  Wallet as WalletIcon,
  Target,
  Banknote,
  ShieldCheck,
  HardDrive,
  Archive,
  Globe,
  Palette,
  Languages,
  FileText,
  CloudUpload,
  CloudDownload,
  Lock,
} from 'lucide-react'

import { useI18n } from '@/lib/use-i18n'
import { useApi } from '@/lib/use-api'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PageHeader } from '@/components/shared'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Language = 'en' | 'fr'
type Theme = 'light' | 'dark'

interface AppSettings {
  id: string
  appName: string
  appNameFr: string
  defaultCurrency: string
  defaultTimezone: string
  referenceMonthlyIncome: string
  allocationUnitValue: string
  allowOverdraft: boolean
  updatedAt: string
}

interface CurrentUser {
  id: string
  email: string
  name: string
  language: Language
  theme: Theme
}

interface MeResponse {
  user: CurrentUser
  settings: AppSettings
}

interface PreferencesBody {
  language?: Language
  theme?: Theme
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIMEZONES = [
  'Africa/Casablanca',
  'Africa/Tunis',
  'Africa/Algiers',
  'Africa/Dakar',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'Africa/Nairobi',
  'Europe/Paris',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Brussels',
  'Europe/Berlin',
  'Europe/Rome',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'America/Toronto',
  'Asia/Dubai',
  'Asia/Qatar',
  'Asia/Riyadh',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'UTC',
]

const SECTION_TABS = [
  { value: 'general', labelKey: 'settings.general', Icon: SettingsIcon },
  { value: 'appearance', labelKey: 'settings.appearance', Icon: Palette },
  { value: 'financial', labelKey: 'settings.financial', Icon: PiggyBank },
  { value: 'security', labelKey: 'settings.security', Icon: ShieldCheck },
  { value: 'data', labelKey: 'settings.dataManagement', Icon: Database },
] as const

type SectionValue = (typeof SECTION_TABS)[number]['value']

// ---------------------------------------------------------------------------
// Field label helper (two-column responsive grid)
// ---------------------------------------------------------------------------

function FieldRow({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] sm:items-center sm:gap-4">
      <div className="space-y-0.5">
        <Label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="w-full">{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section card wrapper
// ---------------------------------------------------------------------------

function SectionCard({
  title,
  description,
  icon: Icon,
  children,
  footer,
}: {
  title: string
  description?: string
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-muted p-2 text-muted-foreground">
            <Icon className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <CardTitle className="text-base">{title}</CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">{children}</CardContent>
      {footer && (
        <>
          <Separator />
          <CardFooter className="flex flex-col gap-2 py-4 sm:flex-row sm:justify-end">
            {footer}
          </CardFooter>
        </>
      )}
    </Card>
  )
}

// ===========================================================================
// Main component
// ===========================================================================

export function SettingsView() {
  const { t, locale } = useI18n()
  const api = useApi()
  const qc = useQueryClient()

  const setLocale = useAppStore((s) => s.setLocale)
  const setTheme = useAppStore((s) => s.setTheme)
  const setBranding = useAppStore((s) => s.setBranding)
  const storeTheme = useAppStore((s) => s.theme)

  // ---- Active tab ----
  const [tab, setTab] = useState<SectionValue>('general')

  // ---- Queries ----
  const meQuery = useQuery<MeResponse>({
    queryKey: ['me'],
    queryFn: () => api.get<MeResponse>('/api/auth/me'),
  })

  const settingsQuery = useQuery<AppSettings>({
    queryKey: ['settings'],
    queryFn: () => api.get<AppSettings>('/api/settings'),
  })

  const settings = settingsQuery.data
  const user = meQuery.data?.user
  const loading = settingsQuery.isLoading || meQuery.isLoading

  // ---- General section form state ----
  const [appName, setAppName] = useState('')
  const [appNameFr, setAppNameFr] = useState('')
  const [defaultLanguage, setDefaultLanguage] = useState<Language>('en')
  const [currency, setCurrency] = useState('MAD')
  const [timezone, setTimezone] = useState('Africa/Casablanca')

  // ---- Financial section form state ----
  const [refIncome, setRefIncome] = useState('')
  const [allocUnit, setAllocUnit] = useState('')
  const [allowOverdraft, setAllowOverdraft] = useState(false)

  // ---- Security section form state ----
  const [currentPwd, setCurrentPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')

  // ---- Submitting flags (independent per-section save buttons) ----
  const [savingGeneral, setSavingGeneral] = useState(false)
  const [savingFinancial, setSavingFinancial] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [restoringBranding, setRestoringBranding] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  // ---- Initialise form state when settings/user load ----
  useEffect(() => {
    if (settings) {
      setAppName(settings.appName ?? '')
      setAppNameFr(settings.appNameFr ?? '')
      setCurrency(settings.defaultCurrency ?? 'MAD')
      setTimezone(settings.defaultTimezone ?? 'Africa/Casablanca')
      setRefIncome(settings.referenceMonthlyIncome ?? '')
      setAllocUnit(settings.allocationUnitValue ?? '')
      setAllowOverdraft(Boolean(settings.allowOverdraft))
    }
  }, [settings])

  useEffect(() => {
    if (user?.language) setDefaultLanguage(user.language)
  }, [user?.language])

  // ---- Sync document.title with current branding ----
  useEffect(() => {
    const name = locale === 'fr' ? appNameFr || appName : appName || appNameFr
    if (name) document.title = name
  }, [appName, appNameFr, locale])

  // ---- Mutations ----
  const updateSettingsMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put<AppSettings>('/api/settings', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] })
      qc.invalidateQueries({ queryKey: ['me'] })
    },
  })

  const updatePreferencesMutation = useMutation({
    mutationFn: (body: PreferencesBody) => api.put<{ user: CurrentUser }>('/api/auth/preferences', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] })
    },
  })

  const restoreBrandingMutation = useMutation({
    mutationFn: () => api.patch<AppSettings>('/api/settings/branding-restore'),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['settings'] })
      qc.invalidateQueries({ queryKey: ['me'] })
      setBranding(data.appName, data.appNameFr)
      toast.success(t('settings.brandingRestored'))
    },
  })

  // ---- Handlers ----
  const handleSaveGeneral = async () => {
    const trimmedName = appName.trim().slice(0, 60)
    const trimmedNameFr = appNameFr.trim().slice(0, 80)
    if (!trimmedName) {
      toast.error(`${t('common.required')}: ${t('settings.appName')}`)
      return
    }
    if (!currency.trim()) {
      toast.error(`${t('common.required')}: ${t('settings.currency')}`)
      return
    }
    if (!timezone.trim()) {
      toast.error(`${t('common.required')}: ${t('settings.timezone')}`)
      return
    }

    const body: Record<string, unknown> = {
      appName: trimmedName,
      appNameFr: trimmedNameFr,
      defaultCurrency: currency.trim().toUpperCase().slice(0, 8),
      defaultTimezone: timezone,
    }

    setSavingGeneral(true)
    try {
      const updated = await updateSettingsMutation.mutateAsync(body)
      // Update branding in the store (sidebar/header react live).
      setBranding(updated.appName, updated.appNameFr)
      // Persist language preference on the user record + sync store locale.
      await updatePreferencesMutation.mutateAsync({ language: defaultLanguage }).catch(() => null)
      setLocale(defaultLanguage)
      // Re-sync document.title with the freshly-saved name.
      const titleName =
        defaultLanguage === 'fr' ? updated.appNameFr || updated.appName : updated.appName || updated.appNameFr
      document.title = titleName
      toast.success(t('settings.saved'))
    } catch {
      // useApi already toasted the error message.
    } finally {
      setSavingGeneral(false)
    }
  }

  const handleRestoreBranding = async () => {
    setRestoringBranding(true)
    try {
      await restoreBrandingMutation.mutateAsync()
    } catch {
      // error already toasted.
    } finally {
      setRestoringBranding(false)
    }
  }

  const handleToggleTheme = async (next: Theme) => {
    if (next === storeTheme) return
    setTheme(next)
    try {
      await updatePreferencesMutation.mutateAsync({ theme: next })
    } catch {
      // Persist failure is non-fatal — UI has already switched optimistically.
    }
  }

  const handleSaveFinancial = async () => {
    const incomeNum = Number(refIncome)
    const unitNum = Number(allocUnit)
    if (!Number.isFinite(incomeNum) || incomeNum < 0) {
      toast.error(`${t('common.required')}: ${t('settings.referenceMonthlyIncome')}`)
      return
    }
    if (!Number.isFinite(unitNum) || unitNum <= 0) {
      toast.error(`${t('common.required')}: ${t('settings.allocationUnitValue')}`)
      return
    }
    const body: Record<string, unknown> = {
      referenceMonthlyIncome: incomeNum.toFixed(2),
      allocationUnitValue: unitNum.toFixed(2),
      allowOverdraft,
    }
    setSavingFinancial(true)
    try {
      await updateSettingsMutation.mutateAsync(body)
      toast.success(t('settings.saved'))
    } catch {
      // error already toasted.
    } finally {
      setSavingFinancial(false)
    }
  }

  const handleChangePassword = async () => {
    if (!currentPwd) {
      toast.error(`${t('common.required')}: ${t('auth.currentPassword')}`)
      return
    }
    if (newPwd.length < 10) {
      toast.error(t('auth.passwordTooShort'))
      return
    }
    if (newPwd !== confirmPwd) {
      toast.error(t('auth.passwordMismatch'))
      return
    }
    setSavingPassword(true)
    try {
      // Use throwOnError:false so we can render a localized message for the
      // 400 "wrong current password" case instead of the server's English one.
      const res = await api.put<{ ok?: boolean; error?: string }>(
        '/api/auth/password',
        { currentPassword: currentPwd, newPassword: newPwd },
        { throwOnError: false }
      )
      if (res && res.error) {
        // 400 from /api/auth/password — current password mismatch.
        toast.error(t('settings.wrongPassword'))
        return
      }
      toast.success(t('settings.passwordChanged'))
      setCurrentPwd('')
      setNewPwd('')
      setConfirmPwd('')
    } catch {
      // network error already toasted by useApi.
    } finally {
      setSavingPassword(false)
    }
  }

  const handleSignOut = async () => {
    setSigningOut(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => null)
      toast.success(t('auth.logout'))
      // Hard reload so the boot flow re-evaluates authentication.
      setTimeout(() => window.location.reload(), 400)
    } finally {
      setSigningOut(false)
    }
  }

  const handleExport = (module: 'income' | 'expenses' | 'wallets' | 'goals') => {
    // The export endpoints stream a CSV file with Content-Disposition: attachment.
    // Navigating to the URL lets the browser download it directly.
    window.location.href = `/api/${module}/export`
  }

  // ---- Derived ----
  const pwdMatch = newPwd.length > 0 && newPwd === confirmPwd
  const pwdStrength = useMemo(() => {
    if (!newPwd) return { pct: 0, label: '' }
    let score = 0
    if (newPwd.length >= 10) score += 25
    if (newPwd.length >= 14) score += 15
    if (/[A-Z]/.test(newPwd) && /[a-z]/.test(newPwd)) score += 20
    if (/\d/.test(newPwd)) score += 20
    if (/[^A-Za-z0-9]/.test(newPwd)) score += 20
    score = Math.min(100, score)
    const label =
      score < 40
        ? locale === 'fr'
          ? 'Faible'
          : 'Weak'
        : score < 70
          ? locale === 'fr'
            ? 'Moyen'
            : 'Fair'
          : locale === 'fr'
            ? 'Fort'
            : 'Strong'
    return { pct: score, label }
  }, [newPwd, locale])

  // ---- Render helpers ----
  const exports = [
    {
      key: 'income' as const,
      label: t('income.title'),
      Icon: Banknote,
      desc: locale === 'fr' ? 'Transactions de revenus' : 'Income transactions',
    },
    {
      key: 'expenses' as const,
      label: t('expense.title'),
      Icon: WalletIcon,
      desc: locale === 'fr' ? 'Transactions de dépenses' : 'Expense transactions',
    },
    {
      key: 'wallets' as const,
      label: t('wallet.title'),
      Icon: WalletIcon,
      desc: locale === 'fr' ? 'Portefeuilles et soldes' : 'Wallets and balances',
    },
    {
      key: 'goals' as const,
      label: t('goal.title'),
      Icon: Target,
      desc: locale === 'fr' ? 'Objectifs annuels' : 'Annual goals',
    },
  ]

  // -------------------------------------------------------------------------
  // Loading skeleton
  // -------------------------------------------------------------------------
  if (loading && !settings) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('settings.title')} />
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="space-y-6">
      <PageHeader
        title={t('settings.title')}
        description={
          locale === 'fr'
            ? 'Configurez l’application, l’apparence, les paramètres financiers, la sécurité et la gestion des données.'
            : 'Configure the application, appearance, financial parameters, security and data management.'
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as SectionValue)}>
        <ScrollArea className="w-full whitespace-nowrap">
          <TabsList className="inline-flex h-auto w-max">
            {SECTION_TABS.map(({ value, labelKey, Icon }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm"
              >
                <Icon className="h-4 w-4" />
                <span className="whitespace-nowrap">{t(labelKey)}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </ScrollArea>

        {/* --------------------------------------------------------------- */}
        {/* 1. General                                                     */}
        {/* --------------------------------------------------------------- */}
        <TabsContent value="general" className="space-y-6">
          <SectionCard
            title={t('settings.general')}
            icon={SettingsIcon}
            description={
              locale === 'fr'
                ? 'Nom de l’application, langue par défaut, devise et fuseau horaire.'
                : 'Application name, default language, currency and timezone.'
            }
            footer={
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRestoreBranding}
                  disabled={restoringBranding || savingGeneral}
                >
                  <RotateCcw className="h-4 w-4" />
                  {t('common.setDefault')}
                </Button>
                <Button
                  type="button"
                  onClick={handleSaveGeneral}
                  disabled={savingGeneral || restoringBranding}
                >
                  <Save className="h-4 w-4" />
                  {savingGeneral ? t('common.loading') : t('common.save')}
                </Button>
              </div>
            }
          >
            <FieldRow
              label={t('settings.appName')}
              htmlFor="settings-app-name"
              hint={locale === 'fr' ? 'Affiché dans l’en-tête et la barre latérale.' : 'Shown in the header and sidebar.'}
            >
              <Input
                id="settings-app-name"
                value={appName}
                onChange={(e) => setAppName(e.target.value.slice(0, 60))}
                maxLength={60}
                placeholder="Personal Finance Manager"
              />
              <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                {appName.length}/60
              </p>
            </FieldRow>

            <FieldRow
              label={t('settings.appNameFr')}
              htmlFor="settings-app-name-fr"
              hint={locale === 'fr' ? 'Utilisé quand la langue est le français.' : 'Used when the locale is French.'}
            >
              <Input
                id="settings-app-name-fr"
                value={appNameFr}
                onChange={(e) => setAppNameFr(e.target.value.slice(0, 80))}
                maxLength={80}
                placeholder="Gestionnaire de Finances Personnelles"
              />
              <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                {appNameFr.length}/80
              </p>
            </FieldRow>

            <Separator />

            <FieldRow
              label={t('settings.defaultLanguage')}
              htmlFor="settings-language"
              hint={locale === 'fr' ? 'Langue de l’interface pour cet utilisateur.' : 'Interface language for this user.'}
            >
              <Select value={defaultLanguage} onValueChange={(v) => setDefaultLanguage(v as Language)}>
                <SelectTrigger id="settings-language" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">
                    <span className="flex items-center gap-2">
                      <Languages className="h-4 w-4 text-muted-foreground" />
                      {t('settings.languageEn')}
                    </span>
                  </SelectItem>
                  <SelectItem value="fr">
                    <span className="flex items-center gap-2">
                      <Languages className="h-4 w-4 text-muted-foreground" />
                      {t('settings.languageFr')}
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </FieldRow>

            <FieldRow
              label={t('settings.currency')}
              htmlFor="settings-currency"
              hint={locale === 'fr' ? 'Code ISO 4217 (ex. MAD, EUR, USD).' : 'ISO 4217 code (e.g. MAD, EUR, USD).'}
            >
              <Input
                id="settings-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 8))}
                placeholder="MAD"
              />
            </FieldRow>

            <FieldRow
              label={t('settings.timezone')}
              htmlFor="settings-timezone"
              hint={locale === 'fr' ? 'Fuseau IANA pour les dates et heures.' : 'IANA timezone for dates and times.'}
            >
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger id="settings-timezone" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <ScrollArea className="h-72">
                    {TIMEZONES.map((tz) => (
                      <SelectItem key={tz} value={tz}>
                        {tz}
                      </SelectItem>
                    ))}
                  </ScrollArea>
                </SelectContent>
              </Select>
            </FieldRow>

            <div className="flex items-start gap-2 rounded-md border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
              <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {locale === 'fr'
                  ? "L'enregistrement met à jour le nom dans la barre latérale, l'en-tête et la page de connexion, et modifie également la langue de votre interface."
                  : 'Saving updates the name in the sidebar, header and login page, and also switches your interface language.'}
              </span>
            </div>
          </SectionCard>
        </TabsContent>

        {/* --------------------------------------------------------------- */}
        {/* 2. Appearance                                                   */}
        {/* --------------------------------------------------------------- */}
        <TabsContent value="appearance" className="space-y-6">
          <SectionCard
            title={t('settings.appearance')}
            icon={Palette}
            description={
              locale === 'fr'
                ? 'Choisissez un thème clair ou sombre. La barre latérale s’adapte automatiquement.'
                : 'Choose a light or dark theme. The sidebar adapts automatically.'
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => handleToggleTheme('light')}
                aria-pressed={storeTheme === 'light'}
                className={cn(
                  'group flex flex-col items-start gap-3 rounded-lg border-2 p-4 text-left transition-colors',
                  storeTheme === 'light'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-foreground/30'
                )}
              >
                <div className="flex w-full items-center justify-between">
                  <div className="rounded-md bg-yellow-100 p-2 text-yellow-700">
                    <Sun className="h-5 w-5" />
                  </div>
                  {storeTheme === 'light' && (
                    <Badge variant="default" className="text-[10px] uppercase">
                      {t('common.active')}
                    </Badge>
                  )}
                </div>
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">{t('settings.themeLight')}</p>
                  <p className="text-xs text-muted-foreground">
                    {locale === 'fr' ? 'Interface claire sur fond blanc.' : 'Light interface on a white background.'}
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleToggleTheme('dark')}
                aria-pressed={storeTheme === 'dark'}
                className={cn(
                  'group flex flex-col items-start gap-3 rounded-lg border-2 p-4 text-left transition-colors',
                  storeTheme === 'dark'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-foreground/30'
                )}
              >
                <div className="flex w-full items-center justify-between">
                  <div className="rounded-md bg-slate-800 p-2 text-slate-100">
                    <Moon className="h-5 w-5" />
                  </div>
                  {storeTheme === 'dark' && (
                    <Badge variant="default" className="text-[10px] uppercase">
                      {t('common.active')}
                    </Badge>
                  )}
                </div>
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">{t('settings.themeDark')}</p>
                  <p className="text-xs text-muted-foreground">
                    {locale === 'fr' ? 'Interface sombre reposante pour la nuit.' : 'Relaxed dark interface for night use.'}
                  </p>
                </div>
              </button>
            </div>

            <div className="flex items-start gap-2 rounded-md border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
              <Palette className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {locale === 'fr'
                  ? "Le thème est enregistré immédiatement sur votre compte ; aucune action supplémentaire n'est nécessaire. La barre latérale, l'en-tête et les graphiques s'adaptent automatiquement."
                  : 'The theme is saved to your account immediately — no extra action needed. The sidebar, header and charts adapt automatically.'}
              </span>
            </div>
          </SectionCard>
        </TabsContent>

        {/* --------------------------------------------------------------- */}
        {/* 3. Financial configuration                                     */}
        {/* --------------------------------------------------------------- */}
        <TabsContent value="financial" className="space-y-6">
          <SectionCard
            title={t('settings.financial')}
            icon={PiggyBank}
            description={
              locale === 'fr'
                ? 'Revenu mensuel de référence, unité d’allocation et découvert.'
                : 'Reference monthly income, allocation unit and overdraft policy.'
            }
            footer={
              <Button
                type="button"
                onClick={handleSaveFinancial}
                disabled={savingFinancial}
              >
                <Save className="h-4 w-4" />
                {savingFinancial ? t('common.loading') : t('common.save')}
              </Button>
            }
          >
            <FieldRow
              label={t('settings.referenceMonthlyIncome')}
              htmlFor="settings-ref-income"
              hint={
                locale === 'fr'
                  ? 'Revenu net mensuel moyen utilisé pour les allocations (50/30/20…).'
                  : 'Average net monthly income used for allocations (50/30/20…).'
              }
            >
              <div className="flex items-center gap-2">
                <Input
                  id="settings-ref-income"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={refIncome}
                  onChange={(e) => setRefIncome(e.target.value)}
                  placeholder="25000"
                />
                <Badge variant="outline" className="shrink-0">
                  {currency.toUpperCase()}
                </Badge>
              </div>
            </FieldRow>

            <FieldRow
              label={t('settings.allocationUnitValue')}
              htmlFor="settings-alloc-unit"
              hint={
                locale === 'fr'
                  ? "Valeur d'une unité d'allocation (granularité des montants)."
                  : 'Value of a single allocation unit (amount granularity).'
              }
            >
              <div className="flex items-center gap-2">
                <Input
                  id="settings-alloc-unit"
                  type="number"
                  inputMode="decimal"
                  min={0.01}
                  step="0.01"
                  value={allocUnit}
                  onChange={(e) => setAllocUnit(e.target.value)}
                  placeholder="500"
                />
                <Badge variant="outline" className="shrink-0">
                  {currency.toUpperCase()}
                </Badge>
              </div>
            </FieldRow>

            <Separator />

            <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/30 p-4">
              <div className="space-y-1">
                <Label className="text-sm font-medium">{t('settings.allowOverdraft')}</Label>
                <p className="text-xs text-muted-foreground">
                  {locale === 'fr'
                    ? 'Autorise les soldes négatifs par défaut sur les portefeuilles nouveaux et existants.'
                    : 'Allow negative balances by default on new and existing wallets.'}
                </p>
              </div>
              <Switch checked={allowOverdraft} onCheckedChange={setAllowOverdraft} />
            </div>
          </SectionCard>
        </TabsContent>

        {/* --------------------------------------------------------------- */}
        {/* 4. Security                                                    */}
        {/* --------------------------------------------------------------- */}
        <TabsContent value="security" className="space-y-6">
          <SectionCard
            title={t('auth.changePassword')}
            icon={KeyRound}
            description={
              locale === 'fr'
                ? 'Choisissez un mot de passe d’au moins 10 caractères.'
                : 'Choose a password of at least 10 characters.'
            }
            footer={
              <Button
                type="button"
                onClick={handleChangePassword}
                disabled={savingPassword}
              >
                <Lock className="h-4 w-4" />
                {savingPassword ? t('common.loading') : t('auth.changePassword')}
              </Button>
            }
          >
            <FieldRow label={t('auth.currentPassword')} htmlFor="pwd-current">
              <Input
                id="pwd-current"
                type="password"
                value={currentPwd}
                onChange={(e) => setCurrentPwd(e.target.value)}
                autoComplete="current-password"
              />
            </FieldRow>

            <FieldRow label={t('auth.newPassword')} htmlFor="pwd-new">
              <div className="space-y-2">
                <Input
                  id="pwd-new"
                  type="password"
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  autoComplete="new-password"
                />
                {newPwd && (
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          pwdStrength.pct < 40
                            ? 'bg-expense'
                            : pwdStrength.pct < 70
                              ? 'bg-warning'
                              : 'bg-income'
                        )}
                        style={{ width: `${pwdStrength.pct}%` }}
                      />
                    </div>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {pwdStrength.label}
                    </span>
                  </div>
                )}
                {newPwd.length > 0 && newPwd.length < 10 && (
                  <p className="text-xs text-expense">{t('auth.passwordTooShort')}</p>
                )}
              </div>
            </FieldRow>

            <FieldRow label={t('auth.confirmPassword')} htmlFor="pwd-confirm">
              <div className="space-y-2">
                <Input
                  id="pwd-confirm"
                  type="password"
                  value={confirmPwd}
                  onChange={(e) => setConfirmPwd(e.target.value)}
                  autoComplete="new-password"
                  aria-invalid={confirmPwd.length > 0 && !pwdMatch}
                />
                {confirmPwd.length > 0 && !pwdMatch && (
                  <p className="text-xs text-expense">{t('auth.passwordMismatch')}</p>
                )}
                {pwdMatch && (
                  <p className="text-xs text-income">
                    {locale === 'fr' ? 'Les mots de passe correspondent.' : 'Passwords match.'}
                  </p>
                )}
              </div>
            </FieldRow>
          </SectionCard>

          <SectionCard
            title={t('auth.sessionInfo')}
            icon={ShieldCheck}
            description={
              locale === 'fr'
                ? 'Informations sur la session active et déconnexion.'
                : 'Active session information and sign out.'
            }
            footer={
              <Button
                type="button"
                variant="destructive"
                onClick={handleSignOut}
                disabled={signingOut}
              >
                <LogOut className="h-4 w-4" />
                {signingOut ? t('common.loading') : t('auth.logout')}
              </Button>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-4">
                <div className="rounded-md bg-muted p-2 text-muted-foreground">
                  <UserIcon className="h-4 w-4" />
                </div>
                <div className="min-w-0 space-y-1">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {t('auth.name')}
                  </p>
                  <p className="truncate text-sm font-medium">
                    {user?.name ?? (loading ? '—' : '—')}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-4">
                <div className="rounded-md bg-muted p-2 text-muted-foreground">
                  <Mail className="h-4 w-4" />
                </div>
                <div className="min-w-0 space-y-1">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {t('auth.email')}
                  </p>
                  <p className="truncate text-sm font-medium">
                    {user?.email ?? (loading ? '—' : '—')}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-transparent bg-info/15 text-info">
                {user?.language === 'fr' ? t('settings.languageFr') : t('settings.languageEn')}
              </Badge>
              <Badge variant="outline" className="border-transparent bg-muted text-foreground">
                {user?.theme === 'dark' ? t('settings.themeDark') : t('settings.themeLight')}
              </Badge>
            </div>
          </SectionCard>
        </TabsContent>

        {/* --------------------------------------------------------------- */}
        {/* 5. Data management                                              */}
        {/* --------------------------------------------------------------- */}
        <TabsContent value="data" className="space-y-6">
          {/* CSV exports */}
          <SectionCard
            title={t('settings.csvExports')}
            icon={Download}
            description={
              locale === 'fr'
                ? 'Exportez chaque module au format CSV.'
                : 'Export each module as a CSV file.'
            }
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {exports.map(({ key, label, Icon, desc }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleExport(key)}
                  className="group flex items-start gap-3 rounded-lg border bg-card p-4 text-left transition-colors hover:border-foreground/30 hover:bg-muted/40"
                >
                  <div className="rounded-md bg-muted p-2 text-muted-foreground transition-colors group-hover:bg-primary/15 group-hover:text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{label}</p>
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <p className="text-xs text-muted-foreground">{desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </SectionCard>

          {/* Backup instructions */}
          <SectionCard
            title={t('settings.backupInstructions')}
            icon={HardDrive}
            description={
              locale === 'fr'
                ? 'Sauvegardez la base de données de production avant toute opération critique.'
                : 'Back up the production database before any critical operation.'
            }
          >
            <div className="space-y-4 text-sm">
              <p className="text-muted-foreground">
                {locale === 'fr' ? (
                  <>
                    En production, l’application utilise <strong>PostgreSQL</strong>. Effectuez des
                    sauvegardes régulières avec <code className="rounded bg-muted px-1 py-0.5">pg_dump</code> et
                    restaurez avec <code className="rounded bg-muted px-1 py-0.5">psql</code>.
                  </>
                ) : (
                  <>
                    In production the application uses <strong>PostgreSQL</strong>. Take regular
                    backups with <code className="rounded bg-muted px-1 py-0.5">pg_dump</code> and
                    restore with <code className="rounded bg-muted px-1 py-0.5">psql</code>.
                  </>
                )}
              </p>

              <div className="space-y-1">
                <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <CloudUpload className="h-3.5 w-3.5" />
                  {locale === 'fr' ? 'Sauvegarde' : 'Backup'}
                </p>
                <pre className="overflow-x-auto rounded-md border bg-muted/60 p-3 text-xs leading-relaxed">
{`# Dump the production database to a compressed file
pg_dump "$DATABASE_URL" \\
  --no-owner --no-privileges \\
  --format=custom --file=pfm-$(date +%F).dump

# Or as plain SQL (human-readable)
pg_dump "$DATABASE_URL" > pfm-$(date +%F).sql`}
                </pre>
              </div>

              <div className="space-y-1">
                <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <CloudDownload className="h-3.5 w-3.5" />
                  {locale === 'fr' ? 'Restauration' : 'Restore'}
                </p>
                <pre className="overflow-x-auto rounded-md border bg-muted/60 p-3 text-xs leading-relaxed">
{`# Restore from a custom-format dump
pg_restore --clean --if-exists \\
  --dbname="$DATABASE_URL" pfm-2025-01-01.dump

# Or replay a plain SQL dump
psql "$DATABASE_URL" -f pfm-2025-01-01.sql`}
                </pre>
              </div>

              <Separator />

              <div className="space-y-2 rounded-md border border-dashed bg-muted/40 p-3">
                <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <Archive className="h-3.5 w-3.5" />
                  {locale === 'fr' ? 'Environnement de développement' : 'Development environment'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {locale === 'fr'
                    ? "L'environnement de développement utilise SQLite. Le fichier de base de données se trouve à"
                    : 'The development environment uses SQLite. The database file is located at'}{' '}
                  <code className="rounded bg-muted px-1 py-0.5">db/custom.db</code>{' '}
                  {locale === 'fr'
                    ? 'et peut être copié directement pour sauvegarde :'
                    : 'and can be copied directly for backup:'}
                </p>
                <pre className="overflow-x-auto rounded-md border bg-muted/60 p-3 text-xs leading-relaxed">
{`# Copy the SQLite file (stop the dev server first)
cp db/custom.db db/custom.db.bak-$(date +%F)

# Restore: replace the file and restart
cp db/custom.db.bak-2025-01-01 db/custom.db`}
                </pre>
              </div>
            </div>
          </SectionCard>

          {/* Data portability */}
          <SectionCard
            title={t('settings.dataPortability')}
            icon={FileText}
            description={
              locale === 'fr'
                ? 'Les exports CSV assurent la portabilité de vos données.'
                : 'CSV exports make your data portable.'
            }
          >
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>
                {locale === 'fr'
                  ? 'Chaque module propose un export CSV horodaté et filtrable. Les fichiers CSV peuvent être ouverts dans Excel, Google Sheets, LibreOffice ou importés dans un autre outil.'
                  : 'Each module offers a timestamped, filterable CSV export. CSV files can be opened in Excel, Google Sheets, LibreOffice or imported into another tool.'}
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  {locale === 'fr'
                    ? 'Les montants sont exportés en format décimal brut (ex. 1234.56).'
                    : 'Amounts are exported as raw decimal values (e.g. 1234.56).'}
                </li>
                <li>
                  {locale === 'fr'
                    ? 'Les dates suivent le format ISO 8601 (AAAA-MM-JJ).'
                    : 'Dates follow the ISO 8601 format (YYYY-MM-DD).'}
                </li>
                <li>
                  {locale === 'fr'
                    ? 'Les colonnes vides sont conservées comme chaînes vides pour préserver la structure.'
                    : 'Empty columns are kept as empty strings to preserve the structure.'}
                </li>
              </ul>
            </div>
          </SectionCard>
        </TabsContent>
      </Tabs>
    </div>
  )
}
