'use client'

import { useEffect, useRef, useState } from 'react'

import { marked } from 'marked'
import { api } from '@/lib/api'
import type {
  ChatBranch,
  ChatSendResult,
  ChatSession,
  ChatSessionDetail,
  ChatStreamEvent,
  CostEstimate,
  MessageAttachment,
  ModelPricing,
} from '@/lib/types'
import { looksLikeImageGenerationIntent } from '@/features/chat/imageIntent'
import { fmtCtx, fmtRate, fmtUsd as fmtCost } from '@/lib/format'
import { Spinner } from '@/components/Spinner'
import { AuthenticatedImage } from '@/components/AuthenticatedImage'
import { BraveSearchSources } from '@/components/BraveSearchSources'
import { MarkdownContent } from '@/components/MarkdownContent'
import type { ChatMessage, SessionStats, StatsView, Transaction } from '@/features/chat/types'
import { prepareMarkdownForDisplay } from '@/features/chat/markdown'
import { buildInteractionGroups, contentWithoutBraveFooter } from '@/features/chat/utils'
import { ModelTooltip } from '@/features/chat/components/ModelTooltip'
import { RouterLlmToggle } from '@/features/chat/components/RouterLlmToggle'
import { ProviderKeyBanner } from '@/components/ProviderKeyBanner'

// 'interactions' = default grouped view; number = message drill-down for that interactionId

export default function ChatPage() {
  const [providers, setProviders] = useState<string[]>([])
  const [models, setModels] = useState<ModelPricing[]>([])
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [systemMessage, setSystemMessage] = useState('')
  const [masterNotice, setMasterNotice] = useState<string | null>(null)
  const [routerLlmGlobal, setRouterLlmGlobal] = useState(false)
  const [useRouterLlm, setUseRouterLlm] = useState(false)
  const [session, setSession] = useState<ChatSession | null>(null)
  const [conversationId, setConversationId] = useState<number | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [stats, setStats] = useState<SessionStats>({
    totalCalls: 0, totalTokens: 0, totalCost: 0, transactions: [],
    routerCalls: 0, routerTokens: 0, routerCost: 0,
  })
  const [statsView, setStatsView] = useState<StatsView>('interactions')
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [starting, setStarting] = useState(false)
  const [ending, setEnding] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [renamingConv, setRenamingConv] = useState(false)
  const [renameConvValue, setRenameConvValue] = useState('')
  const [renamingConvSaving, setRenamingConvSaving] = useState(false)
  // Ratings: keyed by messageId (response) or interactionId (routing)
  const [responseRatings, setResponseRatings] = useState<Record<number, number>>({})
  const [routingRatings, setRoutingRatings] = useState<Record<number, number>>({})
  const [endSummary, setEndSummary] = useState<{
    message_count: number; total_cost: number; total_tokens: number
  } | null>(null)
  const [error, setError] = useState('')
  const [attachments, setAttachments] = useState<MessageAttachment[]>([])
  const [attachmentPreviews, setAttachmentPreviews] = useState<string[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sendStartRef = useRef<number | null>(null)
  const sendAbortRef = useRef<AbortController | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [streamStatus, setStreamStatus] = useState<string | null>(null)
  const [slowWarn, setSlowWarn] = useState<'soft' | 'hard' | null>(null)
  const warnThresholdsRef = useRef({ soft: 15, hard: 45 })
  const [branches, setBranches] = useState<ChatBranch[]>([])
  const [activeBranchId, setActiveBranchId] = useState(1)
  const [costEstimate, setCostEstimate] = useState<CostEstimate | null>(null)
  const [branchingMessageId, setBranchingMessageId] = useState<number | null>(null)

  const selectedModelData = models.find(m => m.model === model) ?? null

  function hydrateFromSession(s: ChatSessionDetail) {
    setSession(s)
    setConversationId(s.conversation_id ?? null)
    setBranches(s.branches ?? [{ id: 1, fork_message_id: null, label: 'Main', created_at: null }])
    setActiveBranchId(s.active_branch_id ?? 1)

    const parseImageUrl = (content: string): string | undefined =>
      content.startsWith('!image:') ? content.slice('!image:'.length) : undefined

    const intrMap = new Map(s.interactions.map(i => [i.id, i]))

    const priorMsgs: ChatMessage[] = (s.prior_messages ?? []).map(m => ({
      role: m.role, content: m.content,
      model: m.model ?? undefined, provider: m.provider ?? undefined,
      fromPrior: true,
      messageId: m.id,
      interactionId: m.interaction_id ?? undefined,
      routerRouted: m.interaction_id != null && intrMap.get(m.interaction_id)?.routed_by === 'router_llm',
      responseRating: m.response_rating ?? undefined,
      image_url: parseImageUrl(m.content),
    }))
    const currentMsgs: ChatMessage[] = s.messages.map(m => ({
      role: m.role, content: m.content,
      model: m.model ?? undefined, provider: m.provider ?? undefined,
      messageId: m.id,
      interactionId: m.interaction_id ?? undefined,
      routerRouted: m.interaction_id != null && intrMap.get(m.interaction_id)?.routed_by === 'router_llm',
      responseRating: m.response_rating ?? undefined,
      image_url: parseImageUrl(m.content),
    }))
    setMessages([...priorMsgs, ...currentMsgs])

    const initResponseRatings: Record<number, number> = {}
    ;[...s.prior_messages ?? [], ...s.messages].forEach(m => {
      if (m.response_rating != null) initResponseRatings[m.id] = m.response_rating
    })
    setResponseRatings(initResponseRatings)
    const initRoutingRatings: Record<number, number> = {}
    s.interactions.forEach(i => {
      if (i.rating != null) initRoutingRatings[i.id] = i.rating
    })
    setRoutingRatings(initRoutingRatings)

    const txns: Transaction[] = s.messages
      .filter(m => m.role === 'assistant' && m.event_id)
      .map(m => ({
        event_id: m.event_id!,
        interaction_id: m.interaction_id ?? 0,
        message_id: m.id,
        content: m.content,
        model: m.model!,
        provider: m.provider!,
        prompt_tokens: m.prompt_tokens ?? 0,
        response_tokens: m.response_tokens ?? 0,
        input_cost: m.input_cost ?? 0,
        output_cost: m.output_cost ?? 0,
        total_cost: (m.input_cost ?? 0) + (m.output_cost ?? 0),
        time_taken: m.time_taken ?? 0,
        http_code: m.http_code ?? 200,
      }))
    const rs = s.router_stats
    setStats({
      totalCalls: txns.length,
      totalTokens: txns.reduce((a, t) => a + t.prompt_tokens + t.response_tokens, 0),
      totalCost: txns.reduce((a, t) => a + t.total_cost, 0),
      transactions: txns,
      routerCalls: rs?.calls ?? 0,
      routerTokens: rs?.tokens ?? 0,
      routerCost: rs?.cost ?? 0,
    })
  }

  async function reloadSession() {
    if (!session?.id) return
    const s = await api.chat.getSession(session.id)
    hydrateFromSession(s)
  }

  async function handleBranchFrom(messageId: number) {
    if (!session?.id) return
    setBranchingMessageId(messageId)
    setError('')
    try {
      await api.chat.createBranch(session.id, messageId)
      await reloadSession()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create branch')
    } finally {
      setBranchingMessageId(null)
    }
  }

  async function handleSwitchBranch(branchId: number) {
    if (!session?.id || branchId === activeBranchId) return
    setError('')
    try {
      await api.chat.setActiveBranch(session.id, branchId)
      await reloadSession()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to switch branch')
    }
  }

  useEffect(() => {
    function onNewChat() {
      setMessages([])
      setStats({ totalCalls: 0, totalTokens: 0, totalCost: 0, transactions: [], routerCalls: 0, routerTokens: 0, routerCost: 0 })
      setStatsView('interactions')
      setEndSummary(null)
      setError('')
      setAttachments([])
      setAttachmentPreviews([])
      setConversationId(null)
      setSession(null)
      setResponseRatings({})
      setRoutingRatings({})
    }
    window.addEventListener('chat:new', onNewChat)
    return () => window.removeEventListener('chat:new', onNewChat)
  }, [])

  useEffect(() => {
    if (!looksLikeImageGenerationIntent(input) || !provider || !model) {
      setCostEstimate(null)
      return
    }
    const t = setTimeout(() => {
      api.chat.estimateCost({ provider, model, content: input })
        .then(setCostEstimate)
        .catch(() => setCostEstimate(null))
    }, 400)
    return () => clearTimeout(t)
  }, [input, provider, model])

  useEffect(() => {
    api.settings.get().then(s => {
      const enabled = !!s.router_llm_enabled
      setRouterLlmGlobal(enabled)
      setUseRouterLlm(enabled)
    }).catch(() => {})
    api.providers().then(setProviders).catch(() => {})

    const savedId = localStorage.getItem('active_chat_session')
    if (savedId) {
      api.chat.getSession(Number(savedId))
        .then(s => {
          if (s.status === 'active') {
            hydrateFromSession(s)
          } else {
            localStorage.removeItem('active_chat_session')
          }
        })
        .catch(() => localStorage.removeItem('active_chat_session'))
    }
    // Check if we navigated here to restart a conversation
    const pendingConvId = localStorage.getItem('pending_restart_conversation')
    if (pendingConvId && !savedId) {
      localStorage.removeItem('pending_restart_conversation')
      api.chat.restartConversation(Number(pendingConvId))
        .then(s => {
          setSession(s)
          setConversationId(s.conversation_id ?? null)
          setMessages([])
          setStats({ totalCalls: 0, totalTokens: 0, totalCost: 0, transactions: [] })
          localStorage.setItem('active_chat_session', String(s.id))
        })
        .catch(() => {})
    }
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!sending) {
      setElapsed(0)
      setStreamStatus(null)
      setSlowWarn(null)
      return
    }
    sendStartRef.current = Date.now()
    const interval = setInterval(() => {
      const sec = Math.floor((Date.now() - (sendStartRef.current ?? Date.now())) / 1000)
      setElapsed(sec)
      const { soft, hard } = warnThresholdsRef.current
      if (sec >= hard) setSlowWarn('hard')
      else if (sec >= soft) setSlowWarn('soft')
    }, 500)
    return () => clearInterval(interval)
  }, [sending])

  function handleCancelSend() {
    sendAbortRef.current?.abort()
  }

  async function handleStartChat() {
    if (!provider || !model) return
    setStarting(true)
    setError('')
    try {
      const s = await api.chat.createSession(systemMessage.trim() ? { system_message: systemMessage.trim() } : undefined)
      setSession(s)
      setConversationId(s.conversation_id ?? null)
      setMessages([])
      setStats({ totalCalls: 0, totalTokens: 0, totalCost: 0, transactions: [], routerCalls: 0, routerTokens: 0, routerCost: 0 })
      setStatsView('interactions')
      setEndSummary(null)
      localStorage.setItem('active_chat_session', String(s.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start chat')
    } finally {
      setStarting(false)
    }
  }

  async function handleRestartChat() {
    if (!conversationId) return
    setRestarting(true)
    setError('')
    try {
      const s = await api.chat.restartConversation(conversationId)
      setSession(s)
      setConversationId(s.conversation_id ?? null)
      setMessages([])
      setStats({ totalCalls: 0, totalTokens: 0, totalCost: 0, transactions: [], routerCalls: 0, routerTokens: 0, routerCost: 0 })
      setStatsView('interactions')
      setEndSummary(null)
      localStorage.setItem('active_chat_session', String(s.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to restart chat')
    } finally {
      setRestarting(false)
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    files.forEach(file => {
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        const data = dataUrl.split(',')[1] ?? ''
        setAttachments(prev => [...prev, { name: file.name, mime_type: file.type || 'application/octet-stream', data }])
        setAttachmentPreviews(prev => [...prev, file.type.startsWith('image/') ? dataUrl : ''])
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  function removeAttachment(index: number) {
    setAttachments(prev => prev.filter((_, i) => i !== index))
    setAttachmentPreviews(prev => prev.filter((_, i) => i !== index))
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!session || !input.trim() || !provider || !model || sending) return

    const userText = input.trim()
    setInput('')
    setError('')
    setMasterNotice(null)
    setMessages(prev => [
      ...prev,
      { role: 'user', content: userText },
      { role: 'assistant', content: '', model, provider, streaming: true },
    ])
    setSending(true)
    setStreamStatus('Preparing…')
    setSlowWarn(null)
    sendAbortRef.current = new AbortController()

    const pendingAttachments = attachments.slice()
    setAttachments([])
    setAttachmentPreviews([])

    const payload = {
      provider,
      model,
      content: userText,
      attachments: pendingAttachments.length > 0 ? pendingAttachments : undefined,
      ...(routerLlmGlobal && !useRouterLlm ? { use_router_llm: false } : {}),
    }

    function applyMasterNoticeForResult(result: ChatSendResult, usedModel: string, usedProvider: string) {
      const routerTokens = (result.router_prompt_tokens ?? 0) + (result.router_response_tokens ?? 0)
      const routerUsed = routerTokens > 0
      const routerCostStr =
        (result.router_total_cost ?? 0) > 0 ? ` · ${fmtCost(result.router_total_cost ?? 0)}` : ''
      const costBadge = result.router_estimated_cost ? ` · est:${result.router_estimated_cost}` : ''
      const confBadge =
        result.router_confidence != null
          ? ` · ${Math.round(result.router_confidence * 100)}% confident`
          : ''
      const reasonSuffix = result.router_reason ? ` · ${result.router_reason}` : ''
      const webSuffix = result.web_search_used ? ' · Brave web search' : ''

      if (result.router_unavailable) {
        setMasterNotice('Router LLM unavailable — using your selected model.')
      } else if (result.is_image) {
        const imgMeta = `Image → ${usedProvider}/${usedModel} · ${fmtCost(result.total_cost)} · ${result.prompt_tokens + result.response_tokens} tokens · ${result.time_taken.toFixed(2)}s`
        if (routerUsed && result.router_routed && result.router_model) {
          setMasterNotice(
            `Router LLM → ${result.router_provider}/${result.router_model}${routerCostStr}${costBadge}${confBadge}${reasonSuffix} · ${imgMeta}${webSuffix}`,
          )
        } else {
          setMasterNotice(`Image generation → ${imgMeta}${webSuffix}`)
        }
      } else if (result.router_routed && result.router_model) {
        setMasterNotice(
          `Router LLM → ${result.router_provider}/${result.router_model}${routerCostStr}${costBadge}${confBadge}${reasonSuffix}${webSuffix}`,
        )
      } else if (result.web_search_used) {
        setMasterNotice('Brave web search · live results included in this reply')
      } else {
        setMasterNotice(null)
      }
    }

    function finalizeFromResult(result: ChatSendResult) {
      const usedModel = result.actual_model || model
      const usedProvider = result.actual_provider || provider
      const routerTokens = (result.router_prompt_tokens ?? 0) + (result.router_response_tokens ?? 0)
      const routerUsed = routerTokens > 0
      applyMasterNoticeForResult(result, usedModel, usedProvider)
      setMessages(prev => {
        const next = [...prev]
        const idx = next.findLastIndex(m => m.role === 'assistant' && m.streaming)
        const finalized = {
          role: 'assistant' as const,
          content: result.content,
          model: usedModel,
          provider: usedProvider,
          transaction: result,
          messageId: result.message_id,
          interactionId: result.interaction_id,
          routerRouted: (result.router_routed ?? false) && routerUsed,
          image_url: result.image_url ?? undefined,
          webSearchSources: result.web_search_sources ?? undefined,
        }
        if (idx >= 0) next[idx] = finalized
        else next.push(finalized)
        return next
      })
      const txn: Transaction = {
        ...result,
        model: usedModel,
        provider: usedProvider,
        is_image: result.is_image ?? false,
      }
      setStats(prev => ({
        totalCalls: prev.totalCalls + 1,
        totalTokens: prev.totalTokens + result.prompt_tokens + result.response_tokens,
        totalCost: prev.totalCost + result.total_cost,
        transactions: [...prev.transactions, txn],
        routerCalls: prev.routerCalls + (routerUsed ? 1 : 0),
        routerTokens: prev.routerTokens + (result.router_prompt_tokens ?? 0) + (result.router_response_tokens ?? 0),
        routerCost: prev.routerCost + (result.router_total_cost ?? 0),
      }))
    }

    try {
      await api.chat.sendMessageStream(
        session.id,
        payload,
        (event: ChatStreamEvent) => {
        if (event.type === 'stage') {
          setStreamStatus(event.message)
        } else if (event.type === 'warn') {
          setSlowWarn(event.level)
          setMasterNotice(event.message)
        } else if (event.type === 'meta') {
          if (event.soft_warn_elapsed_sec != null) {
            warnThresholdsRef.current.soft = event.soft_warn_elapsed_sec
          }
          if (event.hard_warn_elapsed_sec != null) {
            warnThresholdsRef.current.hard = event.hard_warn_elapsed_sec
          }
          if (event.router_timed_out) {
            setMasterNotice('Router timed out — using your selected model.')
          }
          setMessages(prev => {
            const next = [...prev]
            const idx = next.findLastIndex(m => m.role === 'assistant' && m.streaming)
            if (idx >= 0) {
              next[idx] = {
                ...next[idx],
                model: event.actual_model,
                provider: event.actual_provider,
                webSearchSources: event.web_search_sources?.length
                  ? event.web_search_sources
                  : next[idx].webSearchSources,
              }
            }
            return next
          })
          if (event.web_search_used) {
            setMasterNotice('Brave web search · fetching live results…')
          }
        } else if (event.type === 'token') {
          setMessages(prev => {
            const next = [...prev]
            const idx = next.findLastIndex(m => m.role === 'assistant' && m.streaming)
            if (idx >= 0) {
              next[idx] = { ...next[idx], content: next[idx].content + event.delta }
            }
            return next
          })
        } else if (event.type === 'done') {
          finalizeFromResult(event.result)
        } else if (event.type === 'cancelled') {
          setMessages(prev => {
            const next = [...prev]
            const idx = next.findLastIndex(m => m.role === 'assistant' && m.streaming)
            if (idx >= 0) {
              const partial = next[idx].content.trim()
              next[idx] = {
                ...next[idx],
                streaming: false,
                content: partial ? `${partial}\n\n_(Cancelled)_` : '_(Cancelled)_',
              }
            }
            return next
          })
          setMasterNotice(event.message)
        } else if (event.type === 'error') {
          const stageHint = event.stage ? ` (${event.stage})` : ''
          throw new Error(`${event.message}${stageHint}`)
        }
      },
        sendAbortRef.current.signal,
      )
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        return
      }
      const rawErr = e instanceof Error ? e.message : 'Send failed'
      // Strip HTML tags and truncate so an HTML error page never floods the UI
      const stripped = rawErr.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
      const errMsg = stripped.length > 300 ? stripped.slice(0, 300) + '…' : stripped
      const isUnavailable = errMsg.includes('404') || errMsg.includes('503') || errMsg.toLowerCase().includes('unavailable')
      setError(isUnavailable
        ? `${errMsg} — this model may not be available right now. Try selecting a different model.`
        : errMsg)
      setMessages(prev => {
        const trimmed = [...prev]
        while (trimmed.length > 0 && trimmed[trimmed.length - 1].role === 'assistant') {
          trimmed.pop()
        }
        if (trimmed.length > 0 && trimmed[trimmed.length - 1].role === 'user') trimmed.pop()
        return trimmed
      })
      setAttachments(pendingAttachments)
      setAttachmentPreviews(pendingAttachments.map(() => ''))
    } finally {
      sendAbortRef.current = null
      setSending(false)
      setStreamStatus(null)
      setTimeout(() => textareaRef.current?.focus(), 0)
    }
  }

  function handleExportPdf() {
    if (!session || messages.length === 0) return
    const win = window.open('', '_blank')
    if (!win) return

    const title = session.title ?? `Session #${session.id}`
    const totalCost = stats.totalCost
    const fmtCostSimple = (n: number) =>
      n === 0 ? '$0.0000' : `$${Math.abs(n) < 0.001 ? n.toFixed(8) : n.toFixed(4)}`

    // Configure marked with GFM (tables, strikethrough, task lists)
    marked.use({ gfm: true, breaks: true })
    const mdToHtml = (text: string): string => marked.parse(prepareMarkdownForDisplay(text)) as string

    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${esc(title)}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           max-width: 820px; margin: 0 auto; padding: 36px 28px; color: #1e293b;
           font-size: 14px; line-height: 1.65; }

    /* ── Page header ── */
    .doc-header { margin-bottom: 28px; padding-bottom: 18px; border-bottom: 2px solid #e2e8f0; }
    .doc-header h1 { font-size: 22px; font-weight: 700; color: #0f172a; margin-bottom: 6px; }
    .meta { font-size: 12px; color: #64748b; display: flex; gap: 20px; flex-wrap: wrap; }

    /* ── Session divider ── */
    .divider { text-align: center; font-size: 11px; color: #94a3b8;
               margin: 20px 0; border-top: 1px dashed #cbd5e1; padding-top: 12px; }

    /* ── Message layout ── */
    .msg-wrap { display: flex; margin: 14px 0; }
    .msg-wrap.user      { justify-content: flex-end; }
    .msg-wrap.assistant { justify-content: flex-start; }
    .msg-inner { max-width: 76%; }
    .msg-meta { font-size: 10px; color: #94a3b8; margin-bottom: 3px; }
    .bubble { padding: 11px 15px; border-radius: 14px; font-size: 13px;
              line-height: 1.6; word-break: break-word; }
    .bubble.user { background: #4f46e5; color: #fff;
                   border-radius: 14px 14px 4px 14px; }
    .bubble.assistant { background: #f8fafc; border: 1px solid #e2e8f0;
                        border-radius: 14px 14px 14px 4px; color: #1e293b; }

    /* ── Markdown elements inside bubbles ── */
    .bubble h1 { font-size: 1.2em; font-weight: 700; margin: .6em 0 .3em; }
    .bubble h2 { font-size: 1.1em; font-weight: 600; margin: .5em 0 .25em; }
    .bubble h3 { font-size: 1em;   font-weight: 600; margin: .4em 0 .2em; }
    .bubble p  { margin-bottom: .5em; }
    .bubble p:last-child { margin-bottom: 0; }
    .bubble ul, .bubble ol { padding-left: 1.4em; margin: .4em 0; }
    .bubble li { margin-bottom: .15em; }
    .bubble blockquote { border-left: 3px solid #94a3b8; padding-left: .75em;
                         margin: .5em 0; color: #64748b; font-style: italic; }
    .bubble pre { background: #0f172a; color: #e2e8f0; border-radius: 8px;
                  padding: 10px 12px; margin: .5em 0; font-size: .85em;
                  font-family: 'SFMono-Regular', Consolas, monospace;
                  overflow-x: auto; white-space: pre; }
    .bubble code { font-family: 'SFMono-Regular', Consolas, monospace; font-size: .88em; }
    .bubble pre code { background: none; padding: 0; border-radius: 0; color: inherit; }
    .bubble :not(pre) > code { background: rgba(0,0,0,.08); border-radius: 4px;
                                padding: 1px 5px; }
    .bubble.user :not(pre) > code { background: rgba(255,255,255,.2); }
    .bubble a  { color: #6366f1; text-decoration: underline; }
    .bubble.user a { color: #c7d2fe; }
    .bubble hr { border: none; border-top: 1px solid #e2e8f0; margin: .6em 0; }
    .bubble strong { font-weight: 600; }
    .bubble em     { font-style: italic; }
    /* GFM tables */
    .bubble table { border-collapse: collapse; width: 100%; margin: .5em 0; font-size: .9em; }
    .bubble th, .bubble td { border: 1px solid #e2e8f0; padding: 5px 10px; text-align: left; }
    .bubble th { background: #f1f5f9; font-weight: 600; }
    /* Task list checkboxes */
    .bubble input[type="checkbox"] { margin-right: 4px; }

    /* ── Footer stats ── */
    .stats-row { margin-top: 36px; padding-top: 16px; border-top: 2px solid #e2e8f0;
                 font-size: 12px; color: #64748b; display: flex; gap: 28px; }

    @media print { body { padding: 18px; } }
  </style>
</head>
<body>
  <div class="doc-header">
    <h1>${esc(title)}</h1>
    <div class="meta">
      <span>Session #${session.id}</span>
      ${conversationId ? `<span>Conv #${conversationId}</span>` : ''}
      <span>${new Date(session.created_at).toLocaleString()}</span>
      <span>Cost: ${fmtCostSimple(totalCost)}</span>
      <span>${stats.totalTokens.toLocaleString()} tokens · ${stats.totalCalls} call${stats.totalCalls !== 1 ? 's' : ''}</span>
    </div>
  </div>

  ${messages.map((msg, i) => {
    const showDivider = !msg.fromPrior && i > 0 && messages[i - 1]?.fromPrior
    const contentHtml = msg.role === 'assistant'
      ? mdToHtml(msg.content)
      : `<p>${esc(msg.content).replace(/\n/g, '<br>')}</p>`
    return `
      ${showDivider ? '<div class="divider">✦ New session started</div>' : ''}
      <div class="msg-wrap ${msg.role}" style="${msg.fromPrior ? 'opacity:0.45' : ''}">
        <div class="msg-inner">
          ${msg.role === 'assistant' && msg.model
            ? `<div class="msg-meta">${esc(msg.provider ?? '')}/${esc(msg.model)}</div>`
            : ''}
          <div class="bubble ${msg.role}">${contentHtml}</div>
        </div>
      </div>`
  }).join('\n')}

  <div class="stats-row">
    <span>${stats.totalCalls} call${stats.totalCalls !== 1 ? 's' : ''}</span>
    <span>${stats.totalTokens.toLocaleString()} tokens</span>
    <span>Total cost: ${fmtCostSimple(totalCost)}</span>
  </div>
</body>
</html>`)
    win.document.close()
    win.print()
  }

  function startRenameConv() {
    setRenameConvValue(session?.title ?? '')
    setRenamingConv(true)
  }

  async function submitRenameConv() {
    if (!conversationId || !renameConvValue.trim()) return
    setRenamingConvSaving(true)
    try {
      await api.chat.renameConversation(conversationId, renameConvValue.trim())
      setSession(prev => prev ? { ...prev, title: renameConvValue.trim() } : prev)
      setRenamingConv(false)
    } catch {
      // silent — user can retry
    } finally {
      setRenamingConvSaving(false)
    }
  }

  async function handleEndChat() {
    if (!session) return
    setEnding(true)
    try {
      const summary = await api.chat.endSession(session.id)
      setEndSummary(summary)
      setSession(null)
      localStorage.removeItem('active_chat_session')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to end chat')
    } finally {
      setEnding(false)
    }
  }

  function handleNewChat() {
    setMessages([])
    setStats({ totalCalls: 0, totalTokens: 0, totalCost: 0, transactions: [], routerCalls: 0, routerTokens: 0, routerCost: 0 })
    setStatsView('interactions')
    setEndSummary(null)
    setError('')
    setAttachments([])
    setAttachmentPreviews([])
    setConversationId(null)
    setSession(null)
    setResponseRatings({})
    setRoutingRatings({})
  }

  async function handleResponseRating(messageId: number, rating: number) {
    setResponseRatings(prev => ({ ...prev, [messageId]: rating }))
    try {
      await api.chat.rateMessage(messageId, { rating })
    } catch {
      setResponseRatings(prev => { const next = { ...prev }; delete next[messageId]; return next })
    }
  }

  async function handleRoutingRating(interactionId: number, rating: number) {
    setRoutingRatings(prev => ({ ...prev, [interactionId]: rating }))
    try {
      await api.chat.rateInteraction(interactionId, { rating })
    } catch {
      setRoutingRatings(prev => { const next = { ...prev }; delete next[interactionId]; return next })
    }
  }

  const _imageNouns = '(?:image|picture|photo|photograph|illustration|artwork|painting|wallpaper|logo|banner|graphic|visual|portrait|landscape|drawing|sketch)'
  const _art = '(?:a|an|the|my|your|me|us|one|some|this|that)\\s+'
  const looksLikeMediaRequest = new RegExp(
    '(?:'
    + `\\b(?:draw|paint|sketch|illustrate|render)\\b\\s+${_art}\\w`
    + `|\\b(?:generate|create|make|produce|design)\\b[^.!?\\n]{0,80}?${_imageNouns}`
    + `|\\b(?:show|give)\\s+me\\b[^.!?\\n]{0,50}?${_imageNouns}`
    + '|\\b(?:generate|make|create)\\s+(?:[a-z]+\\s+){0,3}(?:audio|video|speech|voice\\s+clip)'
    + ')',
    'i',
  ).test(input)
  const canSend = session && (input.trim() || attachments.length > 0) && provider && model && !sending
  const sendBlockReason = !session ? null
    : !model ? 'Select a model to send'
    : (!input.trim() && attachments.length === 0) ? 'Type a message or attach a file'
    : null
  const interactionGroups = buildInteractionGroups(stats.transactions)
  const activeInteraction = typeof statsView === 'number'
    ? interactionGroups.find(g => g.interactionId === statsView) ?? null
    : null

  // ── Start screen ─────────────────────────────────────────────────────────────
  if (!session && !endSummary) {
    return (
      <div className="flex h-screen overflow-hidden flex-col">
        <header className="shrink-0 px-6 py-4 border-b border-slate-200 bg-white">
          <h1 className="text-2xl font-bold text-slate-900">Chat</h1>
          <p className="text-slate-500 mt-0.5 text-sm">
            Start a multi-model conversation — switch models mid-chat freely
          </p>
        </header>
        <div className="flex-1 flex items-center justify-center bg-slate-50">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8 w-full max-w-md">
            <h2 className="text-lg font-semibold text-slate-800 mb-1">New Conversation</h2>
            <p className="text-sm text-slate-500 mb-6">
              Choose a starting model. You can switch models at any time during the conversation.
            </p>
            {error && (
              <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Provider</label>
                <select
                  value={provider}
                  onChange={e => setProvider(e.target.value)}
                  disabled={routerLlmGlobal && useRouterLlm}
                  className={`w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 ${routerLlmGlobal && useRouterLlm ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  <option value="">Select provider…</option>
                  {providers.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Model</label>
                <ModelTooltip above model={!(routerLlmGlobal && useRouterLlm) ? selectedModelData : null}>
                  <select
                    value={model}
                    onChange={e => setModel(e.target.value)}
                    disabled={!provider || models.length === 0 || (routerLlmGlobal && useRouterLlm)}
                    className={`w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 ${routerLlmGlobal && useRouterLlm ? 'cursor-not-allowed' : ''}`}
                  >
                    <option value="">
                      {!provider ? 'Select provider first' : models.length === 0 ? 'Loading…' : 'Select model…'}
                    </option>
                    {models.map(m => (
                      <option key={m.model} value={m.model}
                        title={`Context: ${fmtCtx(m.context_length)} | Input: ${fmtRate(m.input_per_million)} | Output: ${fmtRate(m.output_per_million)}`}>
                        {m.model}{m.input_per_million === 0 ? ' (free)' : ''}
                      </option>
                    ))}
                  </select>
                </ModelTooltip>
                {routerLlmGlobal && useRouterLlm && (
                  <p className="mt-1 text-xs text-slate-400">Router LLM will select the model. Values above serve as fallback.</p>
                )}
              </div>
              <div>
                <label className={`block text-sm font-medium mb-1.5 ${routerLlmGlobal && useRouterLlm ? 'text-slate-400' : 'text-slate-700'}`}>
                  Answering LLM System Message <span className="font-normal opacity-60">(optional)</span>
                </label>
                <textarea
                  value={systemMessage}
                  onChange={e => setSystemMessage(e.target.value)}
                  disabled={routerLlmGlobal && useRouterLlm}
                  rows={3}
                  placeholder={
                    routerLlmGlobal && useRouterLlm
                      ? 'Not used when Router LLM is enabled'
                      : 'Override the generic system message for this conversation…'
                  }
                  className={`w-full border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                    routerLlmGlobal && useRouterLlm
                      ? 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
                      : 'border-slate-300 bg-white'
                  }`}
                />
                <p className="mt-1 text-xs text-slate-400">
                  {routerLlmGlobal && useRouterLlm
                    ? 'Router LLM manages model selection — the answering LLM system message is not applied.'
                    : 'Leave blank to use the generic system message from Settings.'}
                </p>
              </div>
              <RouterLlmToggle
                variant="panel"
                routerLlmGlobal={routerLlmGlobal}
                useRouterLlm={useRouterLlm}
                setUseRouterLlm={setUseRouterLlm}
              />
              <button
                onClick={handleStartChat}
                disabled={(!provider || !model) && !(routerLlmGlobal && useRouterLlm) || starting}
                className="w-full py-2.5 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {starting ? <><Spinner /> Starting…</> : 'Start Chat'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── End summary screen ────────────────────────────────────────────────────────
  if (endSummary) {
    return (
      <div className="flex h-screen overflow-hidden flex-col">
        <header className="shrink-0 px-6 py-4 border-b border-slate-200 bg-white">
          <h1 className="text-2xl font-bold text-slate-900">Chat Ended</h1>
        </header>
        <div className="flex-1 flex items-center justify-center bg-slate-50">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8 w-full max-w-md space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-slate-800 mb-4">Session Summary</h2>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: 'Messages', value: String(endSummary.message_count) },
                  { label: 'Tokens', value: endSummary.total_tokens.toLocaleString() },
                  { label: 'Total Cost', value: fmtCost(endSummary.total_cost) },
                ].map(({ label, value }) => (
                  <div key={label} className="text-center bg-slate-50 rounded-xl p-4">
                    <p className="text-xs text-slate-400 mb-1">{label}</p>
                    <p className="font-semibold text-slate-800 font-mono">{value}</p>
                  </div>
                ))}
              </div>
            </div>
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">{error}</div>
            )}
            <div className="flex gap-3">
              {conversationId && (
                <button
                  onClick={handleRestartChat}
                  disabled={restarting}
                  className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                  {restarting ? <><Spinner /> Restarting…</> : 'Restart Chat'}
                </button>
              )}
              <button
                onClick={handleNewChat}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 transition-colors"
              >
                New Conversation
              </button>
            </div>
            <a
              href="/history"
              className="block text-center text-sm text-indigo-600 hover:underline"
            >
              View History
            </a>
          </div>
        </div>
      </div>
    )
  }

  // ── Active chat view ──────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen overflow-hidden flex-col">
      <div className="shrink-0 px-6 pt-2 bg-white border-b border-slate-100">
        <ProviderKeyBanner compact />
      </div>
      {/* Header */}
      <header className="shrink-0 px-6 py-3 border-b border-slate-200 bg-white flex items-center justify-between">
        <div className="min-w-0 flex-1 mr-4">
          {renamingConv ? (
            <form
              onSubmit={e => { e.preventDefault(); submitRenameConv() }}
              className="flex items-center gap-2"
            >
              <input
                autoFocus
                value={renameConvValue}
                onChange={e => setRenameConvValue(e.target.value)}
                onKeyDown={e => e.key === 'Escape' && setRenamingConv(false)}
                className="flex-1 min-w-0 text-sm font-semibold border border-indigo-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white text-slate-900"
                placeholder="Conversation name…"
              />
              <button
                type="submit"
                disabled={renamingConvSaving || !renameConvValue.trim()}
                className="shrink-0 px-3 py-1 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {renamingConvSaving ? '…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => setRenamingConv(false)}
                className="shrink-0 px-3 py-1 text-xs font-medium text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
            </form>
          ) : (
            <div className="group/title flex items-center gap-1.5 min-w-0">
              <h1 className="text-base font-semibold text-slate-900 truncate">
                {session?.title ?? 'New Chat'}
              </h1>
              {conversationId && (
                <button
                  onClick={startRenameConv}
                  title="Rename conversation"
                  className="shrink-0 opacity-0 group-hover/title:opacity-100 transition-opacity p-1 text-slate-400 hover:text-indigo-600 rounded"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                  </svg>
                </button>
              )}
            </div>
          )}
          <p className="text-xs text-slate-400 mt-0.5">
            {conversationId ? `Conv #${conversationId} · ` : ''}Session #{session?.id}
            {branches.length > 1 && (
              <span className="ml-2">
                · Branch:{' '}
                <select
                  value={activeBranchId}
                  onChange={e => handleSwitchBranch(Number(e.target.value))}
                  className="text-xs border border-slate-200 rounded px-1 py-0.5 bg-white"
                >
                  {branches.map(b => (
                    <option key={b.id} value={b.id}>{b.label}</option>
                  ))}
                </select>
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {messages.length > 0 && (
            <button
              onClick={handleExportPdf}
              title="Export session to PDF"
              className="px-3 py-2 rounded-lg text-sm font-medium text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Export PDF
            </button>
          )}
          <button
            onClick={handleEndChat}
            disabled={ending}
            className="px-4 py-2 rounded-lg text-sm font-medium text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {ending ? <><Spinner sm /> Ending…</> : 'End Chat'}
          </button>
        </div>
      </header>

      {/* Body: messages + stats */}
      <div className="flex flex-1 min-h-0">
        {/* Messages column */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          <div className="flex-1 overflow-y-auto min-h-0 px-6 py-4 space-y-4">
            {messages.length === 0 && (
              <div className="flex items-center justify-center h-full text-slate-400 text-sm">
                Send your first message to begin
              </div>
            )}
            {messages.map((msg, i) => {
              const showDivider = !msg.fromPrior && i > 0 && messages[i - 1]?.fromPrior === true
              return (
                <div key={i}>
                  {showDivider && (
                    <div className="flex items-center gap-2 my-2">
                      <div className="flex-1 border-t border-dashed border-slate-300" />
                      <span className="text-xs text-slate-400 shrink-0">New session started</span>
                      <div className="flex-1 border-t border-dashed border-slate-300" />
                    </div>
                  )}
                  <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} ${msg.fromPrior ? 'opacity-50' : ''}`}>
                    {msg.role === 'user' ? (
                      <div className="max-w-[70%] bg-indigo-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">
                        {msg.content}
                      </div>
                    ) : (
                      <div className="max-w-[70%] space-y-1.5">
                        {!msg.fromPrior && msg.messageId && session && (
                          <div className="flex items-center gap-2 px-1 mb-0.5">
                            <button
                              type="button"
                              onClick={() => handleBranchFrom(msg.messageId!)}
                              disabled={branchingMessageId === msg.messageId}
                              className="text-[10px] font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
                            >
                              {branchingMessageId === msg.messageId ? 'Branching…' : 'Branch here'}
                            </button>
                          </div>
                        )}
                        {msg.model && (
                          <p className="text-xs text-slate-400 px-1">
                            {msg.provider}/{msg.model}
                            {msg.transaction && (
                              <span className="ml-2 text-slate-300">
                                {msg.transaction.is_image
                                  ? '· image · ' + msg.transaction.time_taken.toFixed(2) + 's'
                                  : `· ${msg.transaction.prompt_tokens + msg.transaction.response_tokens} tokens · ${fmtCost(msg.transaction.total_cost)} · ${msg.transaction.time_taken.toFixed(2)}s`
                                }
                              </span>
                            )}
                          </p>
                        )}
                        {msg.image_url ? (
                          <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm overflow-hidden shadow-sm">
                            <AuthenticatedImage
                              url={msg.image_url}
                              alt="Generated image"
                              className="max-w-full rounded-2xl rounded-tl-sm"
                            />
                            {msg.content && !msg.content.startsWith('!image:') && (
                              <div className="px-4 py-2 text-xs text-slate-500 border-t border-slate-100 prose prose-sm max-w-none">
                                <MarkdownContent content={msg.content} />
                              </div>
                            )}
                          </div>
                        ) : msg.streaming && !msg.content ? (
                          <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                            <div className="flex gap-1 items-center">
                              <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:0ms]" />
                              <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:150ms]" />
                              <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:300ms]" />
                            </div>
                          </div>
                        ) : (
                          <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-slate-800 shadow-sm">
                            {msg.streaming ? (
                              <div className="whitespace-pre-wrap leading-relaxed font-sans">
                                {msg.webSearchSources?.length
                                  ? contentWithoutBraveFooter(msg.content)
                                  : msg.content}
                              </div>
                            ) : (
                              <MarkdownContent
                                content={
                                  msg.webSearchSources?.length
                                    ? contentWithoutBraveFooter(msg.content)
                                    : msg.content
                                }
                              />
                            )}
                          </div>
                        )}

                        {msg.webSearchSources && msg.webSearchSources.length > 0 && (
                          <BraveSearchSources sources={msg.webSearchSources} compact />
                        )}

                        {/* ── Rating bar ─────────────────────────────────── */}
                        {!msg.fromPrior && !msg.streaming && (msg.messageId || msg.interactionId) && (
                          <div className="flex items-center gap-3 px-1 pt-1.5 flex-wrap">

                            {/* Response quality — only when not router-routed (routing has its own control) */}
                            {msg.messageId && !msg.routerRouted && (
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-slate-400 shrink-0">Response</span>
                                <div className="flex items-center bg-slate-100 rounded-full p-0.5 gap-0.5">
                                  {([
                                    { r: 1, label: 'Wrong' },
                                    { r: 2, label: 'OK' },
                                    { r: 3, label: 'Great' },
                                  ] as const).map(({ r, label }) => (
                                    <button
                                      key={r}
                                      onClick={() => handleResponseRating(msg.messageId!, r)}
                                      className={`text-xs px-2.5 py-0.5 rounded-full transition-all duration-150 font-medium ${
                                        responseRatings[msg.messageId!] === r
                                          ? 'bg-white text-slate-800 shadow-sm'
                                          : 'text-slate-500 hover:text-slate-700'
                                      }`}
                                    >
                                      {label}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Routing quality — Apple segmented control */}
                            {msg.routerRouted && msg.interactionId && (
                              <div className="flex items-center gap-1.5">
                                <svg className="w-3 h-3 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                                <div className="flex items-center bg-slate-100 rounded-full p-0.5 gap-0.5">
                                  {([
                                    { r: 1, label: 'Wrong' },
                                    { r: 2, label: 'OK' },
                                    { r: 3, label: 'Great' },
                                  ] as const).map(({ r, label }) => (
                                    <button
                                      key={r}
                                      onClick={() => handleRoutingRating(msg.interactionId!, r)}
                                      className={`text-xs px-2.5 py-0.5 rounded-full transition-all duration-150 font-medium ${
                                        routingRatings[msg.interactionId!] === r
                                          ? 'bg-white text-slate-800 shadow-sm'
                                          : 'text-slate-500 hover:text-slate-700'
                                      }`}
                                    >
                                      {label}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}

                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Input bar */}
          <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-3">
            {masterNotice && (
              <div className={`mb-2 border rounded-lg px-3 py-2 text-xs flex items-center justify-between gap-2 ${
                masterNotice.startsWith('Router LLM unavailable')
                  ? 'bg-amber-50 border-amber-200 text-amber-700'
                  : 'bg-indigo-50 border-indigo-200 text-indigo-700'
              }`}>
                <span>{masterNotice}</span>
                <button onClick={() => setMasterNotice(null)} className="shrink-0 opacity-60 hover:opacity-100">✕</button>
              </div>
            )}
            {looksLikeMediaRequest && !sending && (
              <div className="mb-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700 flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                Image, audio, and video generation typically costs more than text. Proceed with awareness.
              </div>
            )}
            {error && (
              <div className="mb-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
                {error}
              </div>
            )}
            {!model && session && (
              <p className="mb-1.5 text-xs text-amber-600 font-medium">
                Select a model above to re-enable sending.
              </p>
            )}
            {sending && (
              <div
                className={`mb-2 flex items-center gap-2 px-3 py-2 rounded-lg text-xs border ${
                  slowWarn === 'hard'
                    ? 'bg-amber-50 border-amber-200 text-amber-800'
                    : slowWarn === 'soft'
                      ? 'bg-yellow-50 border-yellow-200 text-yellow-800'
                      : 'bg-indigo-50 border-indigo-100 text-indigo-700'
                }`}
              >
                <Spinner sm />
                <span className="flex-1 min-w-0 truncate">
                  {streamStatus
                    ?? (routerLlmGlobal && useRouterLlm
                      ? 'Router LLM is selecting a model…'
                      : `Waiting for ${provider} / ${model}…`)}
                  {slowWarn === 'hard' && ' — this is taking longer than usual'}
                  {slowWarn === 'soft' && ' — still working…'}
                </span>
                {elapsed > 0 && (
                  <span className="shrink-0 font-mono opacity-70">{elapsed}s</span>
                )}
                <button
                  type="button"
                  onClick={handleCancelSend}
                  className="shrink-0 px-2 py-0.5 rounded border border-current/30 hover:bg-white/50 font-medium"
                >
                  Cancel
                </button>
              </div>
            )}
            <div className="flex items-end gap-2 mb-2 flex-wrap">
              <select
                value={provider}
                onChange={e => setProvider(e.target.value)}
                disabled={routerLlmGlobal && useRouterLlm}
                className={`border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 ${routerLlmGlobal && useRouterLlm ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                {providers.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <ModelTooltip above model={!(routerLlmGlobal && useRouterLlm) ? selectedModelData : null}>
                <select
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  disabled={!provider || models.length === 0 || (routerLlmGlobal && useRouterLlm)}
                  className={`border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50 max-w-xs truncate ${routerLlmGlobal && useRouterLlm ? 'cursor-not-allowed' : ''}`}
                >
                  {models.map(m => (
                    <option key={m.model} value={m.model}
                      title={`Context: ${fmtCtx(m.context_length)} | Input: ${fmtRate(m.input_per_million)} | Output: ${fmtRate(m.output_per_million)}`}>
                      {m.model}
                    </option>
                  ))}
                </select>
              </ModelTooltip>
              <RouterLlmToggle
                routerLlmGlobal={routerLlmGlobal}
                useRouterLlm={useRouterLlm}
                setUseRouterLlm={setUseRouterLlm}
              />
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.txt,.md,.csv,.json"
              onChange={handleFileChange}
              className="hidden"
            />
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {attachments.map((att, i) => (
                  <div key={i} className="flex items-center gap-1 bg-indigo-50 border border-indigo-200 rounded-lg px-2 py-1 text-xs">
                    {attachmentPreviews[i] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={attachmentPreviews[i]} alt={att.name} className="w-6 h-6 rounded object-cover" />
                    ) : (
                      <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    )}
                    <span className="text-indigo-700 max-w-24 truncate">{att.name}</span>
                    <button onClick={() => removeAttachment(i)} className="text-indigo-400 hover:text-indigo-700 ml-0.5">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
            {costEstimate?.is_image && costEstimate.pricing_available && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
                Estimated image cost: ~{fmtCost(costEstimate.estimated_cost)} using{' '}
                {costEstimate.provider}/{costEstimate.model}
                <span className="text-amber-600/80"> (approximate; actual cost may vary)</span>
              </p>
            )}
            <form onSubmit={handleSend} className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e as unknown as React.FormEvent) }
                }}
                placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
                rows={2}
                className="flex-1 border border-slate-300 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Attach file"
                className="shrink-0 p-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-500 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
              </button>
              <button
                type="submit"
                disabled={!canSend}
                title={sendBlockReason ?? undefined}
                className="shrink-0 p-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-white relative group/sendbtn"
              >
                {sending ? (
                  <Spinner />
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                  </svg>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Stats panel */}
        <aside className="w-72 shrink-0 border-l border-slate-200 bg-slate-50 flex flex-col min-h-0">
          {/* Panel header */}
          <div className="shrink-0 px-4 py-3 border-b border-slate-200 bg-white flex items-center justify-between min-h-[44px]">
            {typeof statsView === 'number' ? (
              <>
                <div className="min-w-0">
                  <button
                    onClick={() => setStatsView('interactions')}
                    className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                  >
                    ← Interactions
                  </button>
                  <p className="text-xs font-semibold text-slate-700 truncate mt-0.5">
                    {activeInteraction?.model ?? 'Messages'}
                  </p>
                </div>
                <span className="text-xs text-slate-400 shrink-0">
                  {activeInteraction?.callCount ?? 0} calls
                </span>
              </>
            ) : (
              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Session Stats</h2>
            )}
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto min-h-0 px-3 py-3 space-y-2">
            {/* Interaction groups view (default) */}
            {statsView === 'interactions' && (
              interactionGroups.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">No calls yet</p>
              ) : (
                interactionGroups.map(g => (
                  <div key={g.interactionId} className="bg-white rounded-lg border border-slate-200 px-3 py-2.5 text-xs space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-slate-700 truncate">{g.model}</p>
                        <p className="text-slate-400">{g.provider}</p>
                      </div>
                      <button
                        onClick={() => setStatsView(g.interactionId)}
                        className="shrink-0 text-indigo-500 hover:text-indigo-700 text-xs mt-0.5"
                      >
                        Messages →
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-x-2 text-slate-500 pt-0.5 border-t border-slate-50">
                      <span>Calls</span>
                      <span className="font-mono text-right">{g.callCount}</span>
                      <span>Tokens</span>
                      <span className="font-mono text-right">{g.totalTokens.toLocaleString()}</span>
                      <span>Avg Time</span>
                      <span className="font-mono text-right">{g.avgTimeTaken.toFixed(2)}s</span>
                      <span>Cost</span>
                      <span className="font-mono text-right text-slate-800">{fmtCost(g.totalCost)}</span>
                    </div>
                  </div>
                ))
              )
            )}

            {/* Message drill-down view */}
            {typeof statsView === 'number' && (
              activeInteraction && activeInteraction.transactions.length > 0 ? (
                activeInteraction.transactions.map((t, i) => (
                  <div key={t.event_id} className="bg-white rounded-lg border border-slate-200 px-3 py-2.5 text-xs space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-700">#{i + 1}</span>
                      <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${
                        t.http_code === 200 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                      }`}>{t.http_code}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-2 text-slate-500">
                      <span>Tokens</span>
                      <span className="font-mono text-right">{(t.prompt_tokens + t.response_tokens).toLocaleString()}</span>
                      <span>Input cost</span>
                      <span className="font-mono text-right">{fmtCost(t.input_cost)}</span>
                      <span>Output cost</span>
                      <span className="font-mono text-right">{fmtCost(t.output_cost)}</span>
                      <span>Total cost</span>
                      <span className="font-mono text-right text-slate-800">{fmtCost(t.total_cost)}</span>
                      <span>Time</span>
                      <span className="font-mono text-right">{t.time_taken.toFixed(2)}s</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-400 text-center py-6">No messages</p>
              )
            )}
          </div>

          {/* Router LLM cost — visible when router was used */}
          {stats.routerCalls > 0 && (
            <div className="shrink-0 border-t border-indigo-100 bg-indigo-50 px-4 py-3 space-y-1.5">
              <p className="text-xs font-semibold text-indigo-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Router LLM
              </p>
              {[
                { label: 'Calls', value: String(stats.routerCalls) },
                { label: 'Tokens', value: stats.routerTokens.toLocaleString() },
                { label: 'Cost', value: fmtCost(stats.routerCost) },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between text-xs">
                  <span className="text-indigo-500">{label}</span>
                  <span className="font-mono font-medium text-indigo-700">{value}</span>
                </div>
              ))}
            </div>
          )}

          {/* Session totals — always visible */}
          <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 space-y-1.5">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Session Totals</p>
            {[
              { label: 'LLM Calls', value: String(stats.totalCalls) },
              { label: 'LLM Tokens', value: stats.totalTokens.toLocaleString() },
              { label: 'LLM Cost', value: fmtCost(stats.totalCost) },
              ...(stats.routerCalls > 0 ? [
                { label: 'Router Cost', value: fmtCost(stats.routerCost) },
              ] : []),
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between text-xs">
                <span className="text-slate-500">{label}</span>
                <span className="font-mono font-medium text-slate-800">{value}</span>
              </div>
            ))}
            {stats.routerCalls > 0 && (
              <div className="flex justify-between text-xs border-t border-slate-100 pt-1.5 mt-1">
                <span className="font-semibold text-slate-700">Grand Total</span>
                <span className="font-mono font-bold text-slate-900">{fmtCost(stats.totalCost + stats.routerCost)}</span>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
