'use client'

import { useEffect, useState } from 'react'
import { useAppStore } from '@/lib/store'
import { AuthScreen } from '@/components/auth/auth-screen'
import { AppShell } from '@/components/app-shell'

type BootState = 'loading' | 'unauthenticated' | 'authenticated'

export function Boot() {
  const [state, setState] = useState<BootState>('loading')
  const [settings, setSettings] = useState<{ appName: string; appNameFr: string; defaultLanguage: 'en' | 'fr' } | null>(null)
  const setBranding = useAppStore((s) => s.setBranding)
  const setLocale = useAppStore((s) => s.setLocale)
  const setTheme = useAppStore((s) => s.setTheme)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'same-origin' })
        if (!res.ok) {
          if (!cancelled) setState('unauthenticated')
          // still try to fetch public branding for the login page
          const sres = await fetch('/api/settings', { credentials: 'same-origin' }).catch(() => null)
          if (sres && sres.ok) {
            const s = await sres.json()
            if (!cancelled) {
              setBranding(s.appName ?? 'Personal Finance Manager', s.appNameFr ?? 'Gestionnaire de Finances Personnelles')
            }
          }
          return
        }
        const data = await res.json()
        if (cancelled) return
        setState('authenticated')
        setSettings({
          appName: data.settings?.appName ?? 'Personal Finance Manager',
          appNameFr: data.settings?.appNameFr ?? 'Gestionnaire de Finances Personnelles',
          defaultLanguage: (data.user?.language ?? 'en') as 'en' | 'fr',
        })
        setBranding(data.settings?.appName ?? 'Personal Finance Manager', data.settings?.appNameFr ?? 'Gestionnaire de Finances Personnelles')
        if (data.user?.language) setLocale(data.user.language as 'en' | 'fr')
        if (data.user?.theme) setTheme(data.user.theme as 'light' | 'dark')
      } catch {
        if (!cancelled) setState('unauthenticated')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [setBranding, setLocale, setTheme])

  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </div>
    )
  }

  if (state === 'unauthenticated') {
    return <AuthScreen onAuthenticated={() => setState('authenticated')} />
  }

  return <AppShell />
}
