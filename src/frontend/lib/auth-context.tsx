'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { authApi } from './api/auth'

type AuthContextValue = {
  email: string | null
  isAuthenticated: boolean
  setSession: (token: string, email: string) => void
  clearSession: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    setEmail(typeof window !== 'undefined' ? localStorage.getItem('auth_email') : null)
  }, [])

  const setSession = useCallback((token: string, userEmail: string) => {
    localStorage.setItem('auth_token', token)
    localStorage.setItem('auth_email', userEmail)
    setEmail(userEmail)
  }, [])

  const clearSession = useCallback(() => {
    localStorage.removeItem('auth_token')
    localStorage.removeItem('auth_email')
    setEmail(null)
    authApi.logout().catch(() => {})
  }, [])

  const value = useMemo(
    () => ({
      email,
      isAuthenticated: Boolean(email || (typeof window !== 'undefined' && localStorage.getItem('auth_token'))),
      setSession,
      clearSession,
    }),
    [email, setSession, clearSession],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
