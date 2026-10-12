'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Locale } from './i18n'

export type ViewKey =
  | 'dashboard'
  | 'income'
  | 'expenses'
  | 'wallets'
  | 'articles'
  | 'categories'
  | 'allocations'
  | 'bankCredits'
  | 'personalLoans'
  | 'goals'
  | 'analytics'
  | 'settings'

interface AppState {
  // client-side navigation (single route constraint)
  view: ViewKey
  setView: (v: ViewKey) => void

  // client-side UI locale (mirrors the user preference; authoritative value lives in DB)
  locale: Locale
  setLocale: (l: Locale) => void

  theme: 'light' | 'dark'
  setTheme: (t: 'light' | 'dark') => void

  // sidebar (mobile drawer)
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void

  // global search open state
  searchOpen: boolean
  setSearchOpen: (open: boolean) => void

  // branding cached client side so login page can show it before auth
  appName: string
  appNameFr: string
  setBranding: (en: string, fr: string) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      view: 'dashboard',
      setView: (v) => set({ view: v, sidebarOpen: false }),

      locale: 'en',
      setLocale: (l) => set({ locale: l }),

      theme: 'light',
      setTheme: (t) => set({ theme: t }),

      sidebarOpen: false,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),

      searchOpen: false,
      setSearchOpen: (open) => set({ searchOpen: open }),

      appName: 'Personal Finance Manager',
      appNameFr: 'Gestionnaire de Finances Personnelles',
      setBranding: (en, fr) => set({ appName: en, appNameFr: fr }),
    }),
    {
      name: 'pfm-ui',
      partialize: (s) => ({
        view: s.view,
        locale: s.locale,
        theme: s.theme,
        appName: s.appName,
        appNameFr: s.appNameFr,
      }),
    }
  )
)
