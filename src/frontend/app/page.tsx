'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function LandingPage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    if (localStorage.getItem('auth_token')) {
      router.replace('/dashboard')
    } else {
      setChecking(false)
    }
  }, [router])

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream-100">
        <div className="w-6 h-6 border-2 border-gold-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-navy-900 via-navy-900 to-navy-800 px-6 text-center">
      <p className="text-gold-300 text-sm font-medium tracking-wide uppercase mb-3">LLM Explorer</p>
      <h1 className="text-3xl sm:text-4xl font-bold text-cream-50 max-w-xl leading-tight">
        See every cent your LLMs cost — chat included.
      </h1>
      <p className="mt-4 text-navy-100 text-base max-w-md">
        Local-first usage tracking, model routing, and multi-turn chat on your machine.
      </p>
      <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
        <Link
          href="/login"
          className="px-6 py-3 rounded-xl bg-gold-400 text-navy-900 font-semibold text-sm hover:bg-gold-300 transition-colors shadow-lg"
        >
          Get started
        </Link>
        <Link
          href="/login"
          className="px-6 py-3 rounded-xl border border-navy-600 text-cream-50 font-medium text-sm hover:bg-navy-800 transition-colors"
        >
          Sign in
        </Link>
      </div>
    </div>
  )
}
