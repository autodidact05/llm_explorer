'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Sidebar from './Sidebar'
import { AuthProvider } from '@/lib/auth-context'
import { useTheme } from '@/lib/hooks'

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [ready, setReady] = useState(false)
  useTheme()  // initializes and applies saved theme on mount

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token && pathname !== '/login' && pathname !== '/' && pathname !== '/onboarding') {
      router.replace('/login')
    } else {
      setReady(true)
    }
  }, [pathname, router])

  if (!ready) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-cream-100">
        <div className="w-6 h-6 border-2 border-gold-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (pathname === '/login' || pathname === '/' || pathname === '/onboarding') {
    return <AuthProvider>{children}</AuthProvider>
  }

  return (
    <AuthProvider>
      <Sidebar />
      <main className="ml-60 flex-1 overflow-y-auto bg-cream-100">{children}</main>
    </AuthProvider>
  )
}
