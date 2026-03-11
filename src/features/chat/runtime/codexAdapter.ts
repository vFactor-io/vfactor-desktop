import type {
  HarnessAdapter,
  HarnessCommandInput,
  HarnessDefinition,
  HarnessTurnInput,
  HarnessTurnResult,
  MessageWithParts,
  RuntimeMessage,
  RuntimeMessagePart,
  RuntimeSession,
  RuntimeToolPart,
  RuntimeToolState,
} from "../types"
import { getCodexRpcClient } from "./codexRpcClient"

const TURN_COMPLETION_TIMEOUT_MS = 120_000
const TURN_SYNC_INTERVAL_MS = 250

interface CodexThread {
  id: string
  preview: string
  createdAt: number
  updatedAt: number
  cwd: string
  name: string | null
}

interface CodexTurn {
  id: string
  items: CodexThreadItem[]
  status: string
  error: { message?: string } | null
}

type CodexThreadItem =
  | {
      type: "userMessage"
      id: string
      content: Array<{ type: "text"; text: string }>
    }
  | {
      type: "agentMessage"
      id: string
      text: string
      phase: string | null
    }
  | {
      type: "plan"
      id: string
      text: string
    }
  | {
      type: "reasoning"
      id: string
      summary: string[]
      content: string[]
    }
  | {
      type: "commandExecution"
      id: string
      command: string
      cwd: string
      processId: string | null
      status: string
      aggregatedOutput: string | null
      exitCode: number | null
      durationMs: number | null
      commandActions: unknown[]
    }
  | {
      type: "fileChange"
      id: string
      changes: unknown[]
      status: string
      outputText?: string | null
    }
  | {
      type: "mcpToolCall"
      id: string
      server: string
      tool: string
      status: string
      arguments: unknown
      result: unknown
      error: unknown
      durationMs: number | null
    }
  | {
      type: "dynamicToolCall"
      id: string
      tool: string
      arguments: unknown
      status: string
      contentItems: unknown[] | null
      success: boolean | null
      durationMs: number | null
    }
  | {
      type: "collabAgentToolCall"
      id: string
      tool: string
      status: string
      senderThreadId: string
      receiverThreadIds: string[]
      prompt: string | null
      agentsStates: Record<string, unknown>
    }
  | {
      type: "webSearch"
      id: string
      query: string
      action: unknown
    }
  | {
      type: "imageGeneration"
      id: string
      status: string
      revisedPrompt: string | null
      result: string
    }
  | {
      type: "imageView"
      id: string
      path: string
    }
  | {
      type: "enteredReviewMode"
      id: string
      review: string
    }
  | {
      type: "exitedReviewMode"
      id: string
      review: string
    }
  | {
      type: "contextCompaction"
      id: string
    }

interface CodexThreadReadResponse {
  thread: {
    turns: CodexTurn[]
  }
}

interface CodexTurnStartResponse {
  turn: {
    id: string
  }
}

interface CodexTurnNotification {
  threadId: string
  turn: CodexTurn
}

interface CodexItemNotification {
  threadId: string
  turnId: string
  item: CodexThreadItem
}

interface CodexTextDeltaNotification {
  threadId: string
  turnId: string
  itemId: string
  delta: string
}

interface CodexOutputDeltaNotification {
  threadId: string
  turnId: string
  itemId: string
  delta: string
}

interface CodexReasoningTextDeltaNotification extends CodexTextDeltaNotification {
  contentIndex: number
}

interface CodexReasoningSummaryTextDeltaNotification extends CodexTextDeltaNotification {
  summaryIndex: number
}

function toMilliseconds(seconds: number): number {
  return seconds * 1000
}

function isTransientTurnReadError(error: unknown): boolean {
  const message = String(error)
  return (
    message.includes("is not materialized yet") ||
    message.includes("includeTurns is unavailable before first user message")
  )
}

function mapThreadToSession(thread: CodexThread): RuntimeSession {
  const title = thread.name ?? (thread.preview || undefined)

  return {
    id: thread.id,
    harnessId: "codex",
    title,
    projectPath: thread.cwd,
    createdAt: toMilliseconds(thread.createdAt),
    updatedAt: toMilliseconds(thread.updatedAt),
  }
}

function mapCodexStatus(status: string | null | undefined): RuntimeToolState["status"] {
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
  metadata?: Pick<RuntimeMessage, "itemType" | "phase">
): MessageWithParts {
  return {
    info: {
      id: `${itemId}:message`,
      sessionId,
      role: "assistant",
      createdAt,
      finishReason,
      itemType: metadata?.itemType,
      phase: metadata?.phase,
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
  itemType: RuntimeMessage["itemType"]
): MessageWithParts {
  return createAssistantMessage(sessionId, itemId, createdAt, [
    {
      id: itemId,
      type: "tool",
      messageId: `${itemId}:message`,
      sessionId,
      tool,
      state,
    } satisfies RuntimeToolPart,
  ], undefined, {
    itemType,
  })
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

function upsertTurnItem(
  order: string[],
  itemsById: Map<string, CodexThreadItem>,
  item: CodexThreadItem
): void {
  const existing = itemsById.get(item.id)
  if (!itemsById.has(item.id)) {
    order.push(item.id)
  }

  if (existing?.type === "commandExecution" && item.type === "commandExecution") {
    itemsById.set(item.id, {
      ...cloneCodexItem(item),
      aggregatedOutput: item.aggregatedOutput ?? existing.aggregatedOutput,
    })
    return
  }

  if (existing?.type === "fileChange" && item.type === "fileChange") {
    itemsById.set(item.id, {
      ...cloneCodexItem(item),
      outputText: item.outputText ?? existing.outputText ?? null,
    })
    return
  }

  itemsById.set(item.id, cloneCodexItem(item))
}

function getOrderedTurnItems(
  order: string[],
  itemsById: Map<string, CodexThreadItem>
): CodexThreadItem[] {
  return order.flatMap((itemId) => {
    const item = itemsById.get(itemId)
    return item ? [item] : []
  })
}

function ensureAgentMessageItem(
  order: string[],
  itemsById: Map<string, CodexThreadItem>,
  itemId: string
): Extract<CodexThreadItem, { type: "agentMessage" }> {
  const existing = itemsById.get(itemId)
  if (existing?.type === "agentMessage") {
    return existing
  }

  const nextItem = createEmptyAgentMessage(itemId)
  upsertTurnItem(order, itemsById, nextItem)
  return nextItem
}

function ensurePlanItem(
  order: string[],
  itemsById: Map<string, CodexThreadItem>,
  itemId: string
): Extract<CodexThreadItem, { type: "plan" }> {
  const existing = itemsById.get(itemId)
  if (existing?.type === "plan") {
    return existing
  }

  const nextItem = createEmptyPlan(itemId)
  upsertTurnItem(order, itemsById, nextItem)
  return nextItem
}

function ensureReasoningItem(
  order: string[],
  itemsById: Map<string, CodexThreadItem>,
  itemId: string
): Extract<CodexThreadItem, { type: "reasoning" }> {
  const existing = itemsById.get(itemId)
  if (existing?.type === "reasoning") {
    return existing
  }

  const nextItem = createEmptyReasoning(itemId)
  upsertTurnItem(order, itemsById, nextItem)
  return nextItem
}

function ensureCommandExecutionItem(
  order: string[],
  itemsById: Map<string, CodexThreadItem>,
  itemId: string
): Extract<CodexThreadItem, { type: "commandExecution" }> {
  const existing = itemsById.get(itemId)
  if (existing?.type === "commandExecution") {
    return existing
  }

  const nextItem = createEmptyCommandExecution(itemId)
  upsertTurnItem(order, itemsById, nextItem)
  return nextItem
}

function ensureFileChangeItem(
  order: string[],
  itemsById: Map<string, CodexThreadItem>,
  itemId: string
): Extract<CodexThreadItem, { type: "fileChange" }> {
  const existing = itemsById.get(itemId)
  if (existing?.type === "fileChange") {
    return existing
  }

  const nextItem = createEmptyFileChange(itemId)
  upsertTurnItem(order, itemsById, nextItem)
  return nextItem
}

function appendDelta(current: string[] | undefined, index: number, delta: string): string[] {
  const next = [...(current ?? [])]
  next[index] = `${next[index] ?? ""}${delta}`
  return next
}

function mapTurnItemsToMessages(turn: CodexTurn, sessionId: string): MessageWithParts[] {
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
            }
          ),
        ]

      case "plan":
        return [
          createAssistantMessage(sessionId, item.id, createdAt, [
            {
              id: `${item.id}:text`,
              type: "text",
              text: item.text,
            },
          ], undefined, {
            itemType: "plan",
          }),
        ]

      case "reasoning":
        return [
          createAssistantMessage(sessionId, item.id, createdAt, [
            {
              id: `${item.id}:text`,
                type: "text",
                text: [...item.summary, ...item.content].join("\n\n"),
              },
          ], undefined, {
            itemType: "reasoning",
          }),
        ]

      case "commandExecution":
        return [
          createToolMessage(sessionId, item.id, createdAt, "command/exec", {
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
          }, "commandExecution"),
        ]

      case "fileChange":
        return [
          createToolMessage(sessionId, item.id, createdAt, "fileChange", {
            status: mapCodexStatus(item.status),
            title: "Apply file changes",
            input: {
              changes: item.changes,
            },
            output: {
              changes: item.changes,
              outputText: item.outputText ?? null,
            },
          }, "fileChange"),
        ]

      case "mcpToolCall":
        return [
          createToolMessage(sessionId, item.id, createdAt, `${item.server}/${item.tool}`, {
            status: mapCodexStatus(item.status),
            title: `${item.server}:${item.tool}`,
            input: {
              arguments: item.arguments,
            },
            output: item.result,
            error: item.error,
          }, "mcpToolCall"),
        ]

      case "dynamicToolCall":
        return [
          createToolMessage(sessionId, item.id, createdAt, item.tool, {
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
          }, "dynamicToolCall"),
        ]

      case "collabAgentToolCall":
        return [
          createToolMessage(sessionId, item.id, createdAt, `collab/${item.tool}`, {
            status: mapCodexStatus(item.status),
            title: item.tool,
            input: {
              senderThreadId: item.senderThreadId,
              receiverThreadIds: item.receiverThreadIds,
              prompt: item.prompt,
            },
            output: item.agentsStates,
          }, "collabAgentToolCall"),
        ]

      case "webSearch":
        return [
          createToolMessage(sessionId, item.id, createdAt, "webSearch", {
            status: "completed",
            title: item.query,
            input: {
              query: item.query,
            },
            output: item.action,
          }, "webSearch"),
        ]

      case "imageGeneration":
        return [
          createToolMessage(sessionId, item.id, createdAt, "imageGeneration", {
            status: mapCodexStatus(item.status),
            title: "Generate image",
            input: {
              revisedPrompt: item.revisedPrompt,
            },
            output: item.result,
          }, "imageGeneration"),
        ]

      case "imageView":
        return [
          createToolMessage(sessionId, item.id, createdAt, "imageView", {
            status: "completed",
            title: item.path,
            input: {
              path: item.path,
            },
            output: null,
          }, "imageView"),
        ]

      case "enteredReviewMode":
      case "exitedReviewMode":
        return [
          createAssistantMessage(sessionId, item.id, createdAt, [
            {
              id: `${item.id}:text`,
                type: "text",
                text: item.review,
              },
          ], undefined, {
            itemType: item.type,
          }),
        ]

      case "contextCompaction":
        return [
          createToolMessage(sessionId, item.id, createdAt, "contextCompaction", {
            status: "completed",
            title: "Compact context",
            input: {},
            output: null,
          }, "contextCompaction"),
        ]

      default:
        return []
    }
  })
}

export class CodexHarnessAdapter implements HarnessAdapter {
  private rpc = getCodexRpcClient()
  private activeTurns = new Map<string, string>()

  constructor(public definition: HarnessDefinition) {}

  async initialize(): Promise<void> {
    await this.rpc.connect()
  }

  async createSession(projectPath: string): Promise<RuntimeSession> {
    await this.initialize()

    const response = await this.rpc.request<{
      thread: CodexThread
    }>("thread/start", {
      cwd: projectPath,
      approvalPolicy: "never",
      sandbox: "workspace-write",
      experimentalRawEvents: false,
      persistExtendedHistory: false,
    })

    return mapThreadToSession(response.thread)
  }

  async listAgents() {
    return []
  }

  async listCommands() {
    return []
  }

  async searchFiles() {
    return []
  }

  async sendMessage(input: HarnessTurnInput): Promise<HarnessTurnResult> {
    const response = await this.rpc.request<CodexTurnStartResponse>("turn/start", {
      threadId: input.session.id,
      cwd: input.projectPath ?? input.session.projectPath ?? null,
      input: [
        {
          type: "text",
          text: input.text,
          text_elements: [],
        },
      ],
    })

    const turnId = response.turn.id
    this.activeTurns.set(input.session.id, turnId)

    const completedTurn = await this.waitForTurnCompletion(
      input.session.id,
      turnId,
      input.onUpdate
    )
    this.activeTurns.delete(input.session.id)

    if (completedTurn?.status === "failed" && completedTurn.error?.message) {
      throw new Error(completedTurn.error.message)
    }

    const turn =
      completedTurn && completedTurn.items.length > 0
        ? completedTurn
        : (await this.readTurn(input.session.id, turnId)) ?? completedTurn

    if (!turn) {
      return { messages: [] }
    }

    return {
      messages: mapTurnItemsToMessages(turn, input.session.id),
    }
  }

  async executeCommand(input: HarnessCommandInput): Promise<HarnessTurnResult> {
    const now = Date.now()

    return {
      messages: [
        createAssistantMessage(
          input.session.id,
          `command:${now}`,
          now,
          [
            {
              id: `command:${now}:text`,
              type: "text",
              text: `Command execution through the Codex adapter is not wired up yet. Requested command: /${input.command}${input.args ? ` ${input.args}` : ""}`,
            },
          ]
        ),
      ],
    }
  }

  async abortSession(session: RuntimeSession): Promise<void> {
    const turnId = this.activeTurns.get(session.id)
    if (!turnId) {
      return
    }

    await this.rpc.request("turn/interrupt", {
      threadId: session.id,
      turnId,
    })
    this.activeTurns.delete(session.id)
  }

  private async waitForTurnCompletion(
    threadId: string,
    turnId: string,
    onUpdate?: HarnessTurnInput["onUpdate"]
  ): Promise<CodexTurn | undefined> {
    return new Promise<CodexTurn>((resolve, reject) => {
      const itemOrder: string[] = []
      const itemsById = new Map<string, CodexThreadItem>()
      let settled = false
      let emitQueued = false
      let lastEmittedSnapshot = ""

      const emitUpdate = () => {
        if (!onUpdate || emitQueued || settled) {
          return
        }

        const items = getOrderedTurnItems(itemOrder, itemsById)
        const snapshot = JSON.stringify(items)
        if (snapshot === lastEmittedSnapshot) {
          return
        }
        lastEmittedSnapshot = snapshot

        emitQueued = true

        requestAnimationFrame(() => {
          emitQueued = false
          if (settled) {
            return
          }

          onUpdate({
            messages: mapTurnItemsToMessages(
              {
                id: turnId,
                items,
                status: "inProgress",
                error: null,
              },
              threadId
            ),
          })
        })
      }

      const syncTurnFromRead = async (): Promise<void> => {
        try {
          const turn = await this.readTurn(threadId, turnId)
          if (!turn) {
            return
          }

          for (const item of turn.items) {
            upsertTurnItem(itemOrder, itemsById, item)
          }

          emitUpdate()

          if (turn.status !== "inProgress") {
            finish(turn)
          }
        } catch (error) {
          if (!isTransientTurnReadError(error)) {
            fail(error)
          }
        }
      }

      const finish = (turn: CodexTurn) => {
        if (settled) {
          return
        }

        settled = true
        window.clearTimeout(timeoutId)
        window.clearInterval(syncIntervalId)
        unsubscribe()
        resolve(turn)
      }

      const fail = (error: unknown) => {
        if (settled) {
          return
        }

        settled = true
        window.clearTimeout(timeoutId)
        window.clearInterval(syncIntervalId)
        unsubscribe()
        reject(error instanceof Error ? error : new Error(String(error)))
      }

      const timeoutId = window.setTimeout(async () => {
        try {
          const fallbackTurn = await this.readTurn(threadId, turnId)
          if (fallbackTurn && fallbackTurn.status !== "inProgress") {
            finish(fallbackTurn)
            return
          }
        } catch (error) {
          if (!isTransientTurnReadError(error)) {
            fail(error)
            return
          }
        }

        fail(new Error("Timed out waiting for Codex turn completion"))
      }, TURN_COMPLETION_TIMEOUT_MS)

      const syncIntervalId = window.setInterval(() => {
        void syncTurnFromRead()
      }, TURN_SYNC_INTERVAL_MS)

      const unsubscribe = this.rpc.onNotification((notification) => {
        try {
          switch (notification.method) {
            case "item/started": {
              const params = notification.params as CodexItemNotification | undefined
              if (!params || params.threadId !== threadId || params.turnId !== turnId) {
                return
              }

              upsertTurnItem(itemOrder, itemsById, params.item)
              emitUpdate()
              return
            }

            case "item/completed": {
              const params = notification.params as CodexItemNotification | undefined
              if (!params || params.threadId !== threadId || params.turnId !== turnId) {
                return
              }

              upsertTurnItem(itemOrder, itemsById, params.item)
              emitUpdate()
              return
            }

            case "item/agentMessage/delta": {
              const params = notification.params as CodexTextDeltaNotification | undefined
              if (!params || params.threadId !== threadId || params.turnId !== turnId) {
                return
              }

              const item = ensureAgentMessageItem(itemOrder, itemsById, params.itemId)
              itemsById.set(item.id, {
                ...item,
                text: `${item.text}${params.delta}`,
              })
              emitUpdate()
              return
            }

            case "item/plan/delta": {
              const params = notification.params as CodexTextDeltaNotification | undefined
              if (!params || params.threadId !== threadId || params.turnId !== turnId) {
                return
              }

              const item = ensurePlanItem(itemOrder, itemsById, params.itemId)
              itemsById.set(item.id, {
                ...item,
                text: `${item.text}${params.delta}`,
              })
              emitUpdate()
              return
            }

            case "item/reasoning/textDelta": {
              const params = notification.params as CodexReasoningTextDeltaNotification | undefined
              if (!params || params.threadId !== threadId || params.turnId !== turnId) {
                return
              }

              const item = ensureReasoningItem(itemOrder, itemsById, params.itemId)
              itemsById.set(item.id, {
                ...item,
                content: appendDelta(item.content, params.contentIndex, params.delta),
              })
              emitUpdate()
              return
            }

            case "item/reasoning/summaryTextDelta": {
              const params =
                notification.params as CodexReasoningSummaryTextDeltaNotification | undefined
              if (!params || params.threadId !== threadId || params.turnId !== turnId) {
                return
              }

              const item = ensureReasoningItem(itemOrder, itemsById, params.itemId)
              itemsById.set(item.id, {
                ...item,
                summary: appendDelta(item.summary, params.summaryIndex, params.delta),
              })
              emitUpdate()
              return
            }

            case "item/commandExecution/outputDelta": {
              const params = notification.params as CodexOutputDeltaNotification | undefined
              if (!params || params.threadId !== threadId || params.turnId !== turnId) {
                return
              }

              const item = ensureCommandExecutionItem(itemOrder, itemsById, params.itemId)
              itemsById.set(item.id, {
                ...item,
                aggregatedOutput: `${item.aggregatedOutput ?? ""}${params.delta}`,
              })
              emitUpdate()
              return
            }

            case "item/fileChange/outputDelta": {
              const params = notification.params as CodexOutputDeltaNotification | undefined
              if (!params || params.threadId !== threadId || params.turnId !== turnId) {
                return
              }

              const item = ensureFileChangeItem(itemOrder, itemsById, params.itemId)
              itemsById.set(item.id, {
                ...item,
                outputText: `${item.outputText ?? ""}${params.delta}`,
              })
              emitUpdate()
              return
            }

            case "turn/completed": {
              const params = notification.params as CodexTurnNotification | undefined
              if (!params || params.threadId !== threadId || params.turn.id !== turnId) {
                return
              }

              const completedTurn: CodexTurn = {
                ...params.turn,
                items: getOrderedTurnItems(itemOrder, itemsById),
              }
              finish(completedTurn)
              return
            }

            default:
              return
          }
        } catch (error) {
          fail(error)
        }
      })

      void syncTurnFromRead()
    })
  }

  private async readTurn(threadId: string, turnId: string): Promise<CodexTurn | undefined> {
    const readResponse = await this.rpc.request<CodexThreadReadResponse>("thread/read", {
      threadId,
      includeTurns: true,
    })

    return readResponse.thread.turns.find((candidate) => candidate.id === turnId)
  }
}
