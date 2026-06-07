'use client'

import { useEffect, useState } from 'react'

const BACKEND_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

type Props = {
  url: string
  alt: string
  className?: string
}

/** Load API-hosted images with the JWT (a plain img tag cannot send Authorization). */
export function AuthenticatedImage({ url, alt, className }: Props) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  const path = url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')
    ? url
    : `${BACKEND_BASE}${url.startsWith('/') ? url : `/${url}`}`

  useEffect(() => {
    if (path.startsWith('data:')) {
      setSrc(path)
      return
    }

    let objectUrl: string | null = null
    let cancelled = false
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null

    const csrfMatch = document.cookie.match(/(?:^|;\s*)llm_explorer_csrf=([^;]+)/)
    fetch(path, {
      credentials: 'include',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(csrfMatch ? { 'X-CSRF-Token': decodeURIComponent(csrfMatch[1]) } : {}),
      },
    })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.blob()
      })
      .then(blob => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
        setFailed(false)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [path])

  if (failed) {
    return (
      <div className="px-4 py-3 text-xs text-red-600 bg-red-50 border-t border-red-100">
        Failed to load image. Try refreshing the page.
      </div>
    )
  }

  if (!src) {
    return (
      <div className="px-4 py-10 flex justify-center">
        <div className="w-5 h-5 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={className} />
  )
}
