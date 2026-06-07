'use client'

import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type {
  Stats, SpendingTrendPoint,
  ChatConversationSummary, ChatConversationDetail, ChatSessionDetail,
} from '@/lib/types'
import { useCurrencyPreference, useTimezone, formatDate } from '@/lib/hooks'
import { fmtUsd as fmtCostRaw } from '@/lib/format'
import { Spinner } from '@/components/Spinner'
import { EmptyState } from '@/components/EmptyState'
import { ProviderKeyBanner } from '@/components/ProviderKeyBanner'

type TrendPeriod = 'hourly' | '7d' | '14d' | '4w'

function parseTrendDate(dateStr: string, hourly: boolean): Date | null {
  if (!dateStr) return null
  if (hourly) {
    const iso =
      dateStr.includes('T')
        ? dateStr.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(dateStr)
          ? dateStr
          : `${dateStr}Z`
        : `${dateStr}T00:00:00Z`
    const dt = new Date(iso)
    return Number.isNaN(dt.getTime()) ? null : dt
  }
  const day = dateStr.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const dt = new Date(`${day}T12:00:00Z`)
  return Number.isNaN(dt.getTime()) ? null : dt
}

function formatTrendLabel(dateStr: string, hourly: boolean, timezone: string): string {
  const dt = parseTrendDate(dateStr, hourly)
  if (!dt) return dateStr.slice(0, 10) || '—'
  const tz = timezone || 'UTC'
  try {
    if (hourly) {
      const parts = new Intl.DateTimeFormat('en-US', {
        hour: '2-digit',
        hour12: false,
        timeZone: tz,
      }).formatToParts(dt)
      const h = parts.find(p => p.type === 'hour')?.value ?? '00'
      return (h === '24' ? '00' : h.padStart(2, '0')) + ':00'
    }
    const parts = new Intl.DateTimeFormat('en-US', {
      month: '2-digit',
      day: '2-digit',
      timeZone: tz,
    }).formatToParts(dt)
    const m = parts.find(p => p.type === 'month')?.value ?? ''
    const day = parts.find(p => p.type === 'day')?.value ?? ''
    return `${m}-${day}`
  } catch {
    return dateStr.slice(0, 10)
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatCard({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
      <p className="text-sm text-slate-500 font-medium">{title}</p>
      <p className="mt-2 text-2xl font-bold text-slate-900 tracking-tight leading-tight">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </div>
  )
}

function LoadingSpinner() {
  return (
    <div className="flex justify-center py-16 text-indigo-600">
      <Spinner />
    </div>
  )
}

// ── Bar chart (pure SVG) ──────────────────────────────────────────────────────

function SpendingChart({ data, period, timezone }: { data: SpendingTrendPoint[]; period: TrendPeriod; timezone: string }) {
  const maxCost = Math.max(...data.map(d => d.cost), 0.000001)
  const W = 640
  const H = 180
  const PAD_L = 8
  const PAD_R = 8
  const LABEL_AREA = 28
  const bars = data.length
  const slotW = (W - PAD_L - PAD_R) / bars
  const barW = Math.max(slotW - 8, 4)
  // Show at most 8 labels so they never crowd each other
  const labelEvery = Math.ceil(bars / 8)

  const hourly = period === 'hourly'
  function label(d: SpendingTrendPoint): string {
    return formatTrendLabel(d.date, hourly, timezone)
  }

  return (
    <svg viewBox={`0 0 ${W} ${H + LABEL_AREA}`} className="w-full" style={{ height: H + LABEL_AREA }}>
      {data.map((d, i) => {
        const x = PAD_L + i * slotW
        const barH = Math.max((d.cost / maxCost) * H, d.cost > 0 ? 2 : 0)
        const y = H - barH
        const centerX = x + slotW / 2
        const showLabel = i % labelEvery === 0

        return (
          <g key={d.date}>
            {/* Bar */}
            <rect
              x={centerX - barW / 2}
              y={y}
              width={barW}
              height={barH}
              rx={4}
              className={barH > 0 ? 'fill-indigo-500' : 'fill-slate-100'}
            />
            {/* Cost label above bar */}
            {d.cost > 0 && (
              <text
                x={centerX}
                y={y - 5}
                textAnchor="middle"
                fontSize={9}
                className="fill-slate-500"
              >
                {d.cost < 0.001 ? d.cost.toFixed(6) : d.cost.toFixed(4)}
              </text>
            )}
            {/* Date label below */}
            {showLabel && (
              <text
                x={centerX}
                y={H + 18}
                textAnchor="middle"
                fontSize={11}
                className="fill-slate-500"
              >
                {label(d)}
              </text>
            )}
          </g>
        )
      })}
      {/* Baseline */}
      <line x1={PAD_L} y1={H} x2={W - PAD_R} y2={H} stroke="#e2e8f0" strokeWidth={1} />
    </svg>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState('')
  const [trend, setTrend] = useState<SpendingTrendPoint[] | null>(null)
  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>('14d')

  // ── Hierarchy state ───────────────────────────────────────────────────────
  const [convPage, setConvPage] = useState(1)
  const [convTotal, setConvTotal] = useState(0)
  const [convItems, setConvItems] = useState<ChatConversationSummary[]>([])
  const [convLoading, setConvLoading] = useState(false)
  const [expandedConvs, setExpandedConvs] = useState<Set<number>>(new Set())
  const [convDetails, setConvDetails] = useState<Record<number, ChatConversationDetail>>({})
  const [expandedSessions, setExpandedSessions] = useState<Set<number>>(new Set())
  const [sessionDetails, setSessionDetails] = useState<Record<number, ChatSessionDetail>>({})
  const [expandedInteractions, setExpandedInteractions] = useState<Set<number>>(new Set())
  const [ratingDraft, setRatingDraft] = useState<Record<number, { rating: number; comment: string }>>({})
  const [ratingSaving, setRatingSaving] = useState<Set<number>>(new Set())
  const loadingConvsRef = useRef<Set<number>>(new Set())
  const loadingSessionsRef = useRef<Set<number>>(new Set())

  const { fmtCost, meta: currencyMeta, rates } = useCurrencyPreference()
  const { timezone } = useTimezone()

  useEffect(() => {
    api.stats().then(setStats).catch((e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    setConvLoading(true)
    api.chat.listConversations({ page: convPage, page_size: 10 })
      .then(d => { setConvItems(d.items); setConvTotal(d.total); setConvLoading(false) })
      .catch(() => setConvLoading(false))
  }, [convPage])

  useEffect(() => {
    let active = true
    setTrend(null)

    const apply = (data: SpendingTrendPoint[]) => {
      if (active) setTrend(data)
    }

    if (trendPeriod === 'hourly') {
      api.trendHourly().then(apply).catch(() => apply([]))
    } else if (trendPeriod === '4w') {
      api.trend(28).then(trendData => {
        if (!active) return
        const weeks: SpendingTrendPoint[] = []
        for (let i = 0; i < trendData.length; i += 7) {
          const slice = trendData.slice(i, i + 7)
          if (slice.length === 0) continue
          weeks.push({
            date: slice[0].date,
            cost: slice.reduce((s, d) => s + d.cost, 0),
            queries: slice.reduce((s, d) => s + d.queries, 0),
          })
        }
        apply(weeks)
      }).catch(() => apply([]))
    } else {
      const days = trendPeriod === '7d' ? 7 : 14
      api.trend(days).then(apply).catch(() => apply([]))
    }

    return () => {
      active = false
    }
  }, [trendPeriod])

  const totalQueries = stats?.total_queries ?? 0
  const totalCost = stats?.total_cost ?? 0
  const creditBalance = stats?.wallet_balance ?? stats?.credit_balance ?? 0

  function toggleConv(id: number) {
    setExpandedConvs(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id); return next }
      next.add(id)
      if (!convDetails[id] && !loadingConvsRef.current.has(id)) {
        loadingConvsRef.current.add(id)
        api.chat.getConversation(id).then(d => {
          setConvDetails(prev2 => ({ ...prev2, [id]: d }))
          loadingConvsRef.current.delete(id)
        }).catch(() => loadingConvsRef.current.delete(id))
      }
      return next
    })
  }

  function toggleSession(id: number) {
    setExpandedSessions(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id); return next }
      next.add(id)
      if (!sessionDetails[id] && !loadingSessionsRef.current.has(id)) {
        loadingSessionsRef.current.add(id)
        api.chat.getSession(id).then(d => {
          setSessionDetails(prev2 => ({ ...prev2, [id]: d }))
          loadingSessionsRef.current.delete(id)
        }).catch(() => loadingSessionsRef.current.delete(id))
      }
      return next
    })
  }

  function toggleInteraction(id: number) {
    setExpandedInteractions(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleSaveRating(interactionId: number) {
    const draft = ratingDraft[interactionId]
    if (!draft?.rating) return
    setRatingSaving(prev => { const next = new Set(prev); next.add(interactionId); return next })
    try {
      await api.chat.rateInteraction(interactionId, {
        rating: draft.rating,
        comment: draft.comment || undefined,
      })
      setSessionDetails(prev => {
        const next: typeof prev = {}
        for (const [sid, detail] of Object.entries(prev)) {
          next[Number(sid)] = {
            ...detail,
            interactions: detail.interactions.map(i =>
              i.id === interactionId
                ? { ...i, rating: draft.rating, rating_comment: draft.comment || null }
                : i
            ),
          }
        }
        return next
      })
      setRatingDraft(prev => { const next = { ...prev }; delete next[interactionId]; return next })
    } catch {
      // silent
    } finally {
      setRatingSaving(prev => { const next = new Set(prev); next.delete(interactionId); return next })
    }
  }

  function fmtCostBig(n: number) {
    const usd = fmtCostRaw(n)
    if (!currencyMeta || !rates[currencyMeta.code]) return usd
    const converted = Math.abs(n) * rates[currencyMeta.code]
    const convStr = converted >= 100 ? converted.toFixed(2) : converted.toFixed(currencyMeta.decimals)
    return `${usd}\n${currencyMeta.symbol}${convStr}`
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-500 mt-1">Overview of your LLM usage and costs</p>
        {currencyMeta && rates[currencyMeta.code] && (
          <p className="text-xs text-slate-400 mt-0.5">
            1 USD = {rates[currencyMeta.code].toFixed(4)} {currencyMeta.code}
            {' · '}
            <a href="/settings" className="underline hover:text-slate-600">Change currency in Settings</a>
          </p>
        )}
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {error} — make sure the API server is running on port 8000.
        </div>
      )}

      <ProviderKeyBanner className="mb-6" />

      {!stats && !error && <LoadingSpinner />}

      {stats && totalQueries === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-8">
          <EmptyState
            icon="chart"
            title="No LLM usage yet"
            description="Send your first chat message or run the Invoke playground to see costs and trends here."
            actions={[
              { label: 'Start chat', href: '/chat', primary: true },
              { label: 'Add API key', href: '/settings?tab=keys' },
              { label: 'Sync models', href: '/settings?tab=sync' },
            ]}
          />
        </div>
      )}

      {stats && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatCard title="Total Queries" value={totalQueries.toLocaleString()} />
            <StatCard
              title="Total Cost"
              value={fmtCostBig(totalCost).split('\n')[0]}
              sub={[
                `${stats.total_tokens.toLocaleString()} tokens`,
                fmtCostBig(totalCost).split('\n')[1],
              ].filter(Boolean).join(' · ')}
            />
            <StatCard
              title="Active Models"
              value={stats.active_models.toLocaleString()}
              sub={`${stats.expired_models} expired`}
            />
            <StatCard
              title="Wallet Balance"
              value={fmtCostBig(creditBalance).split('\n')[0]}
              sub={[
                `Avg ${stats.avg_time_taken.toFixed(2)}s / call`,
                fmtCostBig(creditBalance).split('\n')[1],
              ].filter(Boolean).join(' · ')}
            />
          </div>

          {/* Spending trend */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-8">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-800">Spending Trend</h2>
              <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs">
                {([
                  { id: 'hourly', label: '24 Hours' },
                  { id: '7d',     label: '7 Days' },
                  { id: '14d',    label: '14 Days' },
                  { id: '4w',     label: '4 Weeks' },
                ] as { id: TrendPeriod; label: string }[]).map(p => (
                  <button
                    key={p.id}
                    onClick={() => setTrendPeriod(p.id)}
                    className={`px-3 py-1.5 font-medium transition-colors ${
                      trendPeriod === p.id
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="px-6 py-5">
              {trend === null ? (
                <div className="h-36 flex items-center justify-center">
                  <div className="w-6 h-6 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : trend.length === 0 || trend.every(d => d.cost === 0) ? (
                <p className="text-center text-slate-400 text-sm py-12">No spending data for this period.</p>
              ) : (
                <SpendingChart data={trend} period={trendPeriod} timezone={timezone} />
              )}
              {trend && trend.some(d => d.cost > 0) && (
                <div className="mt-2 flex justify-between text-xs text-slate-400">
                  <span>
                    {{ hourly: '24-hour', '7d': '7-day', '14d': '14-day', '4w': '4-week' }[trendPeriod]} total:{' '}
                    <span className="font-medium text-slate-600">
                      {fmtCost(trend.reduce((s, d) => s + d.cost, 0))}
                    </span>
                  </span>
                  <span>
                    {trend.reduce((s, d) => s + d.queries, 0)} queries
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Recent Usage hierarchy */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-8">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-800">Recent Usage</h2>
              <span className="text-xs text-slate-400">{convTotal} conversation{convTotal !== 1 ? 's' : ''}</span>
            </div>
            {convLoading && convItems.length === 0 ? (
              <div className="flex justify-center py-8"><div className="w-6 h-6 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" /></div>
            ) : convItems.length === 0 ? (
              <p className="px-6 py-8 text-center text-slate-400 text-sm">No conversations yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {convItems.map(conv => {
                  const isOpen = expandedConvs.has(conv.id)
                  const detail = convDetails[conv.id]
                  return (
                    <div key={conv.id}>
                      {/* Conversation row */}
                      <button
                        onClick={() => toggleConv(conv.id)}
                        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
                      >
                        <span className="text-slate-400 text-xs w-4">{isOpen ? '▼' : '▶'}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">
                            {conv.title ?? `Conversation #${conv.id}`}
                          </p>
                          <p className="text-xs text-slate-400">
                            {conv.session_count} session{conv.session_count !== 1 ? 's' : ''}
                            {' · '}{conv.message_count} message{conv.message_count !== 1 ? 's' : ''}
                            {' · '}{formatDate(conv.created_at, timezone)}
                          </p>
                        </div>
                        <span className={`shrink-0 text-xs font-mono font-medium ${conv.total_cost > 0 ? 'text-slate-700' : 'text-slate-400'}`}>
                          {fmtCost(conv.total_cost)}
                        </span>
                        <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${conv.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          {conv.status}
                        </span>
                      </button>

                      {/* Sessions */}
                      {isOpen && (
                        <div className="bg-slate-50 border-t border-slate-100">
                          {!detail ? (
                            <div className="flex justify-center py-4"><div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" /></div>
                          ) : detail.sessions.length === 0 ? (
                            <p className="px-10 py-3 text-xs text-slate-400">No sessions.</p>
                          ) : detail.sessions.map(sess => {
                            const sessOpen = expandedSessions.has(sess.id)
                            const sessDetail = sessionDetails[sess.id]
                            return (
                              <div key={sess.id} className="border-b border-slate-100 last:border-0">
                                <button
                                  onClick={() => toggleSession(sess.id)}
                                  className="w-full flex items-center gap-2 pl-10 pr-4 py-2.5 text-left hover:bg-slate-100 transition-colors"
                                >
                                  <span className="text-slate-400 text-xs w-4">{sessOpen ? '▼' : '▶'}</span>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-slate-700 truncate">
                                      {sess.title ?? `Session #${sess.id}`}
                                    </p>
                                    <p className="text-xs text-slate-400">
                                      {sess.message_count} message{sess.message_count !== 1 ? 's' : ''}
                                      {' · '}{formatDate(sess.created_at, timezone)}
                                    </p>
                                  </div>
                                  <span className="shrink-0 text-xs font-mono text-slate-600">{fmtCost(sess.total_cost)}</span>
                                </button>

                                {/* Interactions */}
                                {sessOpen && (
                                  <div className="bg-white border-t border-slate-100">
                                    {!sessDetail ? (
                                      <div className="flex justify-center py-3"><div className="w-3 h-3 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" /></div>
                                    ) : sessDetail.interactions.length === 0 ? (
                                      <p className="pl-16 pr-4 py-2 text-xs text-slate-400">No interactions.</p>
                                    ) : sessDetail.interactions.map(intr => {
                                      const intrOpen = expandedInteractions.has(intr.id)
                                      const intrMsgs = sessDetail.messages.filter(
                                        m => m.interaction_id === intr.id && m.role === 'assistant' && m.event_id
                                      )
                                      const isRouted = intr.routed_by === 'router_llm'
                                      const selectedRating = ratingDraft[intr.id]?.rating ?? intr.rating ?? null
                                      const currentComment = ratingDraft[intr.id]?.comment ?? (intr.rating_comment ?? '')
                                      return (
                                        <div key={intr.id} className="border-b border-slate-100 last:border-0">
                                          <button
                                            onClick={() => toggleInteraction(intr.id)}
                                            className="w-full flex items-center gap-2 pl-16 pr-4 py-2 text-left hover:bg-slate-50 transition-colors"
                                          >
                                            <span className="text-slate-400 text-xs w-4">{intrOpen ? '▼' : '▶'}</span>
                                            <div className="flex-1 min-w-0">
                                              <p className="text-xs font-medium text-slate-600 truncate flex items-center gap-1.5">
                                                {intr.provider}/{intr.model}
                                                {isRouted && (
                                                  <span className="shrink-0 px-1 py-0.5 rounded text-xs bg-purple-100 text-purple-700 font-normal">Router LLM</span>
                                                )}
                                              </p>
                                              <p className="text-xs text-slate-400">
                                                {intr.message_count} call{intr.message_count !== 1 ? 's' : ''}
                                                {' · '}{intr.total_tokens.toLocaleString()} tokens
                                                {' · '}{intr.avg_time_taken.toFixed(1)}s avg
                                              </p>
                                              {isRouted && (intr.routing_reason || intr.router_estimated_cost || intr.router_confidence != null) && (
                                                <div className="mt-0.5 space-y-0.5">
                                                  {(intr.router_estimated_cost || intr.router_confidence != null) && (
                                                    <p className="text-xs flex items-center gap-1.5">
                                                      {intr.router_estimated_cost && (
                                                        <span className={`px-1 py-0.5 rounded font-medium ${
                                                          intr.router_estimated_cost === 'free' ? 'bg-emerald-100 text-emerald-700' :
                                                          intr.router_estimated_cost === 'low' ? 'bg-teal-100 text-teal-700' :
                                                          intr.router_estimated_cost === 'medium' ? 'bg-amber-100 text-amber-700' :
                                                          intr.router_estimated_cost === 'high' ? 'bg-orange-100 text-orange-700' :
                                                          'bg-red-100 text-red-700'
                                                        }`}>
                                                          {intr.router_estimated_cost}
                                                        </span>
                                                      )}
                                                      {intr.router_confidence != null && (
                                                        <span className="text-slate-400">{Math.round(intr.router_confidence * 100)}% confident</span>
                                                      )}
                                                    </p>
                                                  )}
                                                  {intr.routing_reason && (
                                                    <p className="text-xs text-purple-600 truncate" title={intr.routing_reason}>
                                                      {intr.routing_reason}
                                                    </p>
                                                  )}
                                                </div>
                                              )}
                                            </div>
                                            <span className="shrink-0 text-xs font-mono text-slate-600">{fmtCost(intr.total_cost)}</span>
                                          </button>

                                          {/* Rating widget for master-routed interactions */}
                                          {isRouted && (
                                            <div className="pl-24 pr-4 py-2 bg-purple-50 border-t border-purple-100">
                                              <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-xs text-slate-500 shrink-0">Rate this routing:</span>
                                                {([1, 2, 3] as const).map(r => (
                                                  <button
                                                    key={r}
                                                    onClick={() => setRatingDraft(prev => ({
                                                      ...prev,
                                                      [intr.id]: { rating: r, comment: prev[intr.id]?.comment ?? (intr.rating_comment ?? '') },
                                                    }))}
                                                    className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                                                      selectedRating === r
                                                        ? 'bg-indigo-600 text-white border-indigo-600'
                                                        : 'border-slate-300 text-slate-600 hover:border-indigo-300 bg-white'
                                                    }`}
                                                  >
                                                    {r === 1 ? '1 · Not OK' : r === 2 ? '2 · OK' : '3 · Excellent'}
                                                  </button>
                                                ))}
                                              </div>
                                              {selectedRating != null && (
                                                <div className="mt-1.5 flex items-center gap-2">
                                                  <input
                                                    type="text"
                                                    value={currentComment}
                                                    onChange={e => setRatingDraft(prev => ({
                                                      ...prev,
                                                      [intr.id]: { rating: prev[intr.id]?.rating ?? intr.rating ?? 0, comment: e.target.value },
                                                    }))}
                                                    placeholder="Optional note…"
                                                    className="flex-1 text-xs border border-slate-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
                                                  />
                                                  <button
                                                    onClick={() => handleSaveRating(intr.id)}
                                                    disabled={ratingSaving.has(intr.id) || !ratingDraft[intr.id]?.rating}
                                                    className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 shrink-0"
                                                  >
                                                    {ratingSaving.has(intr.id) ? '…' : 'Save'}
                                                  </button>
                                                </div>
                                              )}
                                            </div>
                                          )}

                                          {/* Messages */}
                                          {intrOpen && intrMsgs.length > 0 && (
                                            <div className="pl-24 pr-4 py-1 bg-slate-50 border-t border-slate-100 space-y-1">
                                              {intrMsgs.map((msg, idx) => (
                                                <div key={msg.id} className="flex items-center justify-between py-1 text-xs text-slate-500 border-b border-slate-100 last:border-0">
                                                  <span className="text-slate-400 mr-2">#{idx + 1}</span>
                                                  <span className="flex-1 truncate text-slate-600 mr-2" title={msg.content}>
                                                    {msg.content.slice(0, 60)}{msg.content.length > 60 ? '…' : ''}
                                                  </span>
                                                  <span className="font-mono shrink-0 text-slate-500 mr-2">
                                                    {((msg.prompt_tokens ?? 0) + (msg.response_tokens ?? 0)).toLocaleString()} tok
                                                  </span>
                                                  <span className="font-mono shrink-0 text-slate-700">
                                                    {fmtCost((msg.input_cost ?? 0) + (msg.output_cost ?? 0))}
                                                  </span>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {/* Pagination */}
            {convTotal > 10 && (
              <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between">
                <p className="text-xs text-slate-500">Page {convPage} of {Math.ceil(convTotal / 10)}</p>
                <div className="flex gap-2">
                  <button onClick={() => setConvPage(p => Math.max(1, p - 1))} disabled={convPage === 1}
                    className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg disabled:opacity-40 hover:bg-slate-50">Previous</button>
                  <button onClick={() => setConvPage(p => Math.min(Math.ceil(convTotal / 10), p + 1))} disabled={convPage >= Math.ceil(convTotal / 10)}
                    className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg disabled:opacity-40 hover:bg-slate-50">Next</button>
                </div>
              </div>
            )}
          </div>

        </>
      )}
    </div>
  )
}
