import { downloadFile } from './client'
import type {
  AppConfig,
  InvokeResult,
  MessageAttachment,
  ModelPricing,
  Paginated,
  Stats,
  UsageAudit,
  Credit,
  ChatSession,
  ChatSessionSummary,
  ChatSessionDetail,
  ChatSendResult,
  ChatStreamEvent,
  ChatEndResult,
  ChatConversationSummary,
  ChatConversationDetail,
  ApiKey,
  LlmRoutingStatus,
  ActiveKeyContext,
  ContactSubmitResult,
  OpenRouterCredits,
  SpendingTrendPoint,
  OllamaStatus,
  OllamaSyncResult,
  AppSettings,
  RoutingRating,
  UsageConversation,
  UsageSession,
  UsageInteraction,
  UsageMessage,
  MessageRating,
  CostEstimate,
  ChatBranch,
} from '../types'
import { authApi } from './auth'
import { API_BASE, qs, request } from './client'

async function streamChat(
  sessionId: number,
  data: {
    provider: string
    model: string
    content: string
    attachments?: MessageAttachment[]
    use_router_llm?: boolean
    idempotency_key?: string
  },
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
  const csrfMatch =
    typeof document !== 'undefined'
      ? document.cookie.match(/(?:^|;\s*)llm_explorer_csrf=([^;]+)/)
      : null
  const res = await fetch(`${API_BASE}/api/chat/sessions/${sessionId}/messages/stream`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(csrfMatch ? { 'X-CSRF-Token': decodeURIComponent(csrfMatch[1]) } : {}),
    },
    body: JSON.stringify(data),
    signal,
  })
  if (res.status === 401) {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_token')
      localStorage.removeItem('auth_email')
      window.location.href = '/login'
    }
    throw new Error('Session expired. Please log in again.')
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string }
    throw new Error(err.detail ?? `HTTP ${res.status}`)
  }
  const reader = res.body?.getReader()
  if (!reader) throw new Error('Streaming not supported')
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? ''
    for (const block of blocks) {
      for (const line of block.split('\n')) {
        if (!line.startsWith('data: ')) continue
        onEvent(JSON.parse(line.slice(6)) as ChatStreamEvent)
      }
    }
  }
}

export const api = {
  stats: () => request<Stats>('/api/stats'),
  models: (params: Record<string, string | number | undefined | null> = {}) =>
    request<Paginated<ModelPricing>>(`/api/models${qs(params)}`),
  providers: () => request<string[]>('/api/models/providers'),
  categories: () => request<string[]>('/api/models/categories'),
  syncModels: (source: 'openrouter' | 'local' | 'groq') =>
    request<{ output: string; stderr: string }>('/api/models/sync', {
      method: 'POST',
      body: JSON.stringify({ source }),
    }),
  usage: (params: Record<string, string | number | undefined | null> = {}) =>
    request<Paginated<UsageAudit>>(`/api/usage${qs(params)}`),
  usageHierarchy: {
    conversations: (params: { page?: number; page_size?: number } = {}) =>
      request<Paginated<UsageConversation> & { direct_calls_count: number; direct_calls_cost: number }>(
        `/api/usage/conversations${qs(params)}`,
      ),
    sessions: (convId: number) =>
      request<{ items: UsageSession[] }>(`/api/usage/conversations/${convId}/sessions`),
    interactions: (sessionId: number) =>
      request<{ items: UsageInteraction[] }>(`/api/usage/sessions/${sessionId}/interactions`),
    messages: (interactionId: number) =>
      request<{ items: UsageMessage[] }>(`/api/usage/interactions/${interactionId}/messages`),
  },
  wallet: (params: Record<string, string | number | undefined | null> = {}) =>
    request<Paginated<Credit> & { wallet_balance: number; balance: number }>(
      `/api/wallet${qs(params)}`,
    ),
  /** @deprecated Use wallet */
  balance: (params: Record<string, string | number | undefined | null> = {}) =>
    request<Paginated<Credit> & { wallet_balance: number; balance: number }>(
      `/api/wallet${qs(params)}`,
    ),
  exportUsageAudit: (format: 'csv' | 'json') =>
    downloadFile(`/api/usage/export?format=${format}`, `usage_audit.${format}`),
  invoke: (provider: string, model: string, prompt: string) =>
    request<InvokeResult>('/api/invoke', {
      method: 'POST',
      body: JSON.stringify({ provider, model, prompt }),
    }),
  currency: () => request<Record<string, number>>('/api/currency'),
  config: () => request<AppConfig>('/api/config'),
  updateConfig: (data: { api_key?: string; brave_api_key?: string }) =>
    request<{ status: string }>('/api/config', { method: 'PUT', body: JSON.stringify(data) }),
  persistConfig: (data: { api_key?: string; brave_api_key?: string }) =>
    request<{ status: string }>('/api/admin/config/persist', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  settings: {
    get: () => request<AppSettings>('/api/settings'),
    update: (data: {
      generic_system_message?: string
      router_llm_enabled?: boolean
      router_llm_system_message?: string
      router_llm_provider?: string
      router_llm_model?: string
    }) =>
      request<{ status: string }>('/api/settings', { method: 'PUT', body: JSON.stringify(data) }),
  },
  chat: {
    createSession: (opts?: { system_message?: string }) =>
      request<ChatSession>('/api/chat/sessions', { method: 'POST', body: JSON.stringify(opts ?? {}) }),
    restartConversation: (convId: number) =>
      request<ChatSession>(`/api/chat/conversations/${convId}/sessions`, { method: 'POST' }),
    listConversations: (params: Record<string, string | number | undefined | null> = {}) =>
      request<Paginated<ChatConversationSummary>>(`/api/chat/conversations${qs(params)}`),
    searchConversations: (q: string, params: { page?: number; page_size?: number } = {}) =>
      request<Paginated<ChatConversationSummary>>(
        `/api/chat/conversations/search${qs({ q, ...params })}`,
      ),
    estimateCost: (data: { provider: string; model: string; content: string }) =>
      request<CostEstimate>('/api/chat/estimate-cost', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    listBranches: (sessionId: number) =>
      request<{ items: ChatBranch[] }>(`/api/chat/sessions/${sessionId}/branches`),
    createBranch: (sessionId: number, forkMessageId: number) =>
      request<{ branch_id: number; label: string; fork_message_id: number }>(
        `/api/chat/sessions/${sessionId}/branches`,
        { method: 'POST', body: JSON.stringify({ fork_message_id: forkMessageId }) },
      ),
    setActiveBranch: (sessionId: number, branchId: number) =>
      request<{ active_branch_id: number }>(
        `/api/chat/sessions/${sessionId}/branches/active`,
        { method: 'PATCH', body: JSON.stringify({ branch_id: branchId }) },
      ),
    getConversation: (id: number) => request<ChatConversationDetail>(`/api/chat/conversations/${id}`),
    renameConversation: (id: number, title: string) =>
      request<{ id: number; title: string }>(`/api/chat/conversations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      }),
    listSessions: (params: Record<string, string | number | undefined | null> = {}) =>
      request<Paginated<ChatSessionSummary>>(`/api/chat/sessions${qs(params)}`),
    getSession: (id: number) => request<ChatSessionDetail>(`/api/chat/sessions/${id}`),
    sendMessage: (
      sessionId: number,
      data: {
        provider: string
        model: string
        content: string
        attachments?: MessageAttachment[]
        use_router_llm?: boolean
        idempotency_key?: string
      },
    ) =>
      request<ChatSendResult>(`/api/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    sendMessageStream: streamChat,
    endSession: (sessionId: number) =>
      request<ChatEndResult>(`/api/chat/sessions/${sessionId}/end`, { method: 'POST' }),
    deleteSession: (sessionId: number) =>
      request<{ deleted: boolean; id: number }>(`/api/chat/sessions/${sessionId}`, { method: 'DELETE' }),
    rateInteraction: (interactionId: number, data: { rating: number; comment?: string }) =>
      request<RoutingRating>(`/api/chat/interactions/${interactionId}/rating`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    rateMessage: (messageId: number, data: { rating: number; comment?: string }) =>
      request<MessageRating>(`/api/chat/messages/${messageId}/rating`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
  keys: {
    activeContext: () => request<ActiveKeyContext>('/api/keys/active-context'),
    routing: () => request<LlmRoutingStatus>('/api/keys/routing'),
    setRouting: (routing: 'openrouter' | 'groq') =>
      request<LlmRoutingStatus>('/api/keys/routing', {
        method: 'PUT',
        body: JSON.stringify({ routing }),
      }),
    list: () => request<ApiKey[]>('/api/keys'),
    add: (data: { name: string; provider?: string; key_value: string }) =>
      request<ApiKey>('/api/keys', { method: 'POST', body: JSON.stringify(data) }),
    activate: (id: number) => request<{ status: string }>(`/api/keys/${id}/activate`, { method: 'PUT' }),
    delete: (id: number) => request<{ deleted: boolean; id: number }>(`/api/keys/${id}`, { method: 'DELETE' }),
  },
  auth: authApi,
  openrouterCredits: () => request<OpenRouterCredits>('/api/openrouter/credits'),
  syncOpenRouterCredits: () =>
    request<OpenRouterCredits>('/api/openrouter/credits/sync', { method: 'POST' }),
  trend: (days = 7) => request<SpendingTrendPoint[]>(`/api/stats/trend?days=${days}`),
  trendHourly: () => request<SpendingTrendPoint[]>('/api/stats/trend/hourly'),
  ollama: {
    status: () => request<OllamaStatus>('/api/ollama/status'),
    sync: () => request<OllamaSyncResult>('/api/ollama/models/sync', { method: 'POST' }),
  },
  modelStats: () =>
    request<{ counts: Record<string, number>; last_updated: string | null }>('/api/models/stats'),
  contact: {
    submit: (data: { subject: string; message: string; rating: number }) =>
      request<ContactSubmitResult>('/api/contact', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
}
