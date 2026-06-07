/**
 * Normalize markdown ordered lists so each contiguous block uses 1, 2, 3, …
 * (models often emit 1, 1, 1 or 10, 14, 16 when continuing a prior list).
 */
export function normalizeOrderedLists(markdown: string): string {
  const lines = markdown.split('\n')
  const out: string[] = []
  let counter = 0

  for (const line of lines) {
    const match = line.match(/^(\s*)(\d+)\.\s+(\S.*)$/)
    if (match) {
      const [, indent, , body] = match
      if (counter === 0) counter = 1
      else counter += 1
      out.push(`${indent}${counter}. ${body}`)
    } else {
      counter = 0
      out.push(line)
    }
  }
  return out.join('\n')
}

export function prepareMarkdownForDisplay(markdown: string): string {
  return normalizeOrderedLists(markdown)
}
