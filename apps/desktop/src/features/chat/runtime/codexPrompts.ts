import type {
  RuntimeApprovalFileChange,
  RuntimePrompt,
  RuntimePromptQuestion,
  RuntimePromptResponse,
  RuntimeQuestionPrompt,
  RuntimeQuestionPromptResponse,
} from "../types"
import type {
  CodexApprovalChangePayload,
  CodexApprovalNotificationParams,
  CodexCommandApprovalServerRequestParams,
  CodexExecApprovalRequestMessage,
  CodexFileChangeApprovalServerRequestParams,
  CodexToolRequestUserInputParams,
} from "./codexProtocol"

export interface CodexPendingUserInputRequest {
  requestId: string | number
  threadId: string
  turnId: string
  itemId: string
  prompt: RuntimePrompt
}

export interface CodexPendingApprovalRequest {
  protocol: "v1ClientRequest" | "v1ServerRequest" | "v2ServerRequest"
  requestMethod?: "applyPatchApproval" | "execCommandApproval"
  requestId?: string | number
  threadId: string
  turnId: string
  itemId?: string
  callId: string
  prompt: RuntimePrompt
}

function mapCodexUserInputQuestionToRuntimeQuestion(
  question: CodexToolRequestUserInputParams["questions"][number],
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

export function mapCodexUserInputRequestToPrompt(
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

export function mapRuntimePromptResponseToCodexResponse(
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

export function toOptionalString(value: unknown): string | undefined {
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

export function mapCodexApprovalChanges(changes: unknown): RuntimeApprovalFileChange[] {
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

export function mapApprovalDecisionToServerResponse(
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

export function mapApprovalDecisionToClientRequest(
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

export function logCodexApprovalDebug(event: string, details: Record<string, unknown>): void {
  console.info("[codexApproval]", event, details)
}

export function mergeApprovalPrompts(
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

export function mapApprovalPromptToApplyPatchApprovalParams(
  prompt: RuntimePrompt
): Record<string, unknown> {
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

export function mapApprovalPromptToExecCommandApprovalParams(
  prompt: RuntimePrompt
): Record<string, unknown> {
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

export function mapApplyPatchApprovalNotificationToPrompt(
  params: CodexApprovalNotificationParams
): RuntimePrompt | null {
  const threadId = params.conversationId ?? params.threadId
  const message = params.msg
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

export function mapExecApprovalNotificationToPrompt(
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

export function mapFileChangeApprovalServerRequestToPrompt(
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

export function mapCommandApprovalServerRequestToPrompt(
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
