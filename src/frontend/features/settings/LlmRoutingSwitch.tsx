'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { LlmRoutingStatus } from '@/lib/types'
import { Spinner } from '@/components/Spinner'

type Props = {
  onRoutingChange?: () => void
}

export function LlmRoutingSwitch({ onRoutingChange }: Props) {
  const [status, setStatus] = useState<LlmRoutingStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [switching, setSwitching] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    api.keys
      .routing()
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function selectRouting(routing: 'openrouter' | 'groq') {
    if (!status || status.active_routing === routing) return
    const lane = status[routing]
    if (!lane.configured) {
      setError(`Add a ${routing === 'groq' ? 'Groq' : 'OpenRouter'} key below first.`)
      return
    }
    setSwitching(routing)
    setError('')
    try {
      const next = await api.keys.setRouting(routing)
      setStatus(next)
      onRoutingChange?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch provider')
    } finally {
      setSwitching(null)
    }
  }

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-5 py-4 flex items-center gap-2 text-sm text-slate-500">
        <Spinner sm /> Loading provider routing…
      </div>
    )
  }

  if (!status) return null

  const lanes: { id: 'openrouter' | 'groq'; title: string; subtitle: string }[] = [
    {
      id: 'openrouter',
      title: 'OpenRouter',
      subtitle: 'Full synced catalogue (OpenAI, Anthropic, Google, …)',
    },
    {
      id: 'groq',
      title: 'Groq',
      subtitle: 'Four hosted models (Llama 3.1/3.3, GPT OSS 120B/20B)',
    },
  ]

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm">
      <div className="px-5 py-3.5 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-slate-800">LLM provider for chat</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Enable OpenRouter or Groq for chat and routing. You can store both keys; only one is active at a time.
        </p>
      </div>
      <div className="px-5 py-4 grid sm:grid-cols-2 gap-3">
        {lanes.map(lane => {
          const info = status[lane.id]
          const enabled = status.active_routing === lane.id
          const busy = switching === lane.id
          return (
            <div
              key={lane.id}
              className={`rounded-lg border p-4 transition-colors ${
                enabled
                  ? lane.id === 'groq'
                    ? 'border-indigo-300 bg-indigo-50'
                    : 'border-emerald-300 bg-emerald-50'
                  : 'border-slate-200 bg-slate-50/50'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{lane.title}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{lane.subtitle}</p>
                  {info.configured ? (
                    <p className="text-xs text-slate-400 mt-1 truncate">
                      {info.key_name}
                      {info.key_preview ? ` · ${info.key_preview}` : ''}
                    </p>
                  ) : (
                    <p className="text-xs text-amber-700 mt-1">No key saved</p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={!info.configured || busy}
                  onClick={() => selectRouting(lane.id)}
                  title={
                    !info.configured
                      ? 'Add a key for this provider first'
                      : enabled
                        ? 'Currently active'
                        : `Use ${lane.title} for chat`
                  }
                  className="relative shrink-0 disabled:opacity-40"
                  aria-label={`${enabled ? 'Disable' : 'Enable'} ${lane.title}`}
                >
                  <div
                    className={`w-10 h-6 rounded-full transition-colors ${
                      enabled
                        ? lane.id === 'groq'
                          ? 'bg-indigo-600'
                          : 'bg-emerald-600'
                        : 'bg-slate-300'
                    }`}
                  />
                  <div
                    className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                      enabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              {enabled && (
                <span
                  className={`inline-block mt-2 px-2 py-0.5 rounded-full text-xs font-medium ${
                    lane.id === 'groq'
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'bg-emerald-100 text-emerald-700'
                  }`}
                >
                  Active for chat
                </span>
              )}
            </div>
          )
        })}
      </div>
      {error && (
        <p className="px-5 pb-3 text-xs text-red-600">{error}</p>
      )}
    </section>
  )
}
