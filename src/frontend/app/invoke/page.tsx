'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { InvokeResult, ModelPricing } from '@/lib/types'
import { fmtUsd as fmtCost } from '@/lib/format'

export default function InvokePage() {
  const [providers, setProviders] = useState<string[]>([])
  const [models, setModels] = useState<ModelPricing[]>([])
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<InvokeResult | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.providers().then(setProviders).catch(() => {})
  }, [])

  useEffect(() => {
    if (providers.length === 0) return
    if (!provider || !providers.includes(provider)) {
      setProvider(providers[0])
    }
  }, [providers, provider])

  useEffect(() => {
    if (!provider) { setModels([]); setModel(''); return }
    api.models({ provider, status: 'active', page_size: 200 })
      .then(d => {
        setModels(d.items)
        setModel(prev => d.items.some(m => m.model === prev) ? prev : (d.items[0]?.model ?? ''))
      })
      .catch(() => {})
  }, [provider])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!provider || !model || !prompt.trim()) return
    setLoading(true)
    setResult(null)
    setError('')
    try {
      const r = await api.invoke(provider, model, prompt)
      setResult(r)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const selectCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500'
  const btnCls = 'px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Invoke LLM</h1>
        <p className="text-slate-500 mt-1">Send a prompt to any model via OpenRouter</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Provider</label>
            <select value={provider} onChange={e => setProvider(e.target.value)} className={selectCls} required>
              <option value="">Select provider…</option>
              {providers.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Model</label>
            <select value={model} onChange={e => setModel(e.target.value)} className={selectCls}
              required disabled={!provider || models.length === 0}>
              <option value="">{!provider ? 'Select provider first' : models.length === 0 ? 'Loading…' : 'Select model…'}</option>
              {models.map(m => (
                <option key={m.model} value={m.model}>
                  {m.model}{m.input_per_million === 0 ? ' (free)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Prompt</label>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={6}
            placeholder="Enter your prompt here…"
            required
            className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={loading || !provider || !model || !prompt.trim()} className={btnCls}>
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Invoking…
              </span>
            ) : 'Send Prompt'}
          </button>
          {result && (
            <button type="button" onClick={() => { setResult(null); setError('') }}
              className="px-4 py-2.5 text-sm text-slate-500 hover:text-slate-700 border border-slate-300 rounded-lg">
              Clear
            </button>
          )}
        </div>
      </form>

      {error && (
        <div className="mt-4 bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>
      )}

      {result && (
        <div className="mt-6 space-y-4">
          {/* Response */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-6 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">Response</h2>
              <span className="text-xs text-slate-400">Event #{result.event_id}</span>
            </div>
            <div className="px-6 py-4 text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
              {result.content}
            </div>
          </div>

          {/* Stats */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Usage Stats</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Prompt Tokens', value: result.prompt_tokens.toLocaleString() },
                { label: 'Response Tokens', value: result.response_tokens.toLocaleString() },
                { label: 'Total Cost', value: fmtCost(result.total_cost) },
                { label: 'Time', value: `${result.time_taken.toFixed(2)}s` },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-xs text-slate-400">{label}</p>
                  <p className="mt-0.5 font-mono font-semibold text-slate-800">{value}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-slate-400">Input cost: </span>
                <span className="font-mono">{fmtCost(result.input_cost)}</span>
              </div>
              <div>
                <span className="text-slate-400">Output cost: </span>
                <span className="font-mono">{fmtCost(result.output_cost)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
