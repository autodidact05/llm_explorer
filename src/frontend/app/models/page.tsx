'use client'

import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import type { ModelPricing, Paginated } from '@/lib/types'
import { fmtCtx, fmtUsd } from '@/lib/format'
import { EmptyState } from '@/components/EmptyState'
import { ProviderKeyBanner } from '@/components/ProviderKeyBanner'

const PAGE_SIZE = 50

function fmtCost(n: number) {
  if (n === 0) return <span className="text-slate-400">Free</span>
  return <span className="font-mono">{fmtUsd(n)}</span>
}

function Badge({ label, variant }: { label: string; variant: 'green' | 'amber' | 'indigo' | 'slate' }) {
  const cls = {
    green: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    indigo: 'bg-indigo-100 text-indigo-700',
    slate: 'bg-slate-100 text-slate-600',
  }[variant]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {label}
    </span>
  )
}

export default function ModelsPage() {
  const [data, setData] = useState<Paginated<ModelPricing> | null>(null)
  const [modelStats, setModelStats] = useState<{ counts: Record<string, number>; last_updated: string | null } | null>(null)
  const [providers, setProviders] = useState<string[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [provider, setProvider] = useState('')
  const [category, setCategory] = useState('')
  const [page, setPage] = useState(1)

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    api.models({
      search: search || null,
      provider: provider || null,
      category: category || null,
      status: 'active',
      page,
      page_size: PAGE_SIZE,
    })
      .then(d => { setData(d); setLoading(false) })
      .catch((e: Error) => { setError(e.message); setLoading(false) })
  }, [search, provider, category, page])

  useEffect(() => {
    Promise.all([api.providers(), api.categories(), api.modelStats()])
      .then(([p, c, s]) => {
        setProviders(p)
        setCategories(c)
        setModelStats(s)
        if (p.length > 0) {
          setProvider(prev => (prev && p.includes(prev) ? prev : p[0]))
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0

  const selectCls = 'border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500'

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Models</h1>
        {modelStats && (
          <div className="flex items-center gap-4 mt-1">
            <p className="text-slate-500">
              {data ? `${data.total.toLocaleString()} models` : 'Loading...'}
            </p>
            {Object.entries(modelStats.counts).map(([router, count]) => (
              <span key={router} className="text-xs text-slate-400">
                {router}: {count}
              </span>
            ))}
            {modelStats.last_updated && (
              <span className="text-xs text-slate-400">
                Updated: {new Date(modelStats.last_updated).toLocaleDateString()}
              </span>
            )}
          </div>
        )}
        {!modelStats && (
          <p className="text-slate-500 mt-1">
            {data ? `${data.total.toLocaleString()} models` : 'Browse and filter available models'}
          </p>
        )}
      </div>

      <ProviderKeyBanner className="mb-6" />

      {!loading && data && data.total === 0 && !search && !provider && !category && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-6">
          <EmptyState
            icon="models"
            title="No models in catalogue"
            description="Sync from OpenRouter to load pricing and context sizes. Groq keys load four fixed models automatically on activation."
            actions={[
              { label: 'Sync models', href: '/settings?tab=sync', primary: true },
              { label: 'API keys', href: '/settings?tab=keys' },
            ]}
          />
        </div>
      )}

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 mb-6 flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search provider, model, description…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-48 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <select value={provider} onChange={e => { setProvider(e.target.value); setPage(1) }} className={selectCls}>
          <option value="">All Providers</option>
          {providers.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={category} onChange={e => { setCategory(e.target.value); setPage(1) }} className={selectCls}>
          <option value="">All Categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button onClick={() => { setSearch(''); setProvider(''); setCategory(''); setPage(1) }}
          className="px-3 py-2 text-sm text-slate-500 hover:text-slate-800 border border-slate-300 rounded-lg">
          Reset
        </button>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                {['Router', 'Provider / Model', 'Category', 'Context Size', 'Input $/M', 'Output $/M'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading && (
                <tr><td colSpan={6} className="px-4 py-12 text-center">
                  <div className="inline-block w-6 h-6 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                </td></tr>
              )}
              {!loading && data?.items.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400 text-sm">No models found.</td></tr>
              )}
              {!loading && data?.items.map((m, i) => (
                <tr key={i} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <Badge label={m.router} variant="slate" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{m.provider}</div>
                    <div className="font-mono text-xs text-slate-400 mt-0.5 max-w-xs truncate">{m.model}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{m.category ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-slate-600">{fmtCtx(m.context_length)}</td>
                  <td className="px-4 py-3">{fmtCost(m.input_per_million)}</td>
                  <td className="px-4 py-3">{fmtCost(m.output_per_million)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Page {page} of {totalPages} · {data?.total.toLocaleString()} results
            </p>
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
