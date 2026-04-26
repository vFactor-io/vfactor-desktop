import type {
  PermissionRequest,
  PermissionRuleset,
  ProviderListResponses,
  QuestionRequest,
} from "@opencode-ai/sdk/v2/client"
import type {
  HarnessId,
  RuntimeApprovalPrompt,
  RuntimeFileSearchResult,
  RuntimeModel,
  RuntimeModeKind,
  RuntimePrompt,
  RuntimePromptResponse,
  RuntimeQuestionPrompt,
} from "@/features/chat/types"

type OpenCodeProviderList = ProviderListResponses[200]

const OPEN_CODE_READ_PERMISSIONS = [
  "read",
  "glob",
  "grep",
  "list",
  "todoread",
  "question",
  "codesearch",
  "lsp",
] as const

const OPEN_CODE_WRITE_PERMISSIONS = [
  "edit",
  "bash",
  "task",
  "webfetch",
  "websearch",
  "external_directory",
  "todowrite",
  "doom_loop",
] as const

function formatOpenCodeVariantLabel(variantId: string): string {
  return variantId
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function getOpenCodeModelVariants(
  variants: Record<string, { disabled?: boolean } | undefined> | null | undefined
): RuntimeModel["modelVariants"] {
  return Object.entries(variants ?? {})
    .filter(([variantId, variant]) => variantId.trim().length > 0 && variant?.disabled !== true)
    .map(([variantId]) => ({
      id: variantId,
      label: formatOpenCodeVariantLabel(variantId),
    }))
}

function createPermissionRules(
  action: "allow" | "ask",
  permissions: readonly string[]
): PermissionRuleset {
  return permissions.map((permission) => ({
    permission,
    pattern: "*",
    action,
  }))
}

export function getOpenCodePermissionRuleset(
  runtimeMode: RuntimeModeKind
): PermissionRuleset {
  switch (runtimeMode) {
    case "approval-required":
      return [
        ...createPermissionRules("allow", OPEN_CODE_READ_PERMISSIONS),
        ...createPermissionRules("ask", OPEN_CODE_WRITE_PERMISSIONS),
      ]
    case "auto-accept-edits":
      return [
        ...createPermissionRules("allow", [
          ...OPEN_CODE_READ_PERMISSIONS,
          "edit",
          "todowrite",
        ]),
        ...createPermissionRules("ask", [
          "bash",
          "task",
          "webfetch",
          "websearch",
          "external_directory",
          "doom_loop",
        ]),
      ]
    case "full-access":
    default:
      return [
        ...createPermissionRules("allow", [
          ...OPEN_CODE_READ_PERMISSIONS,
          ...OPEN_CODE_WRITE_PERMISSIONS,
        ]),
      ]
  }
}

export function flattenOpenCodeModels(
  response: OpenCodeProviderList
): RuntimeModel[] {
  const connectedProviders = new Set(response.connected)
  const defaultModelsByProvider = response.default ?? {}
  const models: RuntimeModel[] = []

  for (const provider of response.all ?? []) {
    if (!connectedProviders.has(provider.id)) {
      continue
    }

    for (const model of Object.values(provider.models ?? {})) {
      const modelId = `${provider.id}/${model.id}`
      const modelVariants = getOpenCodeModelVariants(model.variants)
      models.push({
        id: modelId,
        displayName: model.name,
        providerName: provider.name,
        isDefault: defaultModelsByProvider[provider.id] === model.id,
        supportedReasoningEfforts: [],
        defaultReasoningEffort: null,
        defaultModelVariant: null,
        modelVariants,
        supportsFastMode: false,
      })
    }
  }

  return Array.from(new Map(models.map((model) => [model.id, model])).values()).sort(
    (left, right) => {
      if (left.isDefault !== right.isDefault) {
        return left.isDefault ? -1 : 1
      }

      return left.displayName.localeCompare(right.displayName)
    }
  )
}

export function parseOpenCodeModelId(
  modelId: string | null | undefined
): { providerID: string; modelID: string } | null {
  const normalized = modelId?.trim() ?? ""
  if (!normalized) {
    return null
  }

  const slashIndex = normalized.indexOf("/")
  if (slashIndex <= 0 || slashIndex === normalized.length - 1) {
    return null
  }

  return {
    providerID: normalized.slice(0, slashIndex),
    modelID: normalized.slice(slashIndex + 1),
  }
}

export function mapOpenCodeSearchResults(
  paths: string[]
): RuntimeFileSearchResult[] {
  return paths.map((path) => ({
    path,
    type: "file",
  }))
}

function buildPermissionReason(request: PermissionRequest): string {
  const patterns = request.patterns.filter((value) => value.trim().length > 0)

  if (patterns.length === 0) {
    return `OpenCode needs approval to use ${request.permission}.`
  }

  return `OpenCode needs approval to use ${request.permission} on ${patterns.join(", ")}.`
}

export function buildOpenCodeApprovalPrompt(
  request: PermissionRequest,
  projectPath: string
): RuntimeApprovalPrompt {
  const normalizedPermission = request.permission.toLowerCase()
  const isEditRequest = normalizedPermission === "edit"

  return {
    id: `opencode-approval:${request.id}`,
    kind: "approval",
    title: isEditRequest ? "Approve file changes" : "Approve tool action",
    body: buildPermissionReason(request),
    approval: {
      kind: isEditRequest ? "fileChange" : "commandExecution",
      callId: request.tool?.callID ?? request.id,
      turnId: request.tool?.messageID ?? request.id,
      conversationId: request.sessionID,
      requestId: request.id,
      itemId: request.tool?.messageID,
      changes: isEditRequest
        ? request.patterns.map((path) => ({
            path,
            type: "change" as const,
          }))
        : undefined,
      command: isEditRequest ? undefined : request.permission,
      commandSegments: isEditRequest ? undefined : request.patterns,
      cwd: projectPath,
      reason: buildPermissionReason(request),
    },
  }
}

export function buildOpenCodeQuestionPrompt(request: QuestionRequest): RuntimeQuestionPrompt {
  return {
    id: `opencode-question:${request.id}`,
    kind: "question",
    title: "OpenCode needs input",
    body: "Answer the requested question to continue the OpenCode task.",
    questions: request.questions.map((question, index) => ({
      id: `question-${index}`,
      label: question.header,
      description: question.question,
      kind: question.multiple ? "multi_select" : "single_select",
      options: question.options.map((option) => ({
        id: option.label,
        label: option.label,
        description: option.description,
      })),
      allowOther: false,
      required: true,
    })),
  }
}

export function mapOpenCodeQuestionResponse(
  prompt: RuntimeQuestionPrompt,
  response: Extract<RuntimePromptResponse, { kind: "question" }>
): string[][] {
  return prompt.questions.map((question) => {
    const rawAnswer = response.answers[question.id]
    if (Array.isArray(rawAnswer)) {
      return rawAnswer
    }

    if (typeof rawAnswer === "string" && rawAnswer.trim().length > 0) {
      return [rawAnswer]
    }

    return []
  })
}

export function isOpenCodePromptForHarness(
  prompt: RuntimePrompt,
  harnessId: HarnessId
): boolean {
  return harnessId === "opencode" && prompt.id.startsWith("opencode-")
}
