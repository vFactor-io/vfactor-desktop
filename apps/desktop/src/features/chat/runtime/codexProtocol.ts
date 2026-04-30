import type { HarnessTurnInput, RuntimeSession } from "../types"
import type { CodexRpcClient } from "./codexRpcClient"

export const TURN_SYNC_INTERVAL_MS = 250
export const READ_TURN_TIMEOUT_MS = 10_000
export const TURN_STALL_TIMEOUT_MS = 120_000

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      reject(new Error(message))
    }, timeoutMs)

    promise.then(
      (value) => {
        globalThis.clearTimeout(timeoutId)
        resolve(value)
      },
      (error) => {
        globalThis.clearTimeout(timeoutId)
        reject(error)
      }
    )
  })
}

export interface CodexThread {
  id: string
  preview: string
  createdAt: number
  updatedAt: number
  cwd: string
  name: string | null
}

export interface CodexTurn {
  id: string
  items: CodexThreadItem[]
  status: string
  error: { message?: string } | null
}

export type CodexThreadItem =
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
      title?: string | null
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

export interface CodexThreadReadResponse {
  thread: {
    turns: CodexTurn[]
  }
}

export interface CodexTurnStartResponse {
  turn: {
    id: string
  }
}

export interface CodexModelReasoningEffort {
  reasoningEffort: string
  description?: string | null
}

export interface CodexModel {
  id: string
  model: string
  displayName?: string | null
  hidden?: boolean
  defaultReasoningEffort?: string | null
  supportedReasoningEfforts?: CodexModelReasoningEffort[] | null
  inputModalities?: string[]
  supportsPersonality?: boolean
  isDefault?: boolean
}

export interface CodexModelListResponse {
  data: CodexModel[]
  nextCursor: string | null
}

export interface CodexTurnNotification {
  threadId: string
  turn: CodexTurn
}

export interface CodexItemNotification {
  threadId: string
  turnId: string
  item: CodexThreadItem
}

export interface CodexTextDeltaNotification {
  threadId: string
  turnId: string
  itemId: string
  delta: string
}

export interface CodexOutputDeltaNotification {
  threadId: string
  turnId: string
  itemId: string
  delta: string
}

export interface CodexServerRequestResolvedNotification {
  threadId: string
  requestId: string | number
}

export interface CodexReasoningTextDeltaNotification extends CodexTextDeltaNotification {
  contentIndex: number
}

export interface CodexReasoningSummaryTextDeltaNotification extends CodexTextDeltaNotification {
  summaryIndex: number
}

export interface CodexToolRequestUserInputOption {
  label: string
  description: string
}

export interface CodexToolRequestUserInputQuestion {
  id: string
  header: string
  question: string
  isOther: boolean
  isSecret: boolean
  options: CodexToolRequestUserInputOption[] | null
}

export interface CodexToolRequestUserInputParams {
  threadId: string
  turnId: string
  itemId: string
  questions: CodexToolRequestUserInputQuestion[]
}

export interface CodexApprovalChangePayload {
  type?: unknown
  content?: unknown
  diff?: unknown
  unified_diff?: unknown
}

export interface CodexApplyPatchApprovalRequestMessage {
  type?: string
  call_id?: string
  turn_id?: string
  item_id?: string
  changes?: unknown
  reason?: unknown
  grant_root?: unknown
}

export interface CodexExecApprovalRequestMessage {
  type?: string
  call_id?: string
  turn_id?: string
  item_id?: string
  command?: unknown
  cmd?: unknown
  cwd?: unknown
  reason?: unknown
  commandActions?: unknown
  command_actions?: unknown
  parsedCmd?: unknown
  parsed_cmd?: unknown
  proposed_execpolicy_amendment?: unknown
}

export interface CodexApprovalNotificationParams {
  id?: string | number
  conversationId?: string
  threadId?: string
  turnId?: string
  msg?: CodexApplyPatchApprovalRequestMessage | CodexExecApprovalRequestMessage
}

export interface CodexFileChangeApprovalServerRequestParams {
  threadId?: string
  conversationId?: string
  turnId?: string
  itemId?: string
  callId?: string
  changes?: unknown
  reason?: unknown
  grantRoot?: unknown
}

export interface CodexCommandApprovalServerRequestParams {
  threadId?: string
  conversationId?: string
  turnId?: string
  itemId?: string
  callId?: string
  command?: unknown
  cmd?: unknown
  cwd?: unknown
  reason?: unknown
  commandActions?: unknown
  command_actions?: unknown
  parsedCmd?: unknown
  parsed_cmd?: unknown
}

function toMilliseconds(seconds: number): number {
  return seconds * 1000
}

export function mapReasoningEffort(
  effort: HarnessTurnInput["reasoningEffort"]
): string | null {
  return effort ?? null
}

export function isTransientTurnReadError(error: unknown): boolean {
  const message = String(error)
  return (
    message.includes("is not materialized yet") ||
    message.includes("includeTurns is unavailable before first user message")
  )
}

export function mapThreadToSession(thread: CodexThread): RuntimeSession {
  const title = thread.name ?? (thread.preview || undefined)

  return {
    id: thread.id,
    remoteId: thread.id,
    harnessId: "codex",
    title,
    projectPath: thread.cwd,
    createdAt: toMilliseconds(thread.createdAt),
    updatedAt: toMilliseconds(thread.updatedAt),
  }
}

export async function readCodexTurn(
  rpc: Pick<CodexRpcClient, "request">,
  threadId: string,
  turnId: string
): Promise<CodexTurn | undefined> {
  const readResponse = await withTimeout(
    rpc.request<CodexThreadReadResponse>("thread/read", {
      threadId,
      includeTurns: true,
    }),
    READ_TURN_TIMEOUT_MS,
    "Timed out reading Codex turn state."
  )

  return readResponse.thread.turns.find((candidate) => candidate.id === turnId)
}
