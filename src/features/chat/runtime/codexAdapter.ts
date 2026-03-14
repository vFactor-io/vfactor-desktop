import type {
  HarnessAdapter,
  HarnessCommandInput,
  HarnessDefinition,
  HarnessPromptInput,
  HarnessTurnInput,
  HarnessTurnResult,
  MessageWithParts,
  RuntimeApprovalFileChange,
  RuntimeMessage,
  RuntimeMessagePart,
  RuntimePrompt,
  RuntimeQuestionPrompt,
  RuntimePromptQuestion,
  RuntimePromptResponse,
  RuntimeQuestionPromptResponse,
  RuntimeSession,
  RuntimeToolPart,
  RuntimeToolState,
} from "../types"
import { getRemoteSessionId } from "../domain/runtimeSessions"
import { getCodexRpcClient } from "./codexRpcClient"

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

interface CodexServerRequestResolvedNotification {
  threadId: string
  requestId: string | number
}

interface CodexReasoningTextDeltaNotification extends CodexTextDeltaNotification {
  contentIndex: number
}

interface CodexReasoningSummaryTextDeltaNotification extends CodexTextDeltaNotification {
  summaryIndex: number
}

interface CodexToolRequestUserInputOption {
  label: string
  description: string
}

interface CodexToolRequestUserInputQuestion {
  id: string
  header: string
  question: string
  isOther: boolean
  isSecret: boolean
  options: CodexToolRequestUserInputOption[] | null
}

interface CodexToolRequestUserInputParams {
  threadId: string
  turnId: string
  itemId: string
  questions: CodexToolRequestUserInputQuestion[]
}

interface CodexPendingUserInputRequest {
  requestId: string | number
  threadId: string
  turnId: string
  itemId: string
  prompt: RuntimePrompt
}

interface CodexApprovalChangePayload {
  type?: unknown
  content?: unknown
  diff?: unknown
  unified_diff?: unknown
}

interface CodexApplyPatchApprovalRequestMessage {
  type?: string
  call_id?: string
  turn_id?: string
  item_id?: string
  changes?: unknown
  reason?: unknown
  grant_root?: unknown
}

interface CodexExecApprovalRequestMessage {
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

interface CodexApprovalNotificationParams {
  id?: string | number
  conversationId?: string
  threadId?: string
  turnId?: string
  msg?: CodexApplyPatchApprovalRequestMessage | CodexExecApprovalRequestMessage
}

interface CodexFileChangeApprovalServerRequestParams {
  threadId?: string
  conversationId?: string
  turnId?: string
  itemId?: string
  callId?: string
  changes?: unknown
}

interface CodexCommandApprovalServerRequestParams {
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

interface CodexPendingApprovalRequest {
  protocol: "v1ClientRequest" | "v1ServerRequest" | "v2ServerRequest"
  requestMethod?: "applyPatchApproval" | "execCommandApproval"
  requestId?: string | number
  threadId: string
  turnId: string
  itemId?: string
  callId: string
  prompt: RuntimePrompt
}

function toMilliseconds(seconds: number): number {
  return seconds * 1000
}

function mapReasoningEffort(
  effort: HarnessTurnInput["reasoningEffort"]
): "low" | "medium" | "high" | null {
  return effort ?? null
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
    remoteId: thread.id,
    harnessId: "codex",
    title,
    projectPath: thread.cwd,
    createdAt: toMilliseconds(thread.createdAt),
    updatedAt: toMilliseconds(thread.updatedAt),
  }
}

function mapCodexUserInputQuestionToRuntimeQuestion(
  question: CodexToolRequestUserInputQuestion,
  promptTitle: string
): RuntimePromptQuestion {
  const options = question.options?.map((option) => ({
    id: `${question.id}:${option.label}`,
    label: option.label,
    description: option.description,
  }))

  return {
    id: question.id,
    label: question.question,
    description: question.header !== promptTitle ? question.header : undefined,
    kind: options && options.length > 0 ? "single_select" : "text",
    options,
    allowOther: question.isOther || undefined,
    isSecret: question.isSecret || undefined,
    required: true,
  }
}

function mapCodexUserInputRequestToPrompt(
  requestId: string | number,
  params: CodexToolRequestUserInputParams
): RuntimePrompt | null {
  if (params.questions.length === 0) {
    return null
  }

  const promptTitle = params.questions[0]?.header?.trim() || "Agent question"

  return {
    id: `codex-request-user-input:${String(requestId)}`,
    kind: "question",
    title: promptTitle,
    body: params.questions.length > 1 ? "Answer the questions below to continue." : undefined,
    questions: params.questions.map((question) =>
      mapCodexUserInputQuestionToRuntimeQuestion(question, promptTitle)
    ),
  }
}

function mapRuntimePromptResponseToCodexResponse(
  prompt: RuntimeQuestionPrompt,
  response: RuntimeQuestionPromptResponse
): { answers: Record<string, { answers: string[] }> } {
  return {
    answers: Object.fromEntries(
      prompt.questions.map((question) => {
        const rawAnswer = response.answers[question.id]
        const customValue = response.customAnswers[question.id]?.trim() ?? ""
        const selectedAnswers = Array.isArray(rawAnswer)
          ? rawAnswer.filter((answer) => answer.trim().length > 0)
          : typeof rawAnswer === "string" && rawAnswer.trim().length > 0
            ? [rawAnswer.trim()]
            : []
        const answers = [...selectedAnswers]

        if (customValue.length > 0) {
          answers.push(question.kind === "text" ? customValue : `user_note: ${customValue}`)
        }

        return [
          question.id,
          {
            answers,
          },
        ] as const
      })
    ),
  }
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function normalizeApprovalChangeType(value: unknown): RuntimeApprovalFileChange["type"] {
  const normalized = String(value ?? "").toLowerCase()

  if (normalized.includes("delete") || normalized.includes("remove")) {
    return "delete"
  }

  if (normalized.includes("add") || normalized.includes("create")) {
    return "add"
  }

  if (normalized.includes("update") || normalized.includes("modify") || normalized.includes("edit")) {
    return "update"
  }

  return "change"
}

function mapCodexApprovalChanges(changes: unknown): RuntimeApprovalFileChange[] {
  if (Array.isArray(changes)) {
    return changes.flatMap((entry) => {
      if (!entry || typeof entry !== "object") {
        return []
      }

      const path =
        ("path" in entry && typeof entry.path === "string" && entry.path) ||
        ("filePath" in entry && typeof entry.filePath === "string" && entry.filePath) ||
        ("file_path" in entry && typeof entry.file_path === "string" && entry.file_path)

      if (!path) {
        return []
      }

      return [
        {
          path,
          type: normalizeApprovalChangeType("type" in entry ? entry.type : undefined),
          content: toOptionalString("content" in entry ? entry.content : undefined),
          diff: toOptionalString(
            "diff" in entry ? entry.diff : "unified_diff" in entry ? entry.unified_diff : undefined
          ),
        },
      ]
    })
  }

  if (!changes || typeof changes !== "object") {
    return []
  }

  return Object.entries(changes as Record<string, CodexApprovalChangePayload>).map(
    ([path, change]) => ({
      path,
      type: normalizeApprovalChangeType(change?.type),
      content: toOptionalString(change?.content),
      diff: toOptionalString(change?.diff ?? change?.unified_diff),
    })
  )
}

function getApprovalCommand(value: {
  command?: unknown
  cmd?: unknown
}): string | undefined {
  if (typeof value.command === "string" && value.command.trim().length > 0) {
    return value.command
  }

  if (typeof value.cmd === "string" && value.cmd.trim().length > 0) {
    return value.cmd
  }

  if (Array.isArray(value.command) && value.command.every((part) => typeof part === "string")) {
    return value.command.join(" ")
  }

  return undefined
}

function getApprovalCommandActions(value: {
  commandActions?: unknown
  command_actions?: unknown
  parsedCmd?: unknown
  parsed_cmd?: unknown
}): unknown[] | undefined {
  const candidate =
    value.commandActions ??
    value.command_actions ??
    value.parsedCmd ??
    value.parsed_cmd

  if (Array.isArray(candidate)) {
    return candidate
  }

  if (candidate && typeof candidate === "object") {
    return [candidate]
  }

  return undefined
}

function mapApprovalDecisionToServerResponse(
  prompt: RuntimePrompt,
  response: RuntimePromptResponse
): { decision: string } {
  if (prompt.kind !== "approval" || response.kind !== "approval") {
    throw new Error("Approval responses can only be sent for approval prompts")
  }

  return {
    decision: response.decision === "approve" ? "accept" : "decline",
  }
}

function mapApprovalDecisionToClientRequest(
  prompt: RuntimePrompt,
  response: RuntimePromptResponse
): { decision: string } {
  if (prompt.kind !== "approval" || response.kind !== "approval") {
    throw new Error("Approval responses can only be sent for approval prompts")
  }

  return {
    decision: response.decision === "approve" ? "accept" : "decline",
  }
}

function logCodexApprovalDebug(event: string, details: Record<string, unknown>): void {
  console.info("[codexApproval]", event, details)
}

function mergeApprovalPrompts(
  actionablePrompt: RuntimePrompt,
  metadataPrompt: RuntimePrompt | undefined
): RuntimePrompt {
  if (
    actionablePrompt.kind !== "approval" ||
    metadataPrompt?.kind !== "approval" ||
    actionablePrompt.approval.callId !== metadataPrompt.approval.callId
  ) {
    return actionablePrompt
  }

  return {
    ...actionablePrompt,
    body: actionablePrompt.body ?? metadataPrompt.body,
    approval: {
      ...metadataPrompt.approval,
      ...actionablePrompt.approval,
      changes: actionablePrompt.approval.changes ?? metadataPrompt.approval.changes,
      command: actionablePrompt.approval.command ?? metadataPrompt.approval.command,
      commandSegments:
        actionablePrompt.approval.commandSegments ?? metadataPrompt.approval.commandSegments,
      cwd: actionablePrompt.approval.cwd ?? metadataPrompt.approval.cwd,
      reason: actionablePrompt.approval.reason ?? metadataPrompt.approval.reason,
      grantRoot: actionablePrompt.approval.grantRoot ?? metadataPrompt.approval.grantRoot,
      commandActions:
        actionablePrompt.approval.commandActions ?? metadataPrompt.approval.commandActions,
    },
  }
}

function mapRuntimeFileChangesToApplyPatchFileChanges(
  changes: RuntimeApprovalFileChange[] | undefined
): Record<string, unknown> {
  return Object.fromEntries(
    (changes ?? []).map((change) => {
      if (change.type === "add") {
        return [change.path, { type: "add", content: change.content ?? "" }] as const
      }

      if (change.type === "delete") {
        return [change.path, { type: "delete", content: change.content ?? "" }] as const
      }

      return [
        change.path,
        {
          type: "update",
          unified_diff: change.diff ?? change.content ?? "",
          move_path: null,
        },
      ] as const
    })
  )
}

function mapApprovalPromptToApplyPatchApprovalParams(prompt: RuntimePrompt): Record<string, unknown> {
  if (prompt.kind !== "approval" || prompt.approval.kind !== "fileChange") {
    throw new Error("Apply patch approvals require a file-change approval prompt")
  }

  return {
    conversationId: prompt.approval.conversationId,
    callId: prompt.approval.callId,
    fileChanges: mapRuntimeFileChangesToApplyPatchFileChanges(prompt.approval.changes),
    reason: prompt.approval.reason ?? null,
    grantRoot: prompt.approval.grantRoot ?? null,
  }
}

function mapApprovalPromptToExecCommandApprovalParams(prompt: RuntimePrompt): Record<string, unknown> {
  if (prompt.kind !== "approval" || prompt.approval.kind !== "commandExecution") {
    throw new Error("Exec command approvals require a command approval prompt")
  }

  return {
    conversationId: prompt.approval.conversationId,
    callId: prompt.approval.callId,
    command: prompt.approval.commandSegments ?? [],
    cwd: prompt.approval.cwd ?? "",
    reason: prompt.approval.reason ?? null,
    parsedCmd: Array.isArray(prompt.approval.commandActions) ? prompt.approval.commandActions : [],
  }
}

function mapApplyPatchApprovalNotificationToPrompt(
  params: CodexApprovalNotificationParams
): RuntimePrompt | null {
  const threadId = params.conversationId ?? params.threadId
  const message = params.msg as CodexApplyPatchApprovalRequestMessage | undefined
  const callId = toOptionalString(message?.call_id)
  const turnId = toOptionalString(message?.turn_id ?? params.turnId)

  if (!threadId || !callId || !turnId) {
    return null
  }

  const changes = mapCodexApprovalChanges(message?.changes)

  return {
    id: `codex-approval:fileChange:${callId}`,
    kind: "approval",
    title: "Approve file changes",
    body:
      changes.length > 0
        ? `Codex wants to apply ${changes.length === 1 ? "1 file change" : `${changes.length} file changes`} before continuing.`
        : "Codex wants to apply file changes before continuing.",
    approval: {
      kind: "fileChange",
      callId,
      turnId,
      conversationId: threadId,
      itemId: toOptionalString(message?.item_id),
      changes,
      reason: toOptionalString(message?.reason),
      grantRoot: toOptionalString(message?.grant_root),
    },
  }
}

function mapExecApprovalNotificationToPrompt(
  params: CodexApprovalNotificationParams
): RuntimePrompt | null {
  const threadId = params.conversationId ?? params.threadId
  const message = params.msg as CodexExecApprovalRequestMessage | undefined
  const callId = toOptionalString(message?.call_id)
  const turnId = toOptionalString(message?.turn_id ?? params.turnId)

  if (!threadId || !callId || !turnId) {
    return null
  }

  return {
    id: `codex-approval:commandExecution:${callId}`,
    kind: "approval",
    title: "Approve command execution",
    body: "Codex needs approval before running a command in your workspace.",
    approval: {
      kind: "commandExecution",
      callId,
      turnId,
      conversationId: threadId,
      itemId: toOptionalString(message?.item_id),
      command: getApprovalCommand(message ?? {}),
      commandSegments:
        Array.isArray(message?.command) && message.command.every((part) => typeof part === "string")
          ? message.command
          : undefined,
      cwd: toOptionalString(message?.cwd),
      reason: toOptionalString(message?.reason),
      commandActions: getApprovalCommandActions(message ?? {}),
    },
  }
}

function mapFileChangeApprovalServerRequestToPrompt(
  requestId: string | number,
  params: CodexFileChangeApprovalServerRequestParams
): RuntimePrompt | null {
  const threadId = params.threadId ?? params.conversationId
  const turnId = toOptionalString(params.turnId)
  const callId = toOptionalString(params.callId ?? params.itemId)

  if (!threadId || !turnId || !callId) {
    return null
  }

  const changes = mapCodexApprovalChanges(params.changes)

  return {
    id: `codex-approval:fileChange:${callId}`,
    kind: "approval",
    title: "Approve file changes",
    body:
      changes.length > 0
        ? `Codex wants to apply ${changes.length === 1 ? "1 file change" : `${changes.length} file changes`} before continuing.`
        : "Codex wants to apply file changes before continuing.",
    approval: {
      kind: "fileChange",
      callId,
      turnId,
      conversationId: threadId,
      requestId,
      itemId: toOptionalString(params.itemId),
      changes,
      reason: toOptionalString(params.reason),
      grantRoot: toOptionalString(params.grantRoot),
    },
  }
}

function mapCommandApprovalServerRequestToPrompt(
  requestId: string | number,
  params: CodexCommandApprovalServerRequestParams
): RuntimePrompt | null {
  const threadId = params.threadId ?? params.conversationId
  const turnId = toOptionalString(params.turnId)
  const callId = toOptionalString(params.callId ?? params.itemId)

  if (!threadId || !turnId || !callId) {
    return null
  }

  return {
    id: `codex-approval:commandExecution:${callId}`,
    kind: "approval",
    title: "Approve command execution",
    body: "Codex needs approval before running a command in your workspace.",
    approval: {
      kind: "commandExecution",
      callId,
      turnId,
      conversationId: threadId,
      requestId,
      itemId: toOptionalString(params.itemId),
      command: getApprovalCommand(params),
      commandSegments: undefined,
      cwd: toOptionalString(params.cwd),
      reason: toOptionalString(params.reason),
      commandActions: getApprovalCommandActions(params),
    },
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
  private pendingUserInputRequests = new Map<string, CodexPendingUserInputRequest>()
  private pendingApprovalRequests = new Map<string, CodexPendingApprovalRequest>()
  private pendingApprovalNotificationPrompts = new Map<string, RuntimePrompt>()

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
      approvalPolicy: "untrusted",
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
    const threadId = getRemoteSessionId(input.session)
    const response = await this.rpc.request<CodexTurnStartResponse>("turn/start", {
      threadId,
      cwd: input.projectPath ?? input.session.projectPath ?? null,
      collaborationMode: input.collaborationMode
        ? {
            mode: input.collaborationMode,
            settings: {
              model: input.model ?? "gpt-5.4",
              reasoning_effort: mapReasoningEffort(input.reasoningEffort),
              developer_instructions: null,
            },
          }
        : null,
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
      threadId,
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
        : (await this.readTurn(threadId, turnId)) ?? completedTurn

    if (!turn) {
      return { messages: [] }
    }

    return {
      messages: mapTurnItemsToMessages(turn, input.session.id),
    }
  }

  async answerPrompt(input: HarnessPromptInput): Promise<HarnessTurnResult> {
    const pendingRequest = this.pendingUserInputRequests.get(input.session.id)
    if (pendingRequest && pendingRequest.prompt.id === input.prompt.id) {
      if (input.prompt.kind !== "question" || input.response.kind !== "question") {
        throw new Error("Question prompt responses must use the structured question answer shape")
      }

      this.rpc.respond(
        pendingRequest.requestId,
        mapRuntimePromptResponseToCodexResponse(input.prompt, input.response)
      )

      try {
        await this.rpc.waitForNotification<CodexServerRequestResolvedNotification>(
          (notification) =>
            notification.method === "serverRequest/resolved" &&
            notification.params?.threadId === pendingRequest.threadId &&
            notification.params?.requestId === pendingRequest.requestId,
          TURN_SYNC_INTERVAL_MS * 8
        )
      } catch {
        // Ignore races where the request resolves before the listener attaches.
      }

      this.pendingUserInputRequests.delete(input.session.id)
      return {}
    }

    const pendingApprovalRequest = this.pendingApprovalRequests.get(input.session.id)
    if (pendingApprovalRequest && pendingApprovalRequest.prompt.id === input.prompt.id) {
      logCodexApprovalDebug("answer:start", {
        sessionId: input.session.id,
        promptId: input.prompt.id,
        protocol: pendingApprovalRequest.protocol,
        requestId: pendingApprovalRequest.requestId ?? null,
        callId: pendingApprovalRequest.callId,
        approvalKind:
          input.prompt.kind === "approval" ? input.prompt.approval.kind : null,
        decision:
          input.response.kind === "approval" ? input.response.decision : null,
      })

      if (pendingApprovalRequest.protocol === "v2ServerRequest") {
        if (pendingApprovalRequest.requestId == null) {
          throw new Error("Approval server request is missing a request id.")
        }

        this.rpc.respond(
          pendingApprovalRequest.requestId,
          mapApprovalDecisionToServerResponse(input.prompt, input.response)
        )

        try {
          await this.rpc.waitForNotification<CodexServerRequestResolvedNotification>(
            (notification) =>
              notification.method === "serverRequest/resolved" &&
              notification.params?.threadId === pendingApprovalRequest.threadId &&
              notification.params?.requestId === pendingApprovalRequest.requestId,
            TURN_SYNC_INTERVAL_MS * 8
          )
        } catch {
          // Ignore races where the request resolves before the listener attaches.
        }
      } else if (pendingApprovalRequest.protocol === "v1ServerRequest") {
        if (pendingApprovalRequest.requestId == null) {
          throw new Error("Approval server request is missing a request id.")
        }

        this.rpc.respond(
          pendingApprovalRequest.requestId,
          mapApprovalDecisionToClientRequest(input.prompt, input.response)
        )
      } else {
        const method =
          pendingApprovalRequest.requestMethod ??
          (input.prompt.kind === "approval" && input.prompt.approval.kind === "fileChange"
            ? "applyPatchApproval"
            : "execCommandApproval")
        const params =
          method === "applyPatchApproval"
            ? mapApprovalPromptToApplyPatchApprovalParams(input.prompt)
            : mapApprovalPromptToExecCommandApprovalParams(input.prompt)

        await this.rpc.request(method, {
          ...params,
          ...mapApprovalDecisionToClientRequest(input.prompt, input.response),
        })
      }

      this.pendingApprovalRequests.delete(input.session.id)
      this.pendingApprovalNotificationPrompts.delete(input.session.id)
      logCodexApprovalDebug("answer:cleared", {
        sessionId: input.session.id,
        promptId: input.prompt.id,
        requestId: pendingApprovalRequest.requestId ?? null,
        callId: pendingApprovalRequest.callId,
      })
      return {}
    }

    if (input.prompt.kind === "approval") {
      logCodexApprovalDebug("answer:missing-pending", {
        sessionId: input.session.id,
        promptId: input.prompt.id,
        callId: input.prompt.approval.callId,
        approvalKind: input.prompt.approval.kind,
        pendingPromptId: pendingApprovalRequest?.prompt.id ?? null,
        pendingCallId: pendingApprovalRequest?.callId ?? null,
      })
      throw new Error("Approval request is no longer pending.")
    }

    return this.sendMessage({
      session: input.session,
      projectPath: input.projectPath,
      text: input.response.text,
    })
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
      threadId: getRemoteSessionId(session),
      turnId,
    })
    this.activeTurns.delete(session.id)
  }

  private async waitForTurnCompletion(
    threadId: string,
    sessionId: string,
    turnId: string,
    onUpdate?: HarnessTurnInput["onUpdate"]
  ): Promise<CodexTurn | undefined> {
    return new Promise<CodexTurn>((resolve, reject) => {
      const itemOrder: string[] = []
      const itemsById = new Map<string, CodexThreadItem>()
      let settled = false
      let emitQueued = false
      let lastEmittedSnapshot = ""
      let activePromptId: string | null = null

      const registerApprovalPrompt = (
        prompt: RuntimePrompt,
        pendingApproval: Omit<CodexPendingApprovalRequest, "callId" | "prompt" | "threadId" | "turnId">
      ) => {
        if (prompt.kind !== "approval") {
          return
        }

        const promptWithMetadata = mergeApprovalPrompts(
          prompt,
          this.pendingApprovalNotificationPrompts.get(sessionId)
        )

        const existingPendingApproval = this.pendingApprovalRequests.get(sessionId)
        if (existingPendingApproval?.callId === promptWithMetadata.approval.callId) {
          const shouldUpgradeToServerRequest =
            existingPendingApproval.protocol === "v1ClientRequest" &&
            pendingApproval.protocol !== "v1ClientRequest"

          if (shouldUpgradeToServerRequest) {
            const mergedPrompt =
              existingPendingApproval.prompt.kind === "approval" &&
              promptWithMetadata.kind === "approval"
                ? {
                    ...existingPendingApproval.prompt,
                    approval: {
                      ...existingPendingApproval.prompt.approval,
                      ...promptWithMetadata.approval,
                      changes:
                        existingPendingApproval.prompt.approval.changes ??
                        promptWithMetadata.approval.changes,
                      command:
                        existingPendingApproval.prompt.approval.command ??
                        promptWithMetadata.approval.command,
                      commandSegments:
                        existingPendingApproval.prompt.approval.commandSegments ??
                        promptWithMetadata.approval.commandSegments,
                      cwd:
                        existingPendingApproval.prompt.approval.cwd ??
                        promptWithMetadata.approval.cwd,
                      reason:
                        existingPendingApproval.prompt.approval.reason ??
                        promptWithMetadata.approval.reason,
                      grantRoot:
                        existingPendingApproval.prompt.approval.grantRoot ??
                        promptWithMetadata.approval.grantRoot,
                      commandActions:
                        existingPendingApproval.prompt.approval.commandActions ??
                        promptWithMetadata.approval.commandActions,
                    },
                  }
                : promptWithMetadata

            this.pendingApprovalRequests.set(sessionId, {
              ...pendingApproval,
              threadId: mergedPrompt.approval.conversationId,
              turnId: mergedPrompt.approval.turnId,
              itemId: mergedPrompt.approval.itemId,
              callId: mergedPrompt.approval.callId,
              prompt: mergedPrompt,
            })
            logCodexApprovalDebug("register:upgrade", {
              sessionId,
              promptId: mergedPrompt.id,
              callId: mergedPrompt.approval.callId,
              protocol: pendingApproval.protocol,
              requestId: "requestId" in pendingApproval ? pendingApproval.requestId ?? null : null,
              approvalKind: mergedPrompt.approval.kind,
            })
          }
          return
        }

        this.pendingApprovalRequests.set(sessionId, {
          ...pendingApproval,
          threadId: promptWithMetadata.approval.conversationId,
          turnId: promptWithMetadata.approval.turnId,
          itemId: promptWithMetadata.approval.itemId,
          callId: promptWithMetadata.approval.callId,
          prompt: promptWithMetadata,
        })
        logCodexApprovalDebug("register:new", {
          sessionId,
          promptId: promptWithMetadata.id,
          callId: promptWithMetadata.approval.callId,
          protocol: pendingApproval.protocol,
          requestId: "requestId" in pendingApproval ? pendingApproval.requestId ?? null : null,
          approvalKind: promptWithMetadata.approval.kind,
        })
        activePromptId = promptWithMetadata.id
        onUpdate?.({ prompt: promptWithMetadata })
      }

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
              sessionId
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
        window.clearInterval(syncIntervalId)
        unsubscribe()
        unsubscribeServerRequest()
        this.pendingUserInputRequests.delete(sessionId)
        this.pendingApprovalRequests.delete(sessionId)
        this.pendingApprovalNotificationPrompts.delete(sessionId)
        resolve(turn)
      }

      const fail = (error: unknown) => {
        if (settled) {
          return
        }

        settled = true
        window.clearInterval(syncIntervalId)
        unsubscribe()
        unsubscribeServerRequest()
        this.pendingUserInputRequests.delete(sessionId)
        this.pendingApprovalRequests.delete(sessionId)
        this.pendingApprovalNotificationPrompts.delete(sessionId)
        reject(error instanceof Error ? error : new Error(String(error)))
      }

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

            case "serverRequest/resolved": {
              const params =
                notification.params as CodexServerRequestResolvedNotification | undefined
              if (!params || params.threadId !== threadId) {
                return
              }

              const pendingRequest = this.pendingUserInputRequests.get(sessionId)
              if (pendingRequest?.requestId === params.requestId) {
                this.pendingUserInputRequests.delete(sessionId)
                activePromptId = null
                onUpdate?.({ prompt: null })
                return
              }

              const pendingApprovalRequest = this.pendingApprovalRequests.get(sessionId)
              if (pendingApprovalRequest?.requestId !== params.requestId) {
                return
              }

              this.pendingApprovalRequests.delete(sessionId)
              this.pendingApprovalNotificationPrompts.delete(sessionId)
              logCodexApprovalDebug("resolved", {
                sessionId,
                promptId: pendingApprovalRequest.prompt.id,
                requestId: params.requestId,
                callId: pendingApprovalRequest.callId,
                approvalKind:
                  pendingApprovalRequest.prompt.kind === "approval"
                    ? pendingApprovalRequest.prompt.approval.kind
                    : null,
              })
              activePromptId = null
              onUpdate?.({ prompt: null })
              return
            }

            case "codex/event/apply_patch_approval_request": {
              const params = notification.params as CodexApprovalNotificationParams | undefined
              const notificationTurnId =
                typeof params?.msg === "object" && params.msg && "turn_id" in params.msg
                  ? params.msg.turn_id
                  : params?.turnId
              if (
                !params ||
                (params.conversationId ?? params.threadId) !== threadId ||
                notificationTurnId !== turnId
              ) {
                return
              }

              const prompt = mapApplyPatchApprovalNotificationToPrompt(params)
              if (!prompt) {
                return
              }

              this.pendingApprovalNotificationPrompts.set(sessionId, prompt)
              logCodexApprovalDebug("notification:cached", {
                sessionId,
                promptId: prompt.id,
                callId: prompt.approval.callId,
                approvalKind: prompt.approval.kind,
                source: "codex/event/apply_patch_approval_request",
              })
              return
            }

            case "codex/event/exec_approval_request": {
              const params = notification.params as CodexApprovalNotificationParams | undefined
              const notificationTurnId =
                typeof params?.msg === "object" && params.msg && "turn_id" in params.msg
                  ? params.msg.turn_id
                  : params?.turnId
              if (
                !params ||
                (params.conversationId ?? params.threadId) !== threadId ||
                notificationTurnId !== turnId
              ) {
                return
              }

              const prompt = mapExecApprovalNotificationToPrompt(params)
              if (!prompt) {
                return
              }

              this.pendingApprovalNotificationPrompts.set(sessionId, prompt)
              logCodexApprovalDebug("notification:cached", {
                sessionId,
                promptId: prompt.id,
                callId: prompt.approval.callId,
                approvalKind: prompt.approval.kind,
                source: "codex/event/exec_approval_request",
              })
              return
            }

            default:
              return
          }
        } catch (error) {
          fail(error)
        }
      })

      const unsubscribeServerRequest = this.rpc.onServerRequest((request) => {
        try {
          if (request.method === "item/tool/requestUserInput") {
            const params = request.params as CodexToolRequestUserInputParams | undefined
            if (!params || params.threadId !== threadId || params.turnId !== turnId) {
              return
            }

            const prompt = mapCodexUserInputRequestToPrompt(request.id, params)
            if (!prompt || activePromptId === prompt.id) {
              return
            }

            activePromptId = prompt.id
            this.pendingUserInputRequests.set(sessionId, {
              requestId: request.id,
              threadId: params.threadId,
              turnId: params.turnId,
              itemId: params.itemId,
              prompt,
            })
            onUpdate?.({ prompt })
            return
          }

          if (request.method === "item/fileChange/requestApproval") {
            const params = request.params as CodexFileChangeApprovalServerRequestParams | undefined
            if (!params || (params.threadId ?? params.conversationId) !== threadId || params.turnId !== turnId) {
              return
            }

            const prompt = mapFileChangeApprovalServerRequestToPrompt(request.id, params)
            if (!prompt || activePromptId === prompt.id) {
              return
            }

            registerApprovalPrompt(prompt, {
              protocol: "v2ServerRequest",
              requestId: request.id,
            })
            return
          }

          if (request.method === "item/commandExecution/requestApproval") {
            const params = request.params as CodexCommandApprovalServerRequestParams | undefined
            if (!params || (params.threadId ?? params.conversationId) !== threadId || params.turnId !== turnId) {
              return
            }

            const prompt = mapCommandApprovalServerRequestToPrompt(request.id, params)
            if (!prompt || activePromptId === prompt.id) {
              return
            }

            registerApprovalPrompt(prompt, {
              protocol: "v2ServerRequest",
              requestId: request.id,
            })
            return
          }

          if (request.method === "applyPatchApproval") {
            const params = request.params as {
              conversationId?: string
              callId?: string
              fileChanges?: unknown
              reason?: unknown
              grantRoot?: unknown
            } | undefined
            if (!params || params.conversationId !== threadId) {
              return
            }

            const prompt = {
              id: `codex-approval:fileChange:${String(params.callId ?? "unknown")}`,
              kind: "approval" as const,
              title: "Approve file changes",
              body: "Codex wants to apply file changes before continuing.",
              approval: {
                kind: "fileChange" as const,
                callId: toOptionalString(params.callId) ?? "unknown",
                turnId,
                conversationId: params.conversationId,
                requestId: request.id,
                changes: mapCodexApprovalChanges(params.fileChanges),
                reason: toOptionalString(params.reason),
                grantRoot: toOptionalString(params.grantRoot),
              },
            }
            if (activePromptId === prompt.id) {
              return
            }

            registerApprovalPrompt(prompt, {
              protocol: "v1ServerRequest",
              requestId: request.id,
            })
            return
          }

          if (request.method === "execCommandApproval") {
            const params = request.params as {
              conversationId?: string
              callId?: string
              command?: unknown
              cwd?: unknown
              reason?: unknown
              parsedCmd?: unknown
            } | undefined
            if (!params || params.conversationId !== threadId) {
              return
            }

            const commandSegments =
              Array.isArray(params.command) && params.command.every((part) => typeof part === "string")
                ? params.command
                : []
            const prompt = {
              id: `codex-approval:commandExecution:${String(params.callId ?? "unknown")}`,
              kind: "approval" as const,
              title: "Approve command execution",
              body: "Codex needs approval before running a command in your workspace.",
              approval: {
                kind: "commandExecution" as const,
                callId: toOptionalString(params.callId) ?? "unknown",
                turnId,
                conversationId: params.conversationId,
                requestId: request.id,
                command: commandSegments.join(" "),
                commandSegments,
                cwd: toOptionalString(params.cwd),
                reason: toOptionalString(params.reason),
                commandActions: Array.isArray(params.parsedCmd) ? params.parsedCmd : [],
              },
            }
            if (activePromptId === prompt.id) {
              return
            }

            registerApprovalPrompt(prompt, {
              protocol: "v1ServerRequest",
              requestId: request.id,
            })
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
