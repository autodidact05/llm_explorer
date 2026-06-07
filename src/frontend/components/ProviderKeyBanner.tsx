'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import type { ActiveKeyContext } from '@/lib/types'
import { fmtUsd } from '@/lib/format'

type Props = {
  compact?: boolean
  className?: string
  /** Bump to refetch active-context after routing/key changes. */
  refreshToken?: number
}

export function ProviderKeyBanner({ compact = false, className = '', refreshToken = 0 }: Props) {
  const [ctx, setCtx] = useState<ActiveKeyContext | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.keys.activeContext()
      .then(setCtx)
      .catch(() => setCtx(null))
      .finally(() => setLoading(false))
  }, [refreshToken])

  if (loading || !ctx) return null

  const misconfigured = ctx.guide.misconfigured === true
  const variant = !ctx.has_active_key
    ? 'amber'
    : misconfigured
      ? 'red'
      : ctx.routing === 'groq'
        ? 'indigo'
        : 'emerald'

  const border = {
    amber: 'border-amber-200 bg-amber-50',
    red: 'border-red-200 bg-red-50',
    indigo: 'border-indigo-200 bg-indigo-50',
    emerald: 'border-emerald-200 bg-emerald-50',
  }[variant]

  const titleCls = {
    amber: 'text-amber-900',
    red: 'text-red-900',
    indigo: 'text-indigo-900',
    emerald: 'text-emerald-900',
  }[variant]

  const bodyCls = {
    amber: 'text-amber-800',
    red: 'text-red-800',
    indigo: 'text-indigo-800',
    emerald: 'text-emerald-800',
  }[variant]

  const balance = ctx.balance
  let balanceLine: string | null = null
  if (balance.available && balance.remaining_usd != null) {
    balanceLine = `Remaining: ~${fmtUsd(balance.remaining_usd)}`
  } else if (balance.message) {
    balanceLine = balance.message
  }

  if (compact) {
    return (
      <div className={`rounded-lg border px-3 py-2 text-xs ${border} ${className}`}>
        <span className={`font-medium ${titleCls}`}>{ctx.guide.title}</span>
        {ctx.has_active_key && (
          <span className={`ml-2 ${bodyCls}`}>
            · {ctx.models.total} model{ctx.models.total === 1 ? '' : 's'} available
          </span>
        )}
        {balanceLine && <p className={`mt-1 ${bodyCls}`}>{balanceLine}</p>}
      </div>
    )
  }

  return (
    <div className={`rounded-xl border px-4 py-3 ${border} ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold ${titleCls}`}>{ctx.guide.title}</p>
          <p className={`text-xs mt-1 ${bodyCls}`}>{ctx.guide.summary}</p>
          {ctx.has_active_key && (
            <p className={`text-xs mt-2 ${bodyCls}`}>
              <span className="font-medium">{ctx.models.total}</span> catalogue model
              {ctx.models.total === 1 ? '' : 's'}
              {ctx.models.filter_hint
                ? ` (provider: ${ctx.models.filter_hint})`
                : ''}
              {ctx.guide.chat_model_hint ? ` — ${ctx.guide.chat_model_hint}` : ''}
            </p>
          )}
          {ctx.models.sample.length > 0 && !compact && (
            <p className={`text-xs mt-1 font-mono ${bodyCls} opacity-90`}>
              e.g. {ctx.models.sample.slice(0, 4).map(m => `${m.provider}/${m.model}`).join(', ')}
            </p>
          )}
          {balanceLine && (
            <p className={`text-xs mt-2 font-medium ${bodyCls}`}>{balanceLine}</p>
          )}
          {ctx.guide.tips.length > 0 && (
            <ul className={`mt-2 text-xs list-disc list-inside space-y-0.5 ${bodyCls}`}>
              {ctx.guide.tips.slice(0, 3).map(t => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
        </div>
        {(!ctx.has_active_key || misconfigured) && (
          <Link
            href="/settings?tab=keys"
            className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50"
          >
            Fix in Settings
          </Link>
        )}
      </div>
    </div>
  )
}
