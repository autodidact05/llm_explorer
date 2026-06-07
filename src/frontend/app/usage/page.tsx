'use client'

import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import type {
  UsageConversation, UsageSession, UsageInteraction, UsageMessage, Paginated,
} from '@/lib/types'
import { useTimezone, formatDate } from '@/lib/hooks'
import { fmtUsd } from '@/lib/format'

const PAGE_SIZE = 20

// ── Cost split badge ─────────────────────────────────────────────────────────

function CostBadge({ label, cost, color }: { label: string; cost: number; color: string }) {
  if (cost <= 0) return null
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
      <span className="opacity-60">{label}</span>
      <span className="font-mono">{fmtUsd(cost)}</span>
    </span>
  )
}

function CostSplit({
  routerCost, answeringCost, totalCost,
}: {
  routerCost: number
  answeringCost: number
  totalCost: number
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <CostBadge label="Router" cost={routerCost} color="bg-violet-100 text-violet-700" />
      <CostBadge label="Answering" cost={answeringCost} color="bg-indigo-100 text-indigo-700" />
      <span className="font-mono font-semibold text-slate-800 text-xs">{fmtUsd(totalCost)}</span>
    </div>
  )
}

// ── Expand button ─────────────────────────────────────────────────────────────

function ExpandBtn({
  expanded, loading, onClick,
}: {
  expanded: boolean
  loading: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex-shrink-0 w-6 h-6 rounded-md border border-slate-300 bg-white
                 hover:bg-slate-50 hover:border-slate-400 transition-colors
                 flex items-center justify-center text-slate-500 hover:text-slate-700"
      title={expanded ? 'Collapse' : 'Expand'}
    >
      {loading ? (
        <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : expanded ? (
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
          <path d="M2 4l4 4 4-4" />
        </svg>
      ) : (
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
          <path d="M4 2l4 4-4 4" />
        </svg>
      )}
    </button>
  )
}

// ── Level indicator dot ───────────────────────────────────────────────────────

function LevelDot({ color }: { color: string }) {
  return <span className={`flex-shrink-0 w-2 h-2 rounded-full ${color}`} />
}

// ── Row wrapper ───────────────────────────────────────────────────────────────

function TreeRow({
  depth, children, highlight,
}: {
  depth: number
  children: React.ReactNode
  highlight?: boolean
}) {
  const paddingLeft = 16 + depth * 24
  return (
    <div
      className={`flex items-center gap-3 px-4 py-2.5 border-b border-slate-50
                  ${highlight ? 'bg-slate-50/60' : 'hover:bg-slate-50/40'} transition-colors`}
      style={{ paddingLeft }}
    >
      {children}
    </div>
  )
}

// ── Message row ───────────────────────────────────────────────────────────────

function MessageRow({
  msg,
  index,
  timezone,
}: {
  msg: UsageMessage
  index: number
  timezone: string
}) {
  const totalCost = msg.answering_cost + msg.router_cost
  return (
    <TreeRow depth={3}>
      <LevelDot color="bg-emerald-400" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-slate-600">
            #{index}
          </span>
          {msg.model && (
            <span className="font-mono text-xs text-slate-400 truncate max-w-[180px]">{msg.model}</span>
          )}
          <span className="text-xs text-slate-400">{formatDate(msg.created_at, timezone)}</span>
          {msg.prompt_tokens > 0 && (
            <span className="text-xs text-slate-400">
              {msg.prompt_tokens.toLocaleString()}→{msg.response_tokens.toLocaleString()} tok
            </span>
          )}
          {msg.time_taken > 0 && (
            <span className="text-xs text-slate-400">{msg.time_taken.toFixed(2)}s</span>
          )}
          {msg.http_code != null && msg.http_code !== 200 && (
            <span className="text-xs font-medium text-red-600">HTTP {msg.http_code}</span>
          )}
        </div>
      </div>
      <CostSplit routerCost={msg.router_cost} answeringCost={msg.answering_cost} totalCost={totalCost} />
    </TreeRow>
  )
}

// ── Interaction row ───────────────────────────────────────────────────────────

function InteractionRow({
  intr, timezone, expanded, loading, onToggle, children,
}: {
  intr: UsageInteraction
  timezone: string
  expanded: boolean
  loading: boolean
  onToggle: () => void
  children?: React.ReactNode
}) {
  const totalCost = intr.answering_cost + intr.router_cost
  return (
    <>
      <TreeRow depth={2}>
        <ExpandBtn expanded={expanded} loading={loading} onClick={onToggle} />
        <LevelDot color="bg-amber-400" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-slate-700 capitalize">
              {intr.provider}
            </span>
            <span className="font-mono text-xs text-slate-500 truncate max-w-[200px]">{intr.model}</span>
            {intr.routed_by && (
              <span className="text-xs px-1.5 py-0.5 bg-violet-50 text-violet-600 rounded font-medium">
                routed
              </span>
            )}
            <span className="text-xs text-slate-400">
              {intr.message_count} {intr.message_count === 1 ? 'message' : 'messages'}
            </span>
            <span className="text-xs text-slate-400">{formatDate(intr.created_at, timezone)}</span>
          </div>
        </div>
        <CostSplit routerCost={intr.router_cost} answeringCost={intr.answering_cost} totalCost={totalCost} />
      </TreeRow>
      {expanded && children}
    </>
  )
}

// ── Session row ───────────────────────────────────────────────────────────────

function SessionRow({
  session, timezone, expanded, loading, onToggle, children,
}: {
  session: UsageSession
  timezone: string
  expanded: boolean
  loading: boolean
  onToggle: () => void
  children?: React.ReactNode
}) {
  return (
    <>
      <TreeRow depth={1}>
        <ExpandBtn expanded={expanded} loading={loading} onClick={onToggle} />
        <LevelDot color="bg-sky-400" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-slate-700">
              Session #{session.session_id}
            </span>
            {session.session_title && (
              <span className="text-xs text-slate-500 truncate max-w-[160px]">{session.session_title}</span>
            )}
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
              session.status === 'active'
                ? 'bg-emerald-50 text-emerald-600'
                : 'bg-slate-100 text-slate-500'
            }`}>
              {session.status}
            </span>
            <span className="text-xs text-slate-400">{session.event_count} events</span>
            <span className="text-xs text-slate-400">{formatDate(session.last_event, timezone)}</span>
          </div>
        </div>
        <CostSplit
          routerCost={session.router_cost}
          answeringCost={session.answering_cost}
          totalCost={session.total_cost}
        />
      </TreeRow>
      {expanded && children}
    </>
  )
}

// ── Conversation row ──────────────────────────────────────────────────────────

function ConversationRow({
  conv, timezone, expanded, loading, onToggle, children,
}: {
  conv: UsageConversation
  timezone: string
  expanded: boolean
  loading: boolean
  onToggle: () => void
  children?: React.ReactNode
}) {
  return (
    <>
      <TreeRow depth={0} highlight>
        <ExpandBtn expanded={expanded} loading={loading} onClick={onToggle} />
        <LevelDot color="bg-slate-400" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-800">
              {conv.conversation_title ?? `Conversation #${conv.conversation_id}`}
            </span>
            <span className="text-xs text-slate-400">{conv.event_count} events</span>
            <span className="text-xs text-slate-400">{formatDate(conv.last_event, timezone)}</span>
          </div>
        </div>
        <CostSplit
          routerCost={conv.router_cost}
          answeringCost={conv.answering_cost}
          totalCost={conv.total_cost}
        />
      </TreeRow>
      {expanded && children}
    </>
  )
}

// ── Loading placeholder ───────────────────────────────────────────────────────

function LoadingRows({ depth }: { depth: number }) {
  const paddingLeft = 16 + depth * 24
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 border-b border-slate-50"
      style={{ paddingLeft }}
    >
      <span className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      <span className="text-xs text-slate-400">Loading…</span>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function UsagePage() {
  const { timezone } = useTimezone()

  const [convData, setConvData] = useState<(Paginated<UsageConversation> & {
    direct_calls_count: number
    direct_calls_cost: number
  }) | null>(null)
  const [convPage, setConvPage] = useState(1)
  const [convLoading, setConvLoading] = useState(true)
  const [convError, setConvError] = useState('')

  const [expandedConvIds, setExpandedConvIds] = useState<Set<number>>(new Set())
  const [sessions, setSessions] = useState<Record<number, UsageSession[]>>({})
  const [loadingSessions, setLoadingSessions] = useState<Set<number>>(new Set())

  const [expandedSessionIds, setExpandedSessionIds] = useState<Set<number>>(new Set())
  const [interactions, setInteractions] = useState<Record<number, UsageInteraction[]>>({})
  const [loadingInteractions, setLoadingInteractions] = useState<Set<number>>(new Set())

  const [expandedInteractionIds, setExpandedInteractionIds] = useState<Set<number>>(new Set())
  const [messages, setMessages] = useState<Record<number, UsageMessage[]>>({})
  const [loadingMessages, setLoadingMessages] = useState<Set<number>>(new Set())

  const loadConversations = useCallback(() => {
    setConvLoading(true)
    setConvError('')
    api.usageHierarchy.conversations({ page: convPage, page_size: PAGE_SIZE })
      .then(d => { setConvData(d); setConvLoading(false) })
      .catch((e: Error) => { setConvError(e.message); setConvLoading(false) })
  }, [convPage])

  useEffect(() => { loadConversations() }, [loadConversations])

  const toggleConversation = useCallback((convId: number) => {
    setExpandedConvIds(prev => {
      const next = new Set(prev)
      if (next.has(convId)) {
        next.delete(convId)
        return next
      }
      next.add(convId)
      if (!sessions[convId]) {
        setLoadingSessions(s => new Set(s).add(convId))
        api.usageHierarchy.sessions(convId)
          .then(d => {
            setSessions(s => ({ ...s, [convId]: d.items }))
            setLoadingSessions(s => { const n = new Set(s); n.delete(convId); return n })
          })
          .catch(() => setLoadingSessions(s => { const n = new Set(s); n.delete(convId); return n }))
      }
      return next
    })
  }, [sessions])

  const toggleSession = useCallback((sessionId: number) => {
    setExpandedSessionIds(prev => {
      const next = new Set(prev)
      if (next.has(sessionId)) {
        next.delete(sessionId)
        return next
      }
      next.add(sessionId)
      if (!interactions[sessionId]) {
        setLoadingInteractions(s => new Set(s).add(sessionId))
        api.usageHierarchy.interactions(sessionId)
          .then(d => {
            setInteractions(s => ({ ...s, [sessionId]: d.items }))
            setLoadingInteractions(s => { const n = new Set(s); n.delete(sessionId); return n })
          })
          .catch(() => setLoadingInteractions(s => { const n = new Set(s); n.delete(sessionId); return n }))
      }
      return next
    })
  }, [interactions])

  const toggleInteraction = useCallback((interactionId: number) => {
    setExpandedInteractionIds(prev => {
      const next = new Set(prev)
      if (next.has(interactionId)) {
        next.delete(interactionId)
        return next
      }
      next.add(interactionId)
      if (!messages[interactionId]) {
        setLoadingMessages(s => new Set(s).add(interactionId))
        api.usageHierarchy.messages(interactionId)
          .then(d => {
            setMessages(s => ({ ...s, [interactionId]: d.items }))
            setLoadingMessages(s => { const n = new Set(s); n.delete(interactionId); return n })
          })
          .catch(() => setLoadingMessages(s => { const n = new Set(s); n.delete(interactionId); return n }))
      }
      return next
    })
  }, [messages])

  const totalPages = convData ? Math.ceil(convData.total / PAGE_SIZE) : 0

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Usage</h1>
        <p className="text-slate-500 mt-1">
          {convData
            ? `${convData.total.toLocaleString()} conversation${convData.total !== 1 ? 's' : ''} · cost hierarchy`
            : 'Hierarchical cost breakdown by conversation'}
        </p>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-4 text-xs text-slate-500">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-slate-400" /> Conversation
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-sky-400" /> Session
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-amber-400" /> Interaction
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400" /> Message
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
            Router LLM
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
            Answering LLM
          </span>
        </div>
      </div>

      {convError && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {convError}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {convLoading && (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!convLoading && convData?.items.length === 0 && (
          <div className="py-16 text-center text-slate-400 text-sm">No conversations recorded yet.</div>
        )}

        {!convLoading && convData?.items.map(conv => {
          const convExpanded = expandedConvIds.has(conv.conversation_id)
          const convSessionsLoading = loadingSessions.has(conv.conversation_id)
          const convSessions = sessions[conv.conversation_id]

          return (
            <ConversationRow
              key={conv.conversation_id}
              conv={conv}
              timezone={timezone}
              expanded={convExpanded}
              loading={convSessionsLoading}
              onToggle={() => toggleConversation(conv.conversation_id)}
            >
              {convSessionsLoading && <LoadingRows depth={1} />}
              {convSessions?.map(session => {
                const sessionExpanded = expandedSessionIds.has(session.session_id)
                const sessionIntrsLoading = loadingInteractions.has(session.session_id)
                const sessionIntrs = interactions[session.session_id]

                return (
                  <SessionRow
                    key={session.session_id}
                    session={session}
                    timezone={timezone}
                    expanded={sessionExpanded}
                    loading={sessionIntrsLoading}
                    onToggle={() => toggleSession(session.session_id)}
                  >
                    {sessionIntrsLoading && <LoadingRows depth={2} />}
                    {sessionIntrs?.map(intr => {
                      const intrExpanded = expandedInteractionIds.has(intr.interaction_id)
                      const intrMsgsLoading = loadingMessages.has(intr.interaction_id)
                      const intrMsgs = messages[intr.interaction_id]

                      return (
                        <InteractionRow
                          key={intr.interaction_id}
                          intr={intr}
                          timezone={timezone}
                          expanded={intrExpanded}
                          loading={intrMsgsLoading}
                          onToggle={() => toggleInteraction(intr.interaction_id)}
                        >
                          {intrMsgsLoading && <LoadingRows depth={3} />}
                          {intrMsgs?.map((msg, idx) => (
                            <MessageRow
                              key={msg.message_id}
                              msg={msg}
                              index={idx + 1}
                              timezone={timezone}
                            />
                          ))}
                          {intrMsgs?.length === 0 && (
                            <TreeRow depth={3}>
                              <span className="text-xs text-slate-400">No messages found.</span>
                            </TreeRow>
                          )}
                        </InteractionRow>
                      )
                    })}
                    {sessionIntrs?.length === 0 && (
                      <TreeRow depth={2}>
                        <span className="text-xs text-slate-400">No interactions found.</span>
                      </TreeRow>
                    )}
                  </SessionRow>
                )
              })}
              {convSessions?.length === 0 && (
                <TreeRow depth={1}>
                  <span className="text-xs text-slate-400">No sessions found.</span>
                </TreeRow>
              )}
            </ConversationRow>
          )
        })}

        {/* Direct API calls footer */}
        {!convLoading && convData && convData.direct_calls_count > 0 && (
          <div className="flex items-center gap-3 px-4 py-3 border-t border-slate-100 bg-slate-50/60">
            <LevelDot color="bg-orange-300" />
            <span className="text-xs text-slate-500 flex-1">
              Direct API calls ({convData.direct_calls_count} events, no conversation)
            </span>
            <span className="font-mono text-xs font-semibold text-slate-700">
              {fmtUsd(convData.direct_calls_cost)}
            </span>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Page {convPage} of {totalPages} · {convData?.total.toLocaleString()} conversations
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConvPage(p => Math.max(1, p - 1))}
                disabled={convPage === 1}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg disabled:opacity-40 hover:bg-slate-50"
              >
                Previous
              </button>
              <button
                onClick={() => setConvPage(p => Math.min(totalPages, p + 1))}
                disabled={convPage === totalPages}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg disabled:opacity-40 hover:bg-slate-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
