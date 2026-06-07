'use client'

import { useEffect, useState } from 'react'
import { api } from './api'
import { getLocalStorage, setLocalStorage } from './storage'

// ── Currency ──────────────────────────────────────────────────────────────────

export const CURRENCIES = [
  { code: 'GBP', label: 'British Pound (£)', symbol: '£', decimals: 4 },
  { code: 'EUR', label: 'Euro (€)', symbol: '€', decimals: 4 },
  { code: 'INR', label: 'Indian Rupee (₹)', symbol: '₹', decimals: 2 },
  { code: 'CNY', label: 'Chinese Yuan (¥)', symbol: '¥', decimals: 4 },
  { code: 'JPY', label: 'Japanese Yen (¥)', symbol: '¥', decimals: 0 },
  { code: 'AUD', label: 'Australian Dollar (A$)', symbol: 'A$', decimals: 4 },
  { code: 'CAD', label: 'Canadian Dollar (C$)', symbol: 'C$', decimals: 4 },
  { code: 'BRL', label: 'Brazilian Real (R$)', symbol: 'R$', decimals: 2 },
]

export interface CurrencyMeta {
  code: string
  label: string
  symbol: string
  decimals: number
}

export function useCurrencyPreference() {
  const [currency, setCurrencyState] = useState('')
  const [rates, setRates] = useState<Record<string, number>>({})

  useEffect(() => {
    const saved = getLocalStorage('preferred_currency', '')
    setCurrencyState(saved)
    api.currency().then(setRates).catch(() => {})
  }, [])

  function setCurrency(code: string) {
    setCurrencyState(code)
    setLocalStorage('preferred_currency', code)
  }

  const meta: CurrencyMeta | null = CURRENCIES.find(c => c.code === currency) ?? null

  function fmtUsd(n: number, decimals = 4): string {
    const abs = Math.abs(n)
    const str = abs < 0.001 && abs > 0 ? abs.toFixed(8) : abs.toFixed(decimals)
    return `$${str}`
  }

  function fmtCost(n: number): string {
    const usd = fmtUsd(n)
    if (!meta || !rates[meta.code]) return usd
    const converted = Math.abs(n) * rates[meta.code]
    const convStr = converted < 0.001
      ? converted.toFixed(6)
      : converted >= 100
        ? converted.toFixed(meta.decimals > 0 ? 2 : 0)
        : converted.toFixed(meta.decimals)
    return `${usd} (${meta.symbol}${convStr})`
  }

  return { currency, setCurrency, rates, meta, fmtCost, fmtUsd }
}

// ── Timezone ──────────────────────────────────────────────────────────────────

export const TIMEZONES = [
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'Eastern (ET)' },
  { value: 'America/Chicago', label: 'Central (CT)' },
  { value: 'America/Denver', label: 'Mountain (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
  { value: 'America/Sao_Paulo', label: 'São Paulo (BRT)' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Central Europe (CET)' },
  { value: 'Europe/Moscow', label: 'Moscow (MSK)' },
  { value: 'Africa/Johannesburg', label: 'South Africa (SAST)' },
  { value: 'Asia/Kolkata', label: 'India (IST)' },
  { value: 'Asia/Dubai', label: 'Gulf (GST)' },
  { value: 'Asia/Shanghai', label: 'China (CST)' },
  { value: 'Asia/Tokyo', label: 'Japan (JST)' },
  { value: 'Asia/Singapore', label: 'Singapore (SGT)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEDT/AEST)' },
]

export function useTimezone() {
  const [timezone, setTimezoneState] = useState('UTC')

  useEffect(() => {
    const saved = getLocalStorage('preferred_timezone', 'UTC')
    setTimezoneState(saved)
  }, [])

  function setTimezone(tz: string) {
    setTimezoneState(tz)
    setLocalStorage('preferred_timezone', tz)
  }

  return { timezone, setTimezone }
}

// ── Theme ─────────────────────────────────────────────────────────────────────

export type Theme = 'light' | 'dark'

function applyTheme(t: Theme) {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', t === 'dark')
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>('light')

  useEffect(() => {
    const saved = (getLocalStorage('theme', 'light') as Theme)
    setThemeState(saved)
    applyTheme(saved)
  }, [])

  function setTheme(t: Theme) {
    setThemeState(t)
    setLocalStorage('theme', t)
    applyTheme(t)
  }

  return { theme, setTheme }
}

export function formatDate(dateStr: string, timezone?: string): string {
  const tz = timezone
    ?? getLocalStorage('preferred_timezone', 'UTC')
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    }).format(new Date(dateStr))
  } catch {
    return new Date(dateStr).toLocaleString()
  }
}
