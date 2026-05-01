import type { FileChange } from "../types"

export function getChangeKey(change: FileChange) {
  return `${change.previousPath ?? ""}->${change.path}`
}

export function getChangeKeys(changes: FileChange[]): string[] {
  return changes.map(getChangeKey)
}

export function toggleCollapsedFileKey(
  collapsedKeys: ReadonlySet<string>,
  fileKey: string
): ReadonlySet<string> {
  const next = new Set(collapsedKeys)
  if (next.has(fileKey)) {
    next.delete(fileKey)
  } else {
    next.add(fileKey)
  }
  return next
}

export function pruneCollapsedFileKeys(
  collapsedKeys: ReadonlySet<string>,
  availableKeys: readonly string[]
): ReadonlySet<string> {
  const available = new Set(availableKeys)
  const next = new Set<string>()
  for (const key of collapsedKeys) {
    if (available.has(key)) {
      next.add(key)
    }
  }

  if (next.size === collapsedKeys.size) {
    return collapsedKeys
  }

  return next
}
