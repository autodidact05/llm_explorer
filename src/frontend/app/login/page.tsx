'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { isOnboardingComplete } from '@/features/onboarding/OnboardingWizard'

export default function LoginPage() {
  const router = useRouter()
  const { setSession } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [checkingStatus, setCheckingStatus] = useState(true)
  const [hasUsers, setHasUsers] = useState(false)

  useEffect(() => {
    if (localStorage.getItem('auth_token')) {
      router.replace('/dashboard')
      return
    }
    api.auth.status()
      .then(s => {
        setHasUsers(s.users_registered)
        if (!s.users_registered) setMode('register')
      })
      .catch(() => {})
      .finally(() => setCheckingStatus(false))
  }, [router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password) return
    setLoading(true)
    setError('')
    try {
      const fn = mode === 'login' ? api.auth.login : api.auth.register
      const res = await fn(email.trim(), password)
      setSession(res.token, res.email)
      const config = await api.config()
      if (config.api_key_set) {
        api.syncOpenRouterCredits().catch(() => {})
      }
      if (!config.api_key_set) {
        router.replace('/onboarding')
      } else if (!isOnboardingComplete()) {
        router.replace('/onboarding')
      } else {
        router.replace('/dashboard')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  if (checkingStatus) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-navy-900">
        <div className="w-6 h-6 border-2 border-gold-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-navy-900 p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-cream-50">LLM Explorer</h1>
          <p className="text-gold-300 mt-1 text-sm">Usage tracking &amp; cost analysis</p>
        </div>

        <div className="card bg-cream-50 border-cream-300 p-6 space-y-5">
          {hasUsers && (
            <div className="flex gap-1 bg-cream-200 rounded-lg p-1">
              {(['login', 'register'] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setMode(m); setError('') }}
                  className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    mode === m
                      ? 'bg-cream-50 shadow-sm text-navy-900'
                      : 'text-navy-500 hover:text-navy-700'
                  }`}
                >
                  {m === 'login' ? 'Sign in' : 'Register'}
                </button>
              ))}
            </div>
          )}

          {!hasUsers && (
            <div>
              <h2 className="text-base font-semibold text-navy-800">Create your account</h2>
              <p className="text-sm text-navy-500 mt-0.5">Set up LLM Explorer to get started.</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-navy-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="input-field"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-navy-700 mb-1">Password</label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="input-field pr-14"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-navy-400 hover:text-navy-600"
                >
                  {showPass ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button type="submit" disabled={loading} className="btn-primary w-full py-2.5">
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-navy-900 border-t-transparent rounded-full animate-spin" />
                  {mode === 'login' ? 'Signing in…' : 'Creating account…'}
                </span>
              ) : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
