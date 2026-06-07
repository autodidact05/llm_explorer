import type { InteractionGroup, Transaction } from './types'

const BRAVE_FOOTER_MARKER = '<!-- brave-search-sources -->'

/** Hide the auto-appended Brave sources block when we render the sources panel separately. */
export function contentWithoutBraveFooter(content: string): string {
  const markerAt = content.indexOf(BRAVE_FOOTER_MARKER)
  if (markerAt < 0) return content
  const ruleAt = content.lastIndexOf('\n\n---\n', markerAt)
  return (ruleAt >= 0 ? content.slice(0, ruleAt) : content.slice(0, markerAt)).trimEnd()
}

export function buildInteractionGroups(transactions: Transaction[]): InteractionGroup[] {
  const groups: InteractionGroup[] = []
  const groupMap = new Map<number, InteractionGroup & { totalTimeTaken: number }>()
  for (const t of transactions) {
    const id = t.interaction_id
    const existing = groupMap.get(id)
    if (existing) {
      existing.callCount++
      existing.totalCost += t.total_cost
      existing.totalTokens += t.prompt_tokens + t.response_tokens
      existing.totalTimeTaken += t.time_taken
      existing.avgTimeTaken = existing.totalTimeTaken / existing.callCount
      existing.transactions.push(t)
    } else {
      const g = {
        interactionId: id,
        provider: t.provider,
        model: t.model,
        callCount: 1,
        totalCost: t.total_cost,
        totalTokens: t.prompt_tokens + t.response_tokens,
        avgTimeTaken: t.time_taken,
        totalTimeTaken: t.time_taken,
        transactions: [t],
      }
      groupMap.set(id, g)
      groups.push(g)
    }
  }
  return groups
}

