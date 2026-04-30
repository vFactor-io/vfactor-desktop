export function getThoughtSummaryTitle(text: string, title?: string | null): string {
  const normalizedTitle = title?.trim()
  if (normalizedTitle) {
    return normalizedTitle
  }

  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
  const boldHeadingMatch = firstLine?.match(/^\*\*(.+?)\*\*$/)

  return boldHeadingMatch?.[1]?.trim() || "Thought"
}
