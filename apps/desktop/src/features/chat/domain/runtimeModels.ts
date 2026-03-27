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

export function getRuntimeModelLabel(
  model: {
    displayName?: string | null
    id?: string | null
  } | null | undefined,
  fallback = "Unknown model"
): string {
  const displayName = model?.displayName?.trim()
  if (displayName) {
    return humanizeModelLabel(displayName)
  }

  const id = model?.id?.trim()
  if (id) {
    return humanizeModelLabel(id)
  }

  return fallback
}
