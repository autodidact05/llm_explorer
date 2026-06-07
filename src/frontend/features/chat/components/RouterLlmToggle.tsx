'use client'

import { useRouter } from 'next/navigation'

type Props = {
  routerLlmGlobal: boolean
  useRouterLlm: boolean
  setUseRouterLlm: (value: boolean | ((prev: boolean) => boolean)) => void
  variant?: 'composer' | 'panel'
}

export function RouterLlmToggle({
  routerLlmGlobal,
  useRouterLlm,
  setUseRouterLlm,
  variant = 'composer',
}: Props) {
  const router = useRouter()
  const active = routerLlmGlobal && useRouterLlm

  function handleClick() {
    if (!routerLlmGlobal) {
      router.push('/settings?tab=chat')
      return
    }
    setUseRouterLlm(v => !v)
  }

  const title = !routerLlmGlobal
    ? 'Router LLM is off globally — open Settings → LLMs to enable'
    : useRouterLlm
      ? 'Router LLM on — click to disable for this session'
      : 'Router LLM off — click to enable for this session'

  if (variant === 'panel') {
    return (
      <div className="flex items-center justify-between py-2 px-3 bg-slate-50 border border-slate-200 rounded-lg">
        <div>
          <p className="text-sm font-medium text-slate-700">Use Router LLM</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {routerLlmGlobal
              ? 'Automatically selects the best model for each message'
              : 'Enable in Settings → LLMs, then toggle here'}
          </p>
        </div>
        <button
          type="button"
          onClick={handleClick}
          className="relative shrink-0 ml-3"
          aria-label="Toggle Router LLM"
          title={title}
        >
          <div
            className={`w-10 h-6 rounded-full transition-colors ${
              active ? 'bg-indigo-600' : routerLlmGlobal ? 'bg-slate-300' : 'bg-slate-200'
            }`}
          />
          <div
            className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
              active ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title={title}
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors shrink-0 ${
        active
          ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
          : routerLlmGlobal
            ? 'bg-slate-50 border-slate-200 text-slate-500 hover:text-slate-700'
            : 'bg-slate-50 border-slate-200 text-slate-400 hover:text-slate-600'
      }`}
    >
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
      {active ? 'Router LLM' : routerLlmGlobal ? 'Router LLM off' : 'Router LLM'}
    </button>
  )
}
