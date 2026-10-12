'use client'

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'

export interface FetchOptions extends RequestInit {
  query?: Record<string, string | number | boolean | undefined | null>
  // When true, throw on non-2xx (default). When false, return the error payload.
  throwOnError?: boolean
}

function buildUrl(path: string, query?: FetchOptions['query']): string {
  if (!query) return path
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue
    params.set(k, String(v))
  }
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

export function useApi() {
  const [loading, setLoading] = useState(false)

  const request = useCallback(async <T = unknown>(path: string, opts: FetchOptions = {}): Promise<T> => {
    const { query, throwOnError = true, headers, ...rest } = opts
    const url = buildUrl(path, query)
    let res: Response
    try {
      res = await fetch(url, {
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...(headers || {}) },
        ...rest,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Network error'
      toast.error(msg)
      throw e
    }
    const isJson = res.headers.get('content-type')?.includes('application/json')
    const data = isJson ? await res.json().catch(() => ({})) : {}
    if (!res.ok) {
      const message = (data as { error?: string }).error || res.statusText
      if (throwOnError) {
        toast.error(message)
        throw new Error(message)
      }
      return data as T
    }
    return data as T
  }, [])

  const api = {
    loading,
    get: <T = unknown>(path: string, opts?: Omit<FetchOptions, 'method' | 'body'>) => request<T>(path, { ...opts, method: 'GET' }),
    post: <T = unknown>(path: string, body?: unknown, opts?: Omit<FetchOptions, 'method' | 'body'>) =>
      request<T>(path, { ...opts, method: 'POST', body: body ? JSON.stringify(body) : undefined }),
    put: <T = unknown>(path: string, body?: unknown, opts?: Omit<FetchOptions, 'method' | 'body'>) =>
      request<T>(path, { ...opts, method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
    patch: <T = unknown>(path: string, body?: unknown, opts?: Omit<FetchOptions, 'method' | 'body'>) =>
      request<T>(path, { ...opts, method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
    del: <T = unknown>(path: string, opts?: Omit<FetchOptions, 'method' | 'body'>) =>
      request<T>(path, { ...opts, method: 'DELETE' }),
    setLoading,
  }

  return api
}
