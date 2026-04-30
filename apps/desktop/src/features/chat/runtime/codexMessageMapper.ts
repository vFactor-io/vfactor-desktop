import type {
  MessageWithParts,
  RuntimeMessage,
  RuntimeMessagePart,
  RuntimeToolPart,
  RuntimeToolState,
} from "../types"
import type { CodexThreadItem, CodexTurn } from "./codexProtocol"

export function mapCodexStatus(status: string | null | undefined): RuntimeToolState["status"] {
  const normalized = String(status ?? "").toLowerCase()

  if (
    normalized === "pending" ||
    normalized === "queued" ||
    normalized === "inprogress" ||
    normalized === "in_progress" ||
    normalized === "running" ||
    normalized === "active"
  ) {
    return "running"
  }

  if (
    normalized.includes("error") ||
    normalized.includes("fail") ||
    normalized.includes("reject")
  ) {
    return "error"
  }

  if (!normalized) {
    return "completed"
  }

  return "completed"
}

function createAssistantMessage(
  sessionId: string,
  itemId: string,
  createdAt: number,
  parts: RuntimeMessagePart[],
  finishReason?: RuntimeMessage["finishReason"],
  metadata?: Pick<RuntimeMessage, "itemType" | "phase" | "turnId" | "title">
): MessageWithParts {
  return {
    info: {
      id: `${itemId}:message`,
      sessionId,
      role: "assistant",
      createdAt,
      finishReason,
      title: metadata?.title,
      itemType: metadata?.itemType,
      phase: metadata?.phase,
      turnId: metadata?.turnId,
    },
    parts,
  }
}

function createToolMessage(
  sessionId: string,
  itemId: string,
  createdAt: number,
  tool: string,
  state: RuntimeToolState,
  itemType: RuntimeMessage["itemType"],
  turnId?: string
): MessageWithParts {
  return createAssistantMessage(
    sessionId,
    itemId,
    createdAt,
    [
      {
        id: itemId,
        type: "tool",
        messageId: `${itemId}:message`,
        sessionId,
        tool,
        state,
      } satisfies RuntimeToolPart,
    ],
    undefined,
    {
      itemType,
      turnId,
    }
  )
}

function cloneCodexItem(item: CodexThreadItem): CodexThreadItem {
  switch (item.type) {
    case "reasoning":
      return {
        ...item,
        summary: [...item.summary],
        content: [...item.content],
      }

    case "commandExecution":
      return {
        ...item,
        commandActions: [...item.commandActions],
      }

    case "fileChange":
      return {
        ...item,
        changes: [...item.changes],
        outputText: item.outputText ?? null,
      }

    case "dynamicToolCall":
      return {
        ...item,
        contentItems: item.contentItems ? [...item.contentItems] : item.contentItems,
      }

    case "collabAgentToolCall":
      return {
        ...item,
        receiverThreadIds: [...item.receiverThreadIds],
        agentsStates: { ...item.agentsStates },
      }

    default:
      return { ...item }
  }
}

function createEmptyAgentMessage(itemId: string): Extract<CodexThreadItem, { type: "agentMessage" }> {
  return {
    type: "agentMessage",
    id: itemId,
    text: "",
    phase: "final_answer",
  }
}

function createEmptyPlan(itemId: string): Extract<CodexThreadItem, { type: "plan" }> {
  return {
    type: "plan",
    id: itemId,
    text: "",
  }
}

function createEmptyReasoning(itemId: string): Extract<CodexThreadItem, { type: "reasoning" }> {
  return {
    type: "reasoning",
    id: itemId,
    title: null,
    summary: [],
    content: [],
  }
}

function createEmptyCommandExecution(
  itemId: string
): Extract<CodexThreadItem, { type: "commandExecution" }> {
  return {
    type: "commandExecution",
    id: itemId,
    command: "",
    cwd: "",
    processId: null,
    status: "inProgress",
    aggregatedOutput: "",
    exitCode: null,
    durationMs: null,
    commandActions: [],
  }
}

function createEmptyFileChange(itemId: string): Extract<CodexThreadItem, { type: "fileChange" }> {
  return {
    type: "fileChange",
    id: itemId,
    changes: [],
    status: "inProgress",
    outputText: "",
  }
}

function appendDelta(current: string[] | undefined, index: number, delta: string): string[] {
  const next = [...(current ?? [])]
  next[index] = `${next[index] ?? ""}${delta}`
  return next
}

export class CodexTurnState {
  private itemOrder: string[] = []
  private itemsById = new Map<string, CodexThreadItem>()

  upsert(item: CodexThreadItem): void {
    const existing = this.itemsById.get(item.id)
    if (!this.itemsById.has(item.id)) {
      this.itemOrder.push(item.id)
    }

    if (existing?.type === "commandExecution" && item.type === "commandExecution") {
      this.itemsById.set(item.id, {
        ...cloneCodexItem(item),
        aggregatedOutput: item.aggregatedOutput ?? existing.aggregatedOutput,
      })
      return
    }

    if (existing?.type === "fileChange" && item.type === "fileChange") {
      this.itemsById.set(item.id, {
        ...cloneCodexItem(item),
        outputText: item.outputText ?? existing.outputText ?? null,
      })
      return
    }

    this.itemsById.set(item.id, cloneCodexItem(item))
  }

  orderedItems(): CodexThreadItem[] {
    return this.itemOrder.flatMap((itemId) => {
      const item = this.itemsById.get(itemId)
      return item ? [item] : []
    })
  }

  appendAgentMessageDelta(itemId: string, delta: string): void {
    const item = this.ensureAgentMessage(itemId)
    this.itemsById.set(item.id, {
      ...item,
      text: `${item.text}${delta}`,
    })
  }

  appendPlanDelta(itemId: string, delta: string): void {
    const item = this.ensurePlan(itemId)
    this.itemsById.set(item.id, {
      ...item,
      text: `${item.text}${delta}`,
    })
  }

  appendReasoningContentDelta(itemId: string, contentIndex: number, delta: string): void {
    const item = this.ensureReasoning(itemId)
    this.itemsById.set(item.id, {
      ...item,
      content: appendDelta(item.content, contentIndex, delta),
    })
  }

  appendReasoningSummaryDelta(itemId: string, summaryIndex: number, delta: string): void {
    const item = this.ensureReasoning(itemId)
    this.itemsById.set(item.id, {
      ...item,
      summary: appendDelta(item.summary, summaryIndex, delta),
    })
  }

  appendCommandOutputDelta(itemId: string, delta: string): void {
    const item = this.ensureCommandExecution(itemId)
    this.itemsById.set(item.id, {
      ...item,
      aggregatedOutput: `${item.aggregatedOutput ?? ""}${delta}`,
    })
  }

  appendFileChangeOutputDelta(itemId: string, delta: string): void {
    const item = this.ensureFileChange(itemId)
    this.itemsById.set(item.id, {
      ...item,
      outputText: `${item.outputText ?? ""}${delta}`,
    })
  }

  private ensureAgentMessage(
    itemId: string
  ): Extract<CodexThreadItem, { type: "agentMessage" }> {
    const existing = this.itemsById.get(itemId)
    if (existing?.type === "agentMessage") {
      return existing
    }

    const nextItem = createEmptyAgentMessage(itemId)
    this.upsert(nextItem)
    return nextItem
  }

  private ensurePlan(itemId: string): Extract<CodexThreadItem, { type: "plan" }> {
    const existing = this.itemsById.get(itemId)
    if (existing?.type === "plan") {
      return existing
    }

    const nextItem = createEmptyPlan(itemId)
    this.upsert(nextItem)
    return nextItem
  }

  private ensureReasoning(itemId: string): Extract<CodexThreadItem, { type: "reasoning" }> {
    const existing = this.itemsById.get(itemId)
    if (existing?.type === "reasoning") {
      return existing
    }

    const nextItem = createEmptyReasoning(itemId)
    this.upsert(nextItem)
    return nextItem
  }

  private ensureCommandExecution(
    itemId: string
  ): Extract<CodexThreadItem, { type: "commandExecution" }> {
    const existing = this.itemsById.get(itemId)
    if (existing?.type === "commandExecution") {
      return existing
    }

    const nextItem = createEmptyCommandExecution(itemId)
    this.upsert(nextItem)
    return nextItem
  }

  private ensureFileChange(itemId: string): Extract<CodexThreadItem, { type: "fileChange" }> {
    const existing = this.itemsById.get(itemId)
    if (existing?.type === "fileChange") {
      return existing
    }

    const nextItem = createEmptyFileChange(itemId)
    this.upsert(nextItem)
    return nextItem
  }
}

export function mapTurnItemsToMessages(turn: CodexTurn, sessionId: string): MessageWithParts[] {
  const baseCreatedAt = Date.now()

  return turn.items.flatMap((item, index) => {
    const createdAt = baseCreatedAt + index

    switch (item.type) {
      case "userMessage":
        return []

      case "agentMessage":
        return [
          createAssistantMessage(
            sessionId,
            item.id,
            createdAt,
            [
              {
                id: `${item.id}:text`,
                type: "text",
                text: item.text,
              },
            ],
            item.phase === "final_answer" ? "end_turn" : undefined,
            {
              itemType: "agentMessage",
              phase: item.phase,
              turnId: turn.id,
            }
          ),
        ]

      case "plan":
        return [
          createAssistantMessage(
            sessionId,
            item.id,
            createdAt,
            [
              {
                id: `${item.id}:text`,
                type: "text",
                text: item.text,
              },
            ],
            undefined,
            {
              itemType: "plan",
              turnId: turn.id,
            }
          ),
        ]

      case "reasoning":
        return [
          createAssistantMessage(
            sessionId,
            item.id,
            createdAt,
            [
              {
                id: `${item.id}:text`,
                type: "text",
                text: [...item.summary, ...item.content].join("\n\n"),
              },
            ],
            undefined,
            {
              itemType: "reasoning",
              title: item.title?.trim() || null,
              turnId: turn.id,
            }
          ),
        ]

      case "commandExecution":
        return [
          createToolMessage(
            sessionId,
            item.id,
            createdAt,
            "command/exec",
            {
              status: mapCodexStatus(item.status),
              title: item.command,
              subtitle: item.cwd,
              input: {
                command: item.command,
                cwd: item.cwd,
                processId: item.processId,
                commandActions: item.commandActions,
              },
              output: {
                aggregatedOutput: item.aggregatedOutput,
                exitCode: item.exitCode,
                durationMs: item.durationMs,
              },
            },
            "commandExecution",
            turn.id
          ),
        ]

      case "fileChange":
        return [
          createToolMessage(
            sessionId,
            item.id,
            createdAt,
            "fileChange",
            {
              status: mapCodexStatus(item.status),
              title: "Apply file changes",
              input: {
                changes: item.changes,
              },
              output: {
                changes: item.changes,
                outputText: item.outputText ?? null,
              },
            },
            "fileChange",
            turn.id
          ),
        ]

      case "mcpToolCall":
        return [
          createToolMessage(
            sessionId,
            item.id,
            createdAt,
            `${item.server}/${item.tool}`,
            {
              status: mapCodexStatus(item.status),
              title: `${item.server}:${item.tool}`,
              input: {
                arguments: item.arguments,
              },
              output: item.result,
              error: item.error,
            },
            "mcpToolCall",
            turn.id
          ),
        ]

      case "dynamicToolCall":
        return [
          createToolMessage(
            sessionId,
            item.id,
            createdAt,
            item.tool,
            {
              status: mapCodexStatus(item.status),
              title: item.tool,
              input: {
                arguments: item.arguments,
              },
              output: {
                contentItems: item.contentItems,
                success: item.success,
                durationMs: item.durationMs,
              },
            },
            "dynamicToolCall",
            turn.id
          ),
        ]

      case "collabAgentToolCall":
        return [
          createToolMessage(
            sessionId,
            item.id,
            createdAt,
            `collab/${item.tool}`,
            {
              status: mapCodexStatus(item.status),
              title: item.tool,
              input: {
                senderThreadId: item.senderThreadId,
                receiverThreadIds: item.receiverThreadIds,
                prompt: item.prompt,
              },
              output: item.agentsStates,
            },
            "collabAgentToolCall",
            turn.id
          ),
        ]

      case "webSearch":
        return [
          createToolMessage(
            sessionId,
            item.id,
            createdAt,
            "webSearch",
            {
              status: "completed",
              title: item.query,
              input: {
                query: item.query,
              },
              output: item.action,
            },
            "webSearch",
            turn.id
          ),
        ]

      case "imageGeneration":
        return [
          createToolMessage(
            sessionId,
            item.id,
            createdAt,
            "imageGeneration",
            {
              status: mapCodexStatus(item.status),
              title: "Generate image",
              input: {
                revisedPrompt: item.revisedPrompt,
              },
              output: item.result,
            },
            "imageGeneration",
            turn.id
          ),
        ]

      case "imageView":
        return [
          createToolMessage(
            sessionId,
            item.id,
            createdAt,
            "imageView",
            {
              status: "completed",
              title: item.path,
              input: {
                path: item.path,
              },
              output: null,
            },
            "imageView",
            turn.id
          ),
        ]

      case "enteredReviewMode":
      case "exitedReviewMode":
        return [
          createAssistantMessage(
            sessionId,
            item.id,
            createdAt,
            [
              {
                id: `${item.id}:text`,
                type: "text",
                text: item.review,
              },
            ],
            undefined,
            {
              itemType: item.type,
              turnId: turn.id,
            }
          ),
        ]

      case "contextCompaction":
        return [
          createToolMessage(
            sessionId,
            item.id,
            createdAt,
            "contextCompaction",
            {
              status: "completed",
              title: "Compact context",
              input: {},
              output: null,
            },
            "contextCompaction",
            turn.id
          ),
        ]

      default:
        return []
    }
  })
}
