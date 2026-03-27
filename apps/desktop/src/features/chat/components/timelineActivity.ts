import type {
  MessageWithParts,
  RuntimeMessagePart,
  RuntimeToolPart,
  ToolExecutionStatus,
} from "../types"

export type ToolActivityFamily =
  | "exploration"
  | "command"
  | "edit"
  | "mcp"
  | "dynamic"
  | "subagent"
  | "image"
  | "context"
  | "approval"

export interface TimelineMessageBlock {
  type: "message"
  key: string
  message: MessageWithParts
}

export interface TimelineActivityGroupBlock {
  type: "activityGroup"
  key: string
  family: Exclude<ToolActivityFamily, "approval">
  turnId: string
  messages: MessageWithParts[]
}

export type TimelineBlock = TimelineMessageBlock | TimelineActivityGroupBlock

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

interface CommandActionRecord {
  type: string
  path?: string
  name?: string
  pattern?: string
  query?: string
}

function getCommandActions(toolPart: RuntimeToolPart): CommandActionRecord[] {
  const value = toolPart.state.input.commandActions
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || !("type" in entry) || typeof entry.type !== "string") {
      return []
    }

    return [
      {
        type: entry.type,
        path: "path" in entry && typeof entry.path === "string" ? entry.path : undefined,
        name: "name" in entry && typeof entry.name === "string" ? entry.name : undefined,
        pattern: "pattern" in entry && typeof entry.pattern === "string" ? entry.pattern : undefined,
        query: "query" in entry && typeof entry.query === "string" ? entry.query : undefined,
      },
    ]
  })
}

export function isApprovalToolMessage(message: MessageWithParts): boolean {
  return message.info.id.startsWith("approval:")
}

export function getToolActivityFamily(message: MessageWithParts): ToolActivityFamily | null {
  const toolPart = getToolPartFromMessage(message)
  if (!toolPart) {
    return null
  }

  if (isApprovalToolMessage(message)) {
    return "approval"
  }

  switch (message.info.itemType) {
    case "commandExecution": {
      const firstAction = getCommandActions(toolPart)[0]
      if (
        firstAction?.type === "read" ||
        firstAction?.type === "search" ||
        firstAction?.type === "listFiles"
      ) {
        return "exploration"
      }

      return "command"
    }
    case "webSearch":
      return "exploration"
    case "fileChange":
      return "edit"
    case "mcpToolCall":
      return "mcp"
    case "dynamicToolCall":
      return "dynamic"
    case "collabAgentToolCall":
      return "subagent"
    case "imageGeneration":
    case "imageView":
      return "image"
    case "contextCompaction":
      return "context"
    default:
      return null
  }
}

function isGroupableToolMessage(
  message: MessageWithParts
): message is MessageWithParts & { info: MessageWithParts["info"] & { turnId: string } } {
  const family = getToolActivityFamily(message)

  return (
    message.info.role === "assistant" &&
    Boolean(message.info.turnId) &&
    Boolean(getToolPartFromMessage(message)) &&
    family !== null &&
    family !== "approval"
  )
}

function createActivityGroupBlock(
  messages: MessageWithParts[],
  family: Exclude<ToolActivityFamily, "approval">,
  turnId: string
): TimelineActivityGroupBlock {
  const firstMessage = messages[0]

  return {
    type: "activityGroup",
    key: `activity:${turnId}:${family}:${firstMessage?.info.id ?? "unknown"}`,
    family,
    turnId,
    messages,
  }
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

    return {
      type: "message" as const,
      key: message.info.id,
      message,
    }
  })
}

export function isSettledToolStatus(status: ToolExecutionStatus): boolean {
  return status === "completed" || status === "error"
}

export function isActivityGroupActive(group: TimelineActivityGroupBlock): boolean {
  return group.messages.some((message) => {
    const toolPart = getToolPartFromMessage(message)
    return toolPart ? !isSettledToolStatus(toolPart.state.status) : false
  })
}

function getPluralLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function getExplorationCounts(group: TimelineActivityGroupBlock): {
  fileCount: number
  searchCount: number
  listCount: number
} {
  const filePaths = new Set<string>()
  let searchCount = 0
  let listCount = 0

  for (const message of group.messages) {
    const toolPart = getToolPartFromMessage(message)
    if (!toolPart) {
      continue
    }

    if (message.info.itemType === "webSearch") {
      searchCount += 1
      continue
    }

    if (message.info.itemType !== "commandExecution") {
      continue
    }

    for (const action of getCommandActions(toolPart)) {
      if (action.type === "read") {
        const path = action.path ?? action.name
        if (path) {
          filePaths.add(path)
        }
      }

      if (action.type === "search") {
        searchCount += 1
      }

      if (action.type === "listFiles") {
        listCount += 1
      }
    }
  }

  return {
    fileCount: filePaths.size,
    searchCount,
    listCount,
  }
}

function getEditFileCount(group: TimelineActivityGroupBlock): number {
  const paths = new Set<string>()

  for (const message of group.messages) {
    const toolPart = getToolPartFromMessage(message)
    if (!toolPart) {
      continue
    }

    const changesSource =
      toolPart.state.output && typeof toolPart.state.output === "object" && "changes" in toolPart.state.output
        ? (toolPart.state.output as { changes?: unknown }).changes
        : toolPart.state.input && typeof toolPart.state.input === "object" && "changes" in toolPart.state.input
          ? (toolPart.state.input as { changes?: unknown }).changes
          : undefined

    for (const change of getFileChangeEntries(changesSource)) {
      paths.add(change.path)
    }
  }

  return paths.size
}

export function getActivityGroupSummary(group: TimelineActivityGroupBlock): string {
  const isActive = isActivityGroupActive(group)

  switch (group.family) {
    case "exploration": {
      const { fileCount, searchCount, listCount } = getExplorationCounts(group)
      const summaryParts = [
        fileCount > 0 ? getPluralLabel(fileCount, "file") : null,
        searchCount > 0 ? getPluralLabel(searchCount, "search", "searches") : null,
        listCount > 0 ? getPluralLabel(listCount, "list") : null,
      ].filter((value): value is string => Boolean(value))

      return `${isActive ? "Exploring" : "Explored"} ${summaryParts.join(", ") || "workspace"}`
    }
    case "command":
      return `${isActive ? "Running" : "Ran"} ${getPluralLabel(group.messages.length, "command")}`
    case "edit":
      return `${isActive ? "Editing" : "Edited"} ${getPluralLabel(getEditFileCount(group), "file")}`
    case "mcp":
      return `${isActive ? "Calling" : "Called"} ${getPluralLabel(group.messages.length, "MCP tool")}`
    case "dynamic":
      return `${isActive ? "Using" : "Used"} ${getPluralLabel(group.messages.length, "tool")}`
    case "subagent":
      return `${isActive ? "Starting" : "Started"} ${getPluralLabel(group.messages.length, "subagent task")}`
    case "image":
      return `${isActive ? "Working on" : "Completed"} ${getPluralLabel(group.messages.length, "image action")}`
    case "context":
      return isActive ? "Compacting context" : "Compacted context"
  }
}
