import type { BraveSearchSource, ChatSendResult } from '@/lib/types'

export type Transaction = ChatSendResult & { model: string; provider: string }


export type InteractionGroup = {
  interactionId: number
  provider: string
  model: string
  callCount: number
  totalTokens: number
  totalCost: number
  avgTimeTaken: number
  transactions: Transaction[]
}

export type SessionStats = {
  totalCalls: number
  totalTokens: number
  totalCost: number
  transactions: Transaction[]
  routerCalls: number
  routerTokens: number
  routerCost: number
}

export type StatsView = 'interactions' | number

export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  model?: string
  provider?: string
  transaction?: ChatSendResult
  fromPrior?: boolean
  image_url?: string
  /** chat_messages.id — used as the key for response rating */
  messageId?: number
  /** interaction_id for routing rating */
  interactionId?: number
  /** true when Router LLM selected this interaction's model */
  routerRouted?: boolean
  /** pre-loaded response rating (1=Wrong 2=OK 3=Great) */
  responseRating?: number | null
  /** assistant message still receiving streamed tokens */
  streaming?: boolean
  /** Brave Search sources when web search was used for this reply */
  webSearchSources?: BraveSearchSource[]
}

