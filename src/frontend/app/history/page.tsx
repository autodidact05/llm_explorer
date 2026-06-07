'use client'

import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import type {
  ChatConversationSummary, ChatConversationDetail,
  ChatSessionDetail, Paginated,
} from '@/lib/types'
import { fmtUsd as fmtCost } from '@/lib/format'
import { EmptyState } from '@/components/EmptyState'
import { ProviderKeyBanner } from '@/components/ProviderKeyBanner'

const PAGE_SIZE = 20

function fmtDate(s: string) {
  return new Date(s).toLocaleString()
}

function fmtDuration(start: string, end: string | null) {
  if (!end) return '—'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  const mins = Math.floor(ms / 60000)
  const secs = Math.floor((ms % 60000) / 1000)
  if (mins === 0) return `${secs}s`
  return `${mins}m ${secs}s`
}

function downloadSessionPdf(session: ChatSessionDetail, convTitle: string | null) {
  const win = window.open('', '_blank')
  if (!win) return
  const allMsgs = [...(session.prior_messages ?? []), ...session.messages]
  win.document.write(`
    <html>
    <head>
      <title>${convTitle ?? session.title ?? 'Chat'}</title>
      <style>
        body{font-family:sans-serif;max-width:800px;margin:0 auto;padding:24px;color:#1e293b}
        h1{font-size:18px;margin:0 0 4px}
        .meta{font-size:12px;color:#64748b;margin-bottom:20px}
        .divider{text-align:center;font-size:11px;color:#94a3b8;margin:12px 0;border-top:1px dashed #cbd5e1;padding-top:8px}
        .bubble-wrap{display:flex;margin:8px 0}
        .bubble-wrap.user{justify-content:flex-end}
        .bubble{max-width:70%;padding:10px 14px;border-radius:12px;font-size:13px;line-height:1.5;white-space:pre-wrap}
        .bubble.user{background:#4f46e5;color:#fff}
        .bubble.assistant{background:#f8fafc;border:1px solid #e2e8f0}
        .msg-meta{font-size:10px;color:#94a3b8;margin-bottom:4px}
        @media print{body{padding:0}}
      </style>
    </head>
    <body>
      <h1>${convTitle ?? session.title ?? 'Untitled Chat'}</h1>
      <div class="meta">
        Session #${session.id} &middot; ${fmtDate(session.created_at)}
        ${session.ended_at ? ` &middot; ${fmtDuration(session.created_at, session.ended_at)}` : ''}
        &middot; ${fmtCost(session.total_cost)}
      </div>
      ${allMsgs.map(m => `
        <div class="bubble-wrap ${m.role}">
          <div>
            ${m.role === 'assistant' && m.model ? `<div class="msg-meta">${m.provider ?? ''}/${m.model}</div>` : ''}
            <div class="bubble ${m.role}">${m.content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\n/g,'<br>')}</div>
          </div>
        </div>
      `).join('')}
    </body>
    </html>
  `)
  win.document.close()
  win.print()
}

function SessionMessagesModal({
  session,
  convTitle,
  onClose,
}: {
  session: ChatSessionDetail
  convTitle: string | null
  onClose: () => void
}) {
  const allMsgs = [...(session.prior_messages ?? []), ...session.messages]
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="shrink-0 flex items-start justify-between px-6 py-4 border-b border-slate-200">
          <div className="min-w-0 pr-4">
            <h2 className="font-semibold text-slate-900 truncate">
              {convTitle ?? session.title ?? 'Untitled chat'}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Session #{session.id} · {fmtDate(session.created_at)}
              {session.ended_at && ` · ${fmtDuration(session.created_at, session.ended_at)}`}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => downloadSessionPdf(session, convTitle)}
              title="Download as PDF"
              className="px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Download PDF
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="shrink-0 px-6 py-3 border-b border-slate-100 bg-slate-50 flex gap-6 text-xs">
          <div>
            <span className="text-slate-400">Messages: </span>
            <span className="font-mono font-medium text-slate-700">
              {session.messages.filter(m => m.role === 'user').length}
            </span>
          </div>
          <div>
            <span className="text-slate-400">Cost: </span>
            <span className="font-mono font-medium text-slate-700">{fmtCost(session.total_cost)}</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {allMsgs.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'user' ? (
                <div className="max-w-[75%] bg-indigo-600 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
                  {msg.content}
                </div>
              ) : (
                <div className="max-w-[75%] space-y-1">
                  {msg.model && (
                    <p className="text-xs text-slate-400 px-1">
                      {msg.provider}/{msg.model}
                      {msg.input_cost != null && (
                        <span className="ml-2 text-slate-300">
                          · {fmtCost((msg.input_cost ?? 0) + (msg.output_cost ?? 0))}
                          · {(msg.time_taken ?? 0).toFixed(2)}s
                        </span>
                      )}
                    </p>
                  )}
                  <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm text-slate-800 leading-relaxed whitespace-pre-wrap shadow-sm">
                    {msg.content}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ConversationDetailModal({
  conv,
  onClose,
  onRestart,
}: {
  conv: ChatConversationDetail
  onClose: () => void
  onRestart: (convId: number) => void
}) {
  const [sessionDetail, setSessionDetail] = useState<ChatSessionDetail | null>(null)
  const [loadingSessionId, setLoadingSessionId] = useState<number | null>(null)

  async function openSession(id: number) {
    setLoadingSessionId(id)
    try {
      const s = await api.chat.getSession(id)
      setSessionDetail(s)
    } finally {
      setLoadingSessionId(null)
    }
  }

  return (
    <>
      {sessionDetail && (
        <SessionMessagesModal
          session={sessionDetail}
          convTitle={conv.title}
          onClose={() => setSessionDetail(null)}
        />
      )}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[85vh] flex flex-col">
          <div className="shrink-0 flex items-start justify-between px-6 py-4 border-b border-slate-200">
            <div className="min-w-0 pr-4">
              <h2 className="font-semibold text-slate-900 truncate">
                {conv.title ?? 'Untitled conversation'}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Conv #{conv.id} · {fmtDate(conv.created_at)}
              </p>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="shrink-0 px-6 py-3 border-b border-slate-100 bg-slate-50 flex gap-6 text-xs">
            <div>
              <span className="text-slate-400">Sessions: </span>
              <span className="font-mono font-medium text-slate-700">{conv.sessions.length}</span>
            </div>
            <div>
              <span className="text-slate-400">Total cost: </span>
              <span className="font-mono font-medium text-slate-700">{fmtCost(conv.total_cost)}</span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
            {conv.sessions.map(s => (
              <div key={s.id} className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-start gap-3">
                <div className={`mt-1 w-2 h-2 rounded-full shrink-0 ${
                  s.status === 'active' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-300'
                }`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-slate-700 truncate">
                        {s.title ?? <span className="italic text-slate-400">Untitled</span>}
                      </p>
                      <p className="text-xs text-slate-400">
                        Session #{s.id} · {fmtDate(s.created_at)}
                        {s.ended_at && ` · ${fmtDuration(s.created_at, s.ended_at)}`}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs font-mono font-medium text-slate-700">{fmtCost(s.total_cost)}</p>
                      <p className="text-xs text-slate-400">{s.message_count} msg{s.message_count !== 1 ? 's' : ''}</p>
                    </div>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => openSession(s.id)}
                      disabled={loadingSessionId === s.id}
                      className="px-2.5 py-1 text-xs font-medium text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 disabled:opacity-50 transition-colors"
                    >
                      {loadingSessionId === s.id ? 'Loading…' : 'View Chat'}
                    </button>
                    {s.status === 'active' && (
                      <button
                        onClick={() => {
                          localStorage.setItem('active_chat_session', String(s.id))
                          window.location.href = '/chat'
                        }}
                        className="px-2.5 py-1 text-xs font-medium text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-50 transition-colors"
                      >
                        Resume
                      </button>
                    )}
                    {s.status === 'ended' && (
                      <button
                        onClick={() => onRestart(conv.id)}
                        className="px-2.5 py-1 text-xs font-medium text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                      >
                        Restart
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

export default function HistoryPage() {
  const [data, setData] = useState<Paginated<ChatConversationSummary> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [convDetail, setConvDetail] = useState<ChatConversationDetail | null>(null)
  const [loadingConvId, setLoadingConvId] = useState<number | null>(null)
  const [restarting, setRestarting] = useState(false)
  const [resumingId, setResumingId] = useState<number | null>(null)
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameSaving, setRenameSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeSearch, setActiveSearch] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    const fetcher = activeSearch.trim()
      ? () => api.chat.searchConversations(activeSearch.trim(), { page, page_size: PAGE_SIZE })
      : () => api.chat.listConversations({ page, page_size: PAGE_SIZE })
    fetcher()
      .then(d => { setData(d); setLoading(false) })
      .catch((e: Error) => { setError(e.message); setLoading(false) })
  }, [page, activeSearch])

  useEffect(() => { load() }, [load])

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0

  async function openConversation(id: number) {
    setLoadingConvId(id)
    try {
      const c = await api.chat.getConversation(id)
      setConvDetail(c)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load conversation')
    } finally {
      setLoadingConvId(null)
    }
  }

  function startRename(conv: ChatConversationSummary) {
    setRenamingId(conv.id)
    setRenameValue(conv.title ?? '')
  }

  async function submitRename(convId: number) {
    const trimmed = renameValue.trim()
    if (!trimmed) return
    setRenameSaving(true)
    try {
      await api.chat.renameConversation(convId, trimmed)
      setData(prev => prev
        ? { ...prev, items: prev.items.map(c => c.id === convId ? { ...c, title: trimmed } : c) }
        : prev
      )
      setRenamingId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rename failed')
    } finally {
      setRenameSaving(false)
    }
  }

  async function handleResume(convId: number) {
    setResumingId(convId)
    try {
      const c = await api.chat.getConversation(convId)
      const activeSession = c.sessions.find(s => s.status === 'active')
      if (activeSession) {
        localStorage.setItem('active_chat_session', String(activeSession.id))
        window.location.href = '/chat'
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to resume conversation')
      setResumingId(null)
    }
  }

  async function handleRestart(convId: number) {
    setRestarting(true)
    try {
      const s = await api.chat.restartConversation(convId)
      localStorage.setItem('active_chat_session', String(s.id))
      window.location.href = '/chat'
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to restart conversation')
      setRestarting(false)
    }
  }

  return (
    <>
      {convDetail && (
        <ConversationDetailModal
          conv={convDetail}
          onClose={() => setConvDetail(null)}
          onRestart={handleRestart}
        />
      )}

      <div className="p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Chat History</h1>
          <p className="text-slate-500 mt-1">
            {data ? `${data.total.toLocaleString()} conversation${data.total === 1 ? '' : 's'}` : 'Past and active conversations'}
          </p>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
        )}

        <ProviderKeyBanner className="mb-6" />

        <form
          className="mb-6 flex flex-wrap gap-2"
          onSubmit={e => {
            e.preventDefault()
            setPage(1)
            setActiveSearch(searchQuery)
          }}
        >
          <input
            type="search"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search titles and message text…"
            className="flex-1 min-w-[200px] border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            Search
          </button>
          {activeSearch && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('')
                setActiveSearch('')
                setPage(1)
              }}
              className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Clear
            </button>
          )}
        </form>
        {activeSearch && (
          <p className="text-xs text-slate-500 -mt-4 mb-4">
            Showing results for &ldquo;{activeSearch}&rdquo;
          </p>
        )}

        <div className="space-y-3">
          {loading && (
            <div className="flex justify-center py-12">
              <div className="w-6 h-6 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!loading && data?.items.length === 0 && !activeSearch && (
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
              <EmptyState
                icon="chat"
                title="No conversations yet"
                description="Your chat history will appear here. Start a new conversation to begin."
                actions={[
                  { label: 'Start chat', href: '/chat', primary: true },
                  { label: 'Setup guide', href: '/settings?tab=guide' },
                ]}
              />
            </div>
          )}
          {!loading && data?.items.length === 0 && activeSearch && (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-400 text-sm">
              No conversations match your search.
            </div>
          )}

          {!loading && data?.items.map(conv => (
            <div
              key={conv.id}
              className="bg-white border border-slate-200 rounded-xl shadow-sm px-5 py-4 flex items-start gap-4"
            >
              <div className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${
                conv.status === 'active' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-300'
              }`} />

                <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    {renamingId === conv.id ? (
                      <form
                        onSubmit={e => { e.preventDefault(); submitRename(conv.id) }}
                        className="flex items-center gap-1.5"
                      >
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onKeyDown={e => e.key === 'Escape' && setRenamingId(null)}
                          className="flex-1 min-w-0 text-sm font-medium border border-indigo-300 rounded-lg px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white text-slate-800"
                          placeholder="Conversation name…"
                        />
                        <button
                          type="submit"
                          disabled={renameSaving || !renameValue.trim()}
                          className="shrink-0 px-2 py-0.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                        >
                          {renameSaving ? '…' : 'Save'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenamingId(null)}
                          className="shrink-0 px-2 py-0.5 text-xs font-medium text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <div className="group/title flex items-center gap-1.5 min-w-0">
                        <p className="font-medium text-slate-800 truncate">
                          {conv.title ?? <span className="italic text-slate-400">Untitled</span>}
                        </p>
                        <button
                          onClick={() => startRename(conv)}
                          title="Rename"
                          className="shrink-0 opacity-0 group-hover/title:opacity-100 transition-opacity p-0.5 text-slate-400 hover:text-indigo-600 rounded"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                          </svg>
                        </button>
                      </div>
                    )}
                    <p className="text-xs text-slate-400 mt-0.5">
                      {fmtDate(conv.created_at)}
                    </p>
                  </div>
                  <div className="shrink-0 flex items-center gap-3 text-xs text-slate-500">
                    <span>{conv.session_count} session{conv.session_count !== 1 ? 's' : ''}</span>
                    <span>{conv.message_count} msg{conv.message_count !== 1 ? 's' : ''}</span>
                    <span className="font-mono font-medium text-slate-700">{fmtCost(conv.total_cost)}</span>
                    <span className={`px-2 py-0.5 rounded-full font-medium ${
                      conv.status === 'active'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-slate-100 text-slate-500'
                    }`}>
                      {conv.status}
                    </span>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={() => openConversation(conv.id)}
                    disabled={loadingConvId === conv.id}
                    className="px-3 py-1.5 text-xs font-medium text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 disabled:opacity-50 transition-colors"
                  >
                    {loadingConvId === conv.id ? 'Loading…' : 'View Sessions'}
                  </button>

                  {conv.status === 'active' && (
                    <button
                      onClick={() => handleResume(conv.id)}
                      disabled={resumingId === conv.id}
                      className="px-3 py-1.5 text-xs font-medium text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-50 disabled:opacity-50 transition-colors"
                    >
                      {resumingId === conv.id ? 'Opening…' : 'Resume'}
                    </button>
                  )}

                  {conv.status === 'ended' && (
                    <button
                      onClick={() => handleRestart(conv.id)}
                      disabled={restarting}
                      className="px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
                    >
                      {restarting ? 'Restarting…' : 'Restart'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs text-slate-500">Page {page} of {totalPages} · {data?.total} conversations</p>
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
    </>
  )
}
