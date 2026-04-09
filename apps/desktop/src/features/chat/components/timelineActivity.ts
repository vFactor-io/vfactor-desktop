import type {
  MessageWithParts,
  RuntimeMessagePart,
  RuntimeToolPart,
} from "../types"

export interface TimelineMessageBlock {
  type: "message"
  key: string
  message: MessageWithParts
}

export type TimelineBlock = TimelineMessageBlock

export function getToolPart(parts: RuntimeMessagePart[]): RuntimeToolPart | null {
  return parts.find((part): part is RuntimeToolPart => part.type === "tool") ?? null
}

export function getToolPartFromMessage(message: MessageWithParts): RuntimeToolPart | null {
  return getToolPart(message.parts)
}

export function getFileChangeEntries(
  value: unknown
): Array<{ path: string; kind: string; diff?: string }> {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return []
    }

    const path = "path" in entry && typeof entry.path === "string" ? entry.path : null
    const kind =
      "kind" in entry &&
      entry.kind &&
      typeof entry.kind === "object" &&
      "type" in entry.kind &&
      typeof entry.kind.type === "string"
        ? entry.kind.type
        : "change"
    const diff = "diff" in entry && typeof entry.diff === "string" ? entry.diff : undefined

    return path ? [{ path, kind, diff }] : []
  })
}

export function isApprovalToolMessage(message: MessageWithParts): boolean {
  return message.info.id.startsWith("approval:")
}

export function buildTimelineBlocks(messages: MessageWithParts[]): TimelineBlock[] {
  const lastIndexById = new Map<string, number>()

  messages.forEach((message, index) => {
    lastIndexById.set(message.info.id, index)
  })

  return messages.flatMap((message, index) => {
    if (lastIndexById.get(message.info.id) !== index) {
      return []
    }

    return [{
      type: "message",
      key: message.info.id,
      message,
    }]
  })
}
