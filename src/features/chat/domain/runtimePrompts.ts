import type {
  RuntimeApprovalPrompt,
  RuntimeApprovalPromptResponse,
  RuntimePrompt,
  RuntimePromptQuestion,
  RuntimePromptResponse,
  RuntimePromptState,
  RuntimeQuestionPrompt,
  RuntimeQuestionPromptResponse,
} from "../types"

export function isRuntimeApprovalPrompt(
  prompt: RuntimePrompt | null | undefined
): prompt is RuntimeApprovalPrompt {
  return prompt?.kind === "approval"
}

export function isRuntimeQuestionPrompt(
  prompt: RuntimePrompt | null | undefined
): prompt is RuntimeQuestionPrompt {
  return prompt?.kind === "question"
}

export function isRuntimeApprovalPromptResponse(
  response: RuntimePromptResponse | null | undefined
): response is RuntimeApprovalPromptResponse {
  return response?.kind === "approval"
}

export function isRuntimeQuestionPromptResponse(
  response: RuntimePromptResponse | null | undefined
): response is RuntimeQuestionPromptResponse {
  return response?.kind === "question"
}

export function isRuntimePromptQuestionAnswered(
  question: RuntimePromptQuestion,
  value: string | string[] | undefined,
  customValue?: string
): boolean {
  const normalizedCustomValue = customValue?.trim() ?? ""
  if (normalizedCustomValue.length > 0) {
    return true
  }

  if (!question.required) {
    return true
  }

  if (question.kind === "multi_select") {
    return Array.isArray(value) && value.length > 0
  }

  return typeof value === "string" && value.trim().length > 0
}

export function serializeRuntimePromptResponse(
  prompt: RuntimeQuestionPrompt,
  answers: Record<string, string | string[]>,
  customAnswers: Record<string, string>
): string {
  const lines: string[] = []

  for (const question of prompt.questions) {
    const value = answers[question.id]
    const customValue = customAnswers[question.id]?.trim() ?? ""

    if (question.kind === "multi_select") {
      const selected = Array.isArray(value) ? value : []
      const parts = [...selected]
      if (customValue) {
        parts.push(customValue)
      }
      lines.push(`${question.label}: ${parts.length > 0 ? parts.join(", ") : "No response"}`)
      continue
    }

    const selectedText =
      typeof value === "string" && value.trim().length > 0 ? value.trim() : ""
    const text =
      question.kind === "text"
        ? customValue
        : selectedText && customValue
          ? `${selectedText}, note: ${customValue}`
          : selectedText || customValue

    lines.push(`${question.label}: ${text || "No response"}`)
  }

  return lines.join("\n")
}

export function createRuntimePromptResponse(
  prompt: RuntimeQuestionPrompt,
  answers: Record<string, string | string[]>,
  customAnswers: Record<string, string>
): RuntimeQuestionPromptResponse {
  return {
    kind: "question",
    promptId: prompt.id,
    answers,
    customAnswers,
    text: serializeRuntimePromptResponse(prompt, answers, customAnswers),
  }
}

export function createRuntimeApprovalResponse(
  prompt: RuntimeApprovalPrompt,
  decision: "approve" | "deny"
): RuntimeApprovalPromptResponse {
  const actionLabel = prompt.approval.kind === "fileChange" ? "code changes" : "command execution"

  return {
    kind: "approval",
    promptId: prompt.id,
    decision,
    text: `${decision === "approve" ? "Approved" : "Denied"} ${actionLabel}.`,
  }
}

export function getApprovalPromptSummary(prompt: RuntimeApprovalPrompt): string {
  if (prompt.approval.kind === "fileChange") {
    const changeCount = prompt.approval.changes?.length ?? 0
    return changeCount > 0
      ? `Waiting for approval to apply ${changeCount === 1 ? "1 file change" : `${changeCount} file changes`}.`
      : "Waiting for approval to apply code changes."
  }

  const command = prompt.approval.command?.trim()
  return command
    ? `Waiting for approval to run ${command}.`
    : "Waiting for approval to run a command."
}

export function createActiveRuntimePromptState(prompt: RuntimePrompt): RuntimePromptState {
  const now = Date.now()

  return {
    prompt,
    status: "active",
    createdAt: now,
    updatedAt: now,
  }
}

export function normalizeRuntimePrompt(prompt: RuntimePrompt | null | undefined): RuntimePrompt | null {
  if (!prompt || !prompt.id || !prompt.title) {
    return null
  }

  if (prompt.kind === "approval") {
    return {
      ...prompt,
      body: prompt.body ?? undefined,
      approval: {
        ...prompt.approval,
        requestId: prompt.approval.requestId ?? undefined,
        itemId: prompt.approval.itemId ?? undefined,
        command: prompt.approval.command ?? undefined,
        commandSegments: prompt.approval.commandSegments ?? undefined,
        cwd: prompt.approval.cwd ?? undefined,
        reason: prompt.approval.reason ?? undefined,
        grantRoot: prompt.approval.grantRoot ?? undefined,
        commandActions: prompt.approval.commandActions ?? undefined,
        changes: prompt.approval.changes?.map((change) => ({
          ...change,
          content: change.content ?? undefined,
          diff: change.diff ?? undefined,
        })),
      },
    }
  }

  if (!Array.isArray(prompt.questions)) {
    return null
  }

  return {
    ...prompt,
    body: prompt.body ?? undefined,
    questions: prompt.questions.map((question) => ({
      ...question,
      description: question.description ?? undefined,
      allowOther: question.allowOther ?? undefined,
      isSecret: question.isSecret ?? undefined,
      options: question.options?.map((option) => ({
        ...option,
        description: option.description ?? undefined,
      })),
    })),
  }
}
