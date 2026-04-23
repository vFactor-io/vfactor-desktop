const TERMINAL_URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi
const TRAILING_URL_PUNCTUATION = /[),.;:!?]+$/u

export interface TerminalUrlMatch {
  url: string
  start: number
  end: number
}

function trimTerminalUrlCandidate(value: string) {
  return value.replace(TRAILING_URL_PUNCTUATION, "")
}

export function findTerminalUrlAtTextOffset(
  text: string,
  offset: number
): TerminalUrlMatch | null {
  if (!Number.isFinite(offset) || offset < 0) {
    return null
  }

  TERMINAL_URL_PATTERN.lastIndex = 0

  for (const match of text.matchAll(TERMINAL_URL_PATTERN)) {
    const rawUrl = match[0]
    const trimmedUrl = trimTerminalUrlCandidate(rawUrl)

    if (!trimmedUrl) {
      continue
    }

    const start = match.index ?? 0
    const end = start + trimmedUrl.length

    if (offset >= start && offset < end) {
      return {
        url: trimmedUrl,
        start,
        end,
      }
    }
  }

  return null
}

function getNodeTextLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.length ?? 0
  }

  let total = 0
  for (const child of node.childNodes) {
    total += getNodeTextLength(child)
  }
  return total
}

function resolveTextOffsetWithinNode(root: Node, target: Node, offset: number): number | null {
  let total = 0

  const walk = (node: Node): boolean => {
    if (node === target) {
      if (node.nodeType === Node.TEXT_NODE) {
        total += Math.min(offset, node.textContent?.length ?? 0)
        return true
      }

      const boundedOffset = Math.min(offset, node.childNodes.length)
      for (let index = 0; index < boundedOffset; index += 1) {
        total += getNodeTextLength(node.childNodes[index]!)
      }
      return true
    }

    if (node.nodeType === Node.TEXT_NODE) {
      total += node.textContent?.length ?? 0
      return false
    }

    for (const child of node.childNodes) {
      if (walk(child)) {
        return true
      }
    }

    return false
  }

  return walk(root) ? total : null
}

function getCaretPointNodePosition(
  doc: Document,
  clientX: number,
  clientY: number
): { node: Node; offset: number } | null {
  if (typeof doc.caretPositionFromPoint === "function") {
    const position = doc.caretPositionFromPoint(clientX, clientY)
    if (position?.offsetNode) {
      return {
        node: position.offsetNode,
        offset: position.offset,
      }
    }
  }

  if (typeof doc.caretRangeFromPoint === "function") {
    const range = doc.caretRangeFromPoint(clientX, clientY)
    if (range?.startContainer) {
      return {
        node: range.startContainer,
        offset: range.startOffset,
      }
    }
  }

  return null
}

export function findTerminalUrlAtPoint(
  rowElement: HTMLElement,
  clientX: number,
  clientY: number,
  doc: Document = document
): TerminalUrlMatch | null {
  const caretPosition = getCaretPointNodePosition(doc, clientX, clientY)
  if (!caretPosition) {
    return null
  }

  if (!rowElement.contains(caretPosition.node)) {
    return null
  }

  const offset = resolveTextOffsetWithinNode(
    rowElement,
    caretPosition.node,
    caretPosition.offset
  )

  if (offset === null) {
    return null
  }

  return findTerminalUrlAtTextOffset(rowElement.textContent ?? "", offset)
}
