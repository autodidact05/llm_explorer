'use client'

import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import type { Credit, Paginated } from '@/lib/types'
import { useCurrencyPreference, useTimezone, formatDate } from '@/lib/hooks'
import { EmptyState } from '@/components/EmptyState'
import { ProviderKeyBanner } from '@/components/ProviderKeyBanner'

const PAGE_SIZE = 50

export default function WalletPage() {
  const [walletBalance, setWalletBalance] = useState<number | null>(null)
  const [data, setData] = useState<Paginated<Credit> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)

  const { currency, meta: currencyMeta, rates } = useCurrencyPreference()
  const { timezone } = useTimezone()

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    api.wallet({ page, page_size: PAGE_SIZE })
      .then(d => {
        setWalletBalance(d.wallet_balance ?? d.balance)
        setData({ total: d.total, page: d.page, page_size: d.page_size, items: d.items })
        setLoading(false)
      })
      .catch((e: Error) => { setError(e.message); setLoading(false) })
  }, [page])

  useEffect(() => { load() }, [load])

  function fmtConverted(usd: number): string {
    if (!currencyMeta || !rates[currencyMeta.code]) return ''
    const converted = Math.abs(usd) * rates[currencyMeta.code]
    const sign = usd >= 0 ? '+' : '-'
    const str = converted < 0.001
      ? converted.toFixed(6)
      : converted >= 100
        ? converted.toFixed(currencyMeta.decimals > 0 ? 2 : 0)
        : converted.toFixed(currencyMeta.decimals)
    return `${sign}${currencyMeta.symbol}${str}`
  }

  function fmtAmount(n: number) {
    const sign = n >= 0 ? '+' : ''
    const abs = Math.abs(n)
    const usdStr = `${sign}$${abs < 0.001 && abs > 0 ? abs.toFixed(8) : abs.toFixed(4)}`
    const conv = fmtConverted(n)
    return conv ? `${usdStr} (${conv})` : usdStr
  }

  function fmtWallet(n: number) {
    const sign = n >= 0 ? '' : '-'
    const abs = Math.abs(n)
    const usdStr = `${sign}$${abs < 0.001 && abs > 0 ? abs.toFixed(8) : abs.toFixed(4)}`
    if (!currencyMeta || !rates[currencyMeta.code]) return usdStr
    const converted = abs * rates[currencyMeta.code]
    const convStr = converted >= 100
      ? converted.toFixed(currencyMeta.decimals > 0 ? 2 : 0)
      : converted.toFixed(currencyMeta.decimals)
    return `${usdStr} (${sign}${currencyMeta.symbol}${convStr})`
  }

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Wallet</h1>
        <p className="text-slate-500 mt-1">AI spend ledger — top-ups and automatic LLM deductions</p>
        {currency && currencyMeta && rates[currencyMeta.code] && (
          <p className="text-xs text-slate-400 mt-0.5">
            1 USD = {rates[currencyMeta.code].toFixed(4)} {currencyMeta.code}
            {' · '}
            <a href="/settings" className="underline hover:text-slate-600">Change currency in Settings</a>
          </p>
        )}
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
      )}

      <ProviderKeyBanner className="mb-6" />

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-6">
        <p className="text-sm font-medium text-slate-500">Remaining balance</p>
        {walletBalance !== null ? (
          <p className={`mt-2 text-3xl font-bold tracking-tight font-mono ${walletBalance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {fmtWallet(walletBalance)}
          </p>
        ) : (
          <div className="mt-2 h-10 w-48 bg-slate-100 rounded-lg animate-pulse" />
        )}
        <p className="mt-1 text-xs text-slate-400">Sum of all wallet transactions (credits minus usage)</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-800">Transactions</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                {['#', 'Date', 'Amount', 'Description', 'Conversation'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading && (
                <tr><td colSpan={5} className="px-4 py-12 text-center">
                  <div className="inline-block w-6 h-6 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                </td></tr>
              )}
              {!loading && data?.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-0">
                    <EmptyState
                      icon="wallet"
                      title="No wallet transactions yet"
                      description="Top-ups and LLM usage deductions appear here after your first API call."
                      actions={[
                        { label: 'Start chat', href: '/chat', primary: true },
                        { label: 'OpenRouter sync', href: '/settings?tab=sync' },
                      ]}
                    />
                  </td>
                </tr>
              )}
              {!loading && data?.items.map(row => (
                <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 text-slate-400 font-mono text-xs">{row.id}</td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs">
                    {formatDate(row.created_at, timezone)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`font-mono text-xs font-medium ${row.amount >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {fmtAmount(row.amount)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600 text-xs">{row.description}</td>
                  <td className="px-4 py-3 text-slate-400 font-mono text-xs">
                    {row.conversation_id ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between">
            <p className="text-xs text-slate-500">Page {page} of {totalPages} · {data?.total.toLocaleString()} results</p>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg disabled:opacity-40 hover:bg-slate-50">
                Previous
              </button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg disabled:opacity-40 hover:bg-slate-50">
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
