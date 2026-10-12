'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/lib/store'
import { useI18n } from '@/lib/use-i18n'
import { toast } from 'sonner'
import { Wallet, ShieldCheck, LogIn, UserPlus } from 'lucide-react'

export function AuthScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null)
  const appName = useAppStore((s) => s.appName)
  const appNameFr = useAppStore((s) => s.appNameFr)
  const locale = useAppStore((s) => s.locale)
  const setLocale = useAppStore((s) => s.setLocale)
  const setBranding = useAppStore((s) => s.setBranding)
  const { t } = useI18n()

  useEffect(() => {
    fetch('/api/auth/status', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => setSetupComplete(Boolean(d.setupComplete)))
      .catch(() => setSetupComplete(false))
    fetch('/api/settings', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (s) setBranding(s.appName ?? 'Personal Finance Manager', s.appNameFr ?? 'Gestionnaire de Finances Personnelles')
      })
      .catch(() => {})
  }, [setBranding])

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-sidebar via-background to-background">
      <header className="flex items-center justify-between px-4 sm:px-6 py-4">
        <div className="flex items-center gap-2 text-sidebar-foreground">
          <div className="rounded-md bg-sidebar-primary p-1.5">
            <Wallet className="h-5 w-5 text-sidebar-primary-foreground" />
          </div>
          <div>
            <p className="font-semibold text-lg leading-none">{locale === 'fr' ? appNameFr : appName}</p>
            <p className="text-xs text-sidebar-foreground/70 mt-0.5">{t('app.tagline')}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-sidebar-foreground/20 p-0.5">
          {(['en', 'fr'] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLocale(l)}
              className={`px-2.5 py-1 text-xs font-medium rounded uppercase transition-colors ${
                locale === l ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        {setupComplete === null ? null : setupComplete ? (
          <LoginForm onAuthenticated={onAuthenticated} />
        ) : (
          <SetupForm onAuthenticated={onAuthenticated} />
        )}
      </main>
      <footer className="text-center text-xs text-sidebar-foreground/60 py-4">
        © {new Date().getFullYear()} {locale === 'fr' ? appNameFr : appName}
      </footer>
    </div>
  )
}

function LoginForm({ onAuthenticated }: { onAuthenticated: () => void }) {
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || t('auth.invalidCredentials'))
        return
      }
      toast.success(t('auth.loginTitle'))
      onAuthenticated()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="w-full max-w-md shadow-xl border-border/60">
      <CardHeader className="space-y-1 text-center">
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <LogIn className="h-6 w-6 text-primary" />
        </div>
        <CardTitle className="text-2xl">{t('auth.loginTitle')}</CardTitle>
        <CardDescription>{t('auth.loginDesc')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t('auth.email')}</Label>
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{t('auth.password')}</Label>
            <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? t('common.loading') : t('auth.login')}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function SetupForm({ onAuthenticated }: { onAuthenticated: () => void }) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      toast.error(t('auth.passwordMismatch'))
      return
    }
    if (password.length < 10) {
      toast.error(t('auth.passwordTooShort'))
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Setup failed.')
        return
      }
      toast.success(t('auth.setupComplete'))
      onAuthenticated()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="w-full max-w-md shadow-xl border-border/60">
      <CardHeader className="space-y-1 text-center">
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <ShieldCheck className="h-6 w-6 text-primary" />
        </div>
        <CardTitle className="text-2xl">{t('auth.setupTitle')}</CardTitle>
        <CardDescription>{t('auth.setupDesc')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">{t('auth.name')}</Label>
            <Input id="name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">{t('auth.email')}</Label>
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{t('auth.password')}</Label>
            <Input id="password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">{t('auth.confirmPassword')}</Label>
            <Input id="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? t('common.loading') : (<><UserPlus className="h-4 w-4 mr-2" />{t('common.create')}</>)}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
