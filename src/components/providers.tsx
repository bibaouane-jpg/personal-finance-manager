'use client'

import { ThemeProvider } from 'next-themes'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { useAppStore } from '@/lib/store'

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
        },
      })
  )

  // Sync persisted theme + locale to <html>.
  const theme = useAppStore((s) => s.theme)
  const locale = useAppStore((s) => s.locale)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.lang = locale
  }, [theme, locale])

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </ThemeProvider>
  )
}
