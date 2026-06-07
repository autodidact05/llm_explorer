'use client'

import type { OllamaStatus, OllamaSyncResult } from '@/lib/types'

export function OllamaSection({
  ollamaStatus,
  ollamaSyncing,
  ollamaSyncResult,
  ollamaError,
  onSync,
  onRecheck,
  btnSecondaryClass,
}: {
  ollamaStatus: OllamaStatus | null
  ollamaSyncing: boolean
  ollamaSyncResult: OllamaSyncResult | null
  ollamaError: string
  onSync: () => void
  onRecheck: () => void
  btnSecondaryClass: string
}) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Ollama Local Models</h2>
          <p className="text-xs text-slate-500 mt-0.5">Sync models from a locally running Ollama instance</p>
        </div>
        {ollamaStatus && (
          <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
            ollamaStatus.available
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-slate-100 text-slate-500'
          }`}>
            {ollamaStatus.available
              ? `${ollamaStatus.model_count} model${ollamaStatus.model_count !== 1 ? 's' : ''} available`
              : 'Not running'}
          </span>
        )}
      </div>
      <div className="px-5 py-4 space-y-3">
        {ollamaStatus && !ollamaStatus.available && (
          <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            Ollama is not detected at <code className="font-mono">localhost:11434</code>.
            Install Ollama and pull a model, then come back to sync.
          </p>
        )}
        <div className="flex items-center gap-3">
          <button onClick={onSync} disabled={ollamaSyncing || !ollamaStatus?.available} className={btnSecondaryClass}>
            {ollamaSyncing ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
                Syncing…
              </span>
            ) : 'Sync Ollama Models'}
          </button>
          <button onClick={onRecheck} className="text-xs text-slate-500 hover:text-slate-700 underline">
            Re-check status
          </button>
        </div>
        {ollamaSyncResult && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs text-emerald-700">
            Synced {ollamaSyncResult.synced} models · {ollamaSyncResult.expired} expired
          </div>
        )}
        {ollamaError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">{ollamaError}</div>
        )}
      </div>
    </section>
  )
}

