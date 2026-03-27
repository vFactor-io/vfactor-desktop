export function normalizeProjectIconPath(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) {
    return null
  }

  return trimmed
}

export function projectIconPathToSrc(value: string | null | undefined): string | null {
  const normalizedPath = normalizeProjectIconPath(value)
  if (!normalizedPath) {
    return null
  }

  if (normalizedPath.startsWith("data:") || /^[a-zA-Z]+:\/\//.test(normalizedPath)) {
    return normalizedPath
  }

  const pathWithForwardSlashes = normalizedPath.replace(/\\/g, "/")
  const encodedPath = encodeURI(pathWithForwardSlashes)
    .replace(/#/g, "%23")
    .replace(/\?/g, "%3F")

  if (/^[A-Za-z]:\//.test(pathWithForwardSlashes)) {
    return `file:///${encodedPath}`
  }

  if (pathWithForwardSlashes.startsWith("//")) {
    return `file:${encodedPath}`
  }

  return `file://${encodedPath}`
}
