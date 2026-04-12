function formatModelToken(token: string): string {
  if (/^gpt$/i.test(token)) {
    return "GPT"
  }

  if (/^codex$/i.test(token)) {
    return "Codex"
  }

  if (/^(mini|max|spark|preview|nano|turbo)$/i.test(token)) {
    return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
  }

  if (/^[a-z]\d+(?:\.\d+)?$/i.test(token)) {
    return token.toLowerCase()
  }

  if (/^\d[\w.]*$/i.test(token)) {
    return token
  }

  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
}

function humanizeModelLabel(value: string): string {
  const normalized = value.trim().replace(/[_\s-]+/g, "-")
  const parts = normalized.split("-").filter(Boolean)

  if (parts.length === 0) {
    return value.trim()
  }

  const formattedParts = parts.map(formatModelToken)

  if (formattedParts.length >= 2 && formattedParts[0] === "GPT") {
    return [`${formattedParts[0]}-${formattedParts[1]}`, ...formattedParts.slice(2)].join(" ")
  }

  return formattedParts.join(" ")
}

function formatClaudeModelIdentifier(value: string): string | null {
  const normalized = value.trim().replace(/[_\s]+/g, "-").toLowerCase()
  if (!normalized.startsWith("claude-")) {
    return null
  }

  const suffix = normalized.slice("claude-".length)
  const versionMatch = suffix.match(/^(.*)-(\d+)-(\d+)$/)
  if (!versionMatch) {
    return humanizeModelLabel(suffix)
  }

  const [, family, major, minor] = versionMatch
  return `${humanizeModelLabel(family)} ${major}.${minor}`
}

export function getRuntimeModelLabel(
  model: {
    displayName?: string | null
    id?: string | null
  } | null | undefined,
  fallback = "Unknown model"
): string {
  const id = model?.id?.trim()
  const claudeIdentifier = id ? formatClaudeModelIdentifier(id) : null
  if (claudeIdentifier) {
    return claudeIdentifier
  }

  const displayName = model?.displayName?.trim()
  if (displayName) {
    return humanizeModelLabel(displayName)
  }

  if (id) {
    return humanizeModelLabel(id)
  }

  return fallback
}
