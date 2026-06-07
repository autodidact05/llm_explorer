export interface ModelPricing {
  router: string
  provider: string
  model: string
  category: string | null
  description: string | null
  context_length: number | null
  input_per_million: number
  output_per_million: number
  last_updated: string
  status: 'active' | 'expired'
  is_local: 0 | 1
  sync_source: string | null
}

export interface UsageAudit {
  event_id: number
  created_at: string
  router: string
  provider: string
  model: string
  prompt_tokens: number
  response_tokens: number
  input_cost: number
  output_cost: number
  time_taken: number
  http_code: number
  http_details: string | null
  conversation_id: number | null
  session_id: number | null
  interaction_id: number | null
  message_id: number | null
}

export interface Credit {
  id: number
  created_at: string
  amount: number
  description: string
  conversation_id: number | null
}

export interface Stats {
  total_queries: number
  total_cost: number
  total_tokens: number
  avg_time_taken: number
  active_models: number
  expired_models: number
  credit_balance: number
  wallet_balance?: number
  recent_usage: UsageAudit[]
}

export interface CostEstimate {
  is_image: boolean
  provider: string
  model: string
  estimated_cost: number
  input_cost_est?: number
  output_cost_est?: number
  prompt_tokens_est: number
  response_tokens_est: number
  pricing_available: boolean
}

export interface ChatBranch {
  id: number
  fork_message_id: number | null
  label: string
  created_at: string | null
}

export interface AppConfig {
  api_key_set: boolean
  api_key_preview: string
  brave_api_key_set: boolean
  brave_api_key_preview: string
  db_path: string
  log_path: string
  models_csv_path: string
  local_csv_exists: boolean
}

export interface Paginated<T> {
  total: number
  page: number
  page_size: number
  items: T[]
}

export interface InvokeResult {
  event_id: number
  content: string
  prompt_tokens: number
  response_tokens: number
  input_cost: number
  output_cost: number
  total_cost: number
  time_taken: number
  http_code: number
}

export interface ChatSession {
  id: number
  conversation_id: number
  title: string | null
  status: 'active' | 'ended'
  created_at: string
  ended_at: string | null
}

export interface ChatConversationSummary {
  id: number
  title: string | null
  created_at: string
  session_count: number
  total_cost: number
  message_count: number
  last_session_at: string | null
  status: 'active' | 'ended'
}

export interface ChatConversationSessionSummary {
  id: number
  title: string | null
  status: 'active' | 'ended'
  created_at: string
  ended_at: string | null
  message_count: number
  total_cost: number
}

export interface ChatConversationDetail {
  id: number
  title: string | null
  created_at: string
  total_cost: number
  sessions: ChatConversationSessionSummary[]
}

export interface ChatInteraction {
  id: number
  provider: string
  model: string
  created_at: string
  message_count: number
  total_cost: number
  total_tokens: number
  avg_time_taken: number
  routed_by: string | null
  routing_reason: string | null
  router_estimated_cost: string | null
  router_confidence: number | null
  rating: number | null
  rating_comment: string | null
}

export interface RoutingRating {
  id: number
  interaction_id: number
  rating: number
  comment: string | null
}

export interface MessageAttachment {
  name: string
  mime_type: string
  data: string  // base64, no data-URL prefix
}

export interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  model: string | null
  provider: string | null
  event_id: number | null
  interaction_id: number | null
  created_at: string
  prompt_tokens: number | null
  response_tokens: number | null
  input_cost: number | null
  output_cost: number | null
  time_taken: number | null
  http_code: number | null
  response_rating: number | null
}

export interface MessageRating {
  id: number
  message_id: number
  rating: number
  comment: string | null
}

export interface ChatSessionSummary {
  id: number
  title: string | null
  status: 'active' | 'ended'
  created_at: string
  ended_at: string | null
  message_count: number
  total_cost: number
}

export interface RouterStats {
  calls: number
  tokens: number
  cost: number
}

export interface ChatSessionDetail extends ChatSession {
  total_cost: number
  router_stats?: RouterStats
  messages: ChatMessage[]
  prior_messages: ChatMessage[]
  branches?: ChatBranch[]
  active_branch_id?: number
  interactions: ChatInteraction[]
}

export interface ApiKey {
  id: number
  name: string
  provider: string
  key_preview: string
  is_active: 0 | 1
  created_at: string
}

export interface LlmRoutingLaneStatus {
  configured: boolean
  enabled: boolean
  key_preview: string | null
  key_name: string | null
}

export interface LlmRoutingStatus {
  active_routing: 'openrouter' | 'groq' | null
  openrouter: LlmRoutingLaneStatus
  groq: LlmRoutingLaneStatus
}

export interface ContactSubmitResult {
  id: number
  status: string
  message: string
  created_at: string
}

export interface ActiveKeyContext {
  has_active_key: boolean
  key_name?: string
  key_preview?: string
  key_provider: string | null
  routing: 'openrouter' | 'groq' | 'misconfigured' | null
  guide: {
    title: string
    summary: string
    tips: string[]
    models_filter?: string | null
    chat_model_hint?: string
    misconfigured?: boolean
  }
  models: {
    total: number
    sample: { provider: string; model: string }[]
    filter_hint: string | null
  }
  balance: {
    available: boolean
    source?: string
    label?: string
    remaining_usd?: number | null
    usage_usd?: number
    limit_usd?: number | null
    message?: string | null
  }
}

export type BraveSearchSource = {
  title: string
  url: string
}

export type ChatStreamEvent =
  | { type: 'stage'; stage: string; message: string }
  | { type: 'warn'; level: 'soft' | 'hard'; message: string }
  | {
      type: 'cancelled'
      stage?: string
      partial?: boolean
      message: string
    }
  | {
      type: 'meta'
      actual_provider: string
      actual_model: string
      is_image: boolean
      web_search_used: boolean
      web_search_sources: BraveSearchSource[]
      router_routed: boolean
      router_unavailable: boolean
      router_timed_out?: boolean
      brave_timed_out?: boolean
      router_provider: string | null
      router_model: string | null
      router_reason: string | null
      router_estimated_cost: string | null
      router_confidence: number | null
      router_input_cost: number
      router_output_cost: number
      router_total_cost: number
      router_prompt_tokens: number
      router_response_tokens: number
      timing_ms?: Record<string, number>
      soft_warn_elapsed_sec?: number
      hard_warn_elapsed_sec?: number
    }
  | { type: 'token'; delta: string }
  | { type: 'done'; result: ChatSendResult }
  | {
      type: 'error'
      message: string
      http_code?: number
      stage?: string
      time_taken?: number
    }

export interface ChatSendResult {
  event_id: number
  interaction_id: number
  message_id: number
  content: string
  image_url?: string | null
  is_image?: boolean
  web_search_used?: boolean
  web_search_sources?: BraveSearchSource[]
  prompt_tokens: number
  response_tokens: number
  input_cost: number
  output_cost: number
  total_cost: number
  time_taken: number
  http_code: number
  actual_provider?: string
  actual_model?: string
  router_routed?: boolean
  router_provider?: string | null
  router_model?: string | null
  router_reason?: string | null
  router_estimated_cost?: string | null
  router_confidence?: number | null
  router_unavailable?: boolean
  router_input_cost?: number
  router_output_cost?: number
  router_total_cost?: number
  router_prompt_tokens?: number
  router_response_tokens?: number
}

export interface AppSettings {
  generic_system_message?: string
  router_llm_enabled?: boolean
  router_llm_system_message?: string
  router_llm_provider?: string
  router_llm_model?: string
}

export interface ChatEndResult {
  status: 'ended'
  message_count: number
  total_cost: number
  total_tokens: number
}

export interface SpendingTrendPoint {
  date: string
  cost: number
  queries: number
}

export interface OllamaStatus {
  available: boolean
  model_count: number
}

export interface OllamaSyncResult {
  synced: number
  expired: number
}

export interface AuthStatus {
  users_registered: boolean
}

export interface AuthResult {
  token: string
  email: string
}

export interface UsageConversation {
  conversation_id: number
  conversation_title: string | null
  first_event: string
  last_event: string
  event_count: number
  total_cost: number
  router_cost: number
  answering_cost: number
}

export interface UsageSession {
  session_id: number
  session_title: string | null
  status: string
  first_event: string
  last_event: string
  event_count: number
  total_cost: number
  router_cost: number
  answering_cost: number
}

export interface UsageInteraction {
  interaction_id: number
  provider: string
  model: string
  created_at: string
  routed_by: string | null
  message_count: number
  answering_cost: number
  router_cost: number
}

export interface UsageMessage {
  message_id: number
  created_at: string
  provider: string | null
  model: string | null
  prompt_tokens: number
  response_tokens: number
  answering_cost: number
  router_cost: number
  time_taken: number
  http_code: number | null
}

export interface OpenRouterCredits {
  label: string | null
  usage: number
  limit: number | null
  is_free_tier: boolean
  rate_limit: {
    requests: number
    interval: string
  } | null
  /** Present on sync responses; absent on the read-only GET */
  synced?: boolean
  added_amount?: number | null
  /** True when we had enough data to reconcile (limit or purchased credits available) */
  has_credits_data?: boolean
}
