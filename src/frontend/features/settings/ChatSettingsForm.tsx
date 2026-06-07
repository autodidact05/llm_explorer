'use client'

export function ChatSettingsForm({
  genericSysMsg,
  setGenericSysMsg,
  routerLlmEnabled,
  setRouterLlmEnabled,
  routerLlmProvider,
  setRouterLlmProvider,
  routerLlmModel,
  setRouterLlmModel,
  routerSysMsg,
  setRouterSysMsg,
  saving,
  message,
  onSubmit,
  btnPrimaryClass,
}: {
  genericSysMsg: string
  setGenericSysMsg: (v: string) => void
  routerLlmEnabled: boolean
  setRouterLlmEnabled: (v: boolean) => void
  routerLlmProvider: string
  setRouterLlmProvider: (v: string) => void
  routerLlmModel: string
  setRouterLlmModel: (v: string) => void
  routerSysMsg: string
  setRouterSysMsg: (v: string) => void
  saving: boolean
  message: string
  onSubmit: (e: React.FormEvent) => void
  btnPrimaryClass: string
}) {
  const routerModelDisplay = routerLlmProvider && routerLlmModel
    ? `${routerLlmProvider}/${routerLlmModel}`
    : 'openai/gpt-4o-mini'

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* Answering LLM */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 border-t border-slate-200" />
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-2">Answering LLM</span>
          <div className="flex-1 border-t border-slate-200" />
        </div>

        <section className="bg-white border border-slate-200 rounded-xl shadow-sm">
          <div className="px-5 py-3.5 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-800">Generic System Message</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Applied to every conversation unless overridden by a per-conversation system message.
            </p>
          </div>
          <div className="px-5 py-4">
            <textarea
              value={genericSysMsg}
              onChange={e => setGenericSysMsg(e.target.value)}
              rows={5}
              placeholder="e.g. You are a helpful assistant. Always respond concisely."
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="mt-1.5 text-xs text-slate-400">
              Leave blank for no generic system message. Today&apos;s date is always appended automatically.
            </p>
          </div>
        </section>
      </div>

      {/* Router LLM */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 border-t border-slate-200" />
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-2">Router LLM</span>
          <div className="flex-1 border-t border-slate-200" />
        </div>

        <section className="bg-white border border-slate-200 rounded-xl shadow-sm">
          <div className="px-5 py-3.5 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-800">Router LLM Routing</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              When enabled, <code className="bg-slate-100 px-1 py-0.5 rounded">{routerModelDisplay}</code> evaluates
              each message and routes it to the best Answering LLM. The routing decision and final answer are both audited.
            </p>
          </div>
          <div className="px-5 py-4">
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <div className="relative w-10 h-6 shrink-0">
                <input
                  type="checkbox"
                  checked={routerLlmEnabled}
                  onChange={e => setRouterLlmEnabled(e.target.checked)}
                  className="sr-only"
                />
                <div className={`absolute inset-0 rounded-full transition-colors ${routerLlmEnabled ? 'bg-indigo-600' : 'bg-slate-300'}`} />
                <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${routerLlmEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
              </div>
              <span className="text-sm font-medium text-slate-700">
                {routerLlmEnabled ? 'Router LLM routing enabled' : 'Router LLM routing disabled'}
              </span>
            </label>
            {routerLlmEnabled && (
              <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                If <code className="text-xs">{routerModelDisplay}</code> is unavailable, routing falls back to your manually selected model.
              </p>
            )}
          </div>
        </section>

        <section className="mt-4 bg-white border border-slate-200 rounded-xl shadow-sm">
          <div className="px-5 py-3.5 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-800">Router LLM Model</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              The model used to analyze and route each message. Must be accessible via your configured API key.
            </p>
          </div>
          <div className="px-5 py-4 space-y-3">
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-slate-600 mb-1">Provider</label>
                <input
                  type="text"
                  value={routerLlmProvider}
                  onChange={e => setRouterLlmProvider(e.target.value)}
                  placeholder="openai"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="flex-[2]">
                <label className="block text-xs font-medium text-slate-600 mb-1">Model</label>
                <input
                  type="text"
                  value={routerLlmModel}
                  onChange={e => setRouterLlmModel(e.target.value)}
                  placeholder="gpt-4o-mini"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            <p className="text-xs text-slate-400">
              Default: <code className="bg-slate-100 px-1 py-0.5 rounded">openai/gpt-4o-mini</code>.
              Use any synced catalogue model, e.g.{' '}
              <code className="bg-slate-100 px-1 py-0.5 rounded">amazon/nova-2-lite-v1</code>,{' '}
              <code className="bg-slate-100 px-1 py-0.5 rounded">google/gemini-2.5-flash</code>,{' '}
              <code className="bg-slate-100 px-1 py-0.5 rounded">amazon/nova-premier-v1</code>,{' '}
              <code className="bg-slate-100 px-1 py-0.5 rounded">anthropic/claude-haiku-4</code>.
            </p>
          </div>
        </section>

        <section className="mt-4 bg-white border border-slate-200 rounded-xl shadow-sm">
          <div className="px-5 py-3.5 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-800">Router LLM System Message</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Instructions the Router LLM follows when evaluating and routing each message.
            </p>
          </div>
          <div className="px-5 py-4">
            <textarea
              value={routerSysMsg}
              onChange={e => setRouterSysMsg(e.target.value)}
              rows={5}
              placeholder="You are Router LLM, an intelligent model routing and orchestration system. Your responsibility is to analyze the user's request and select the most appropriate LLM to generate the final response…"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="mt-1.5 text-xs text-slate-400">
              Leave blank to use the built-in default instructions.
            </p>
          </div>
        </section>
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className={btnPrimaryClass}>
          {saving ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Saving…
            </span>
          ) : 'Save Chat Settings'}
        </button>
        {message && (
          <span className={`text-xs ${message === 'Saved.' ? 'text-emerald-600' : 'text-red-600'}`}>
            {message}
          </span>
        )}
      </div>
    </form>
  )
}
