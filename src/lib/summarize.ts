export function generateSummary(content: string | null | undefined): string {
  if (!content) return ''

  const trimmed = content.trim()
  if (!trimmed) return ''

  const match = trimmed.match(/^.*?[.!?](?=\s|$)/)
  let summary = match ? match[0] : trimmed

  if (summary.length > 140) {
    summary = summary.slice(0, 140).trim() + '…'
  }

  return summary
}