import { randomUUID } from "node:crypto"
import {
  query,
  type CanUseTool,
  type ElicitationRequest,
  type ElicitationResult,
  type ModelInfo,
  type Options as ClaudeOptions,
  type PermissionMode,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
  type SlashCommand as ClaudeSlashCommand,
} from "@anthropic-ai/claude-agent-sdk"
import {
  DEFAULT_RUNTIME_MODE,
  type HarnessPromptInput,
  type HarnessTurnInput,
  type HarnessTurnResult,
  type RuntimeAgent,
  type RuntimeCommand,
  type RuntimeFileSearchResult,
  type RuntimeMessagePart,
  type RuntimeModel,
  type RuntimeModeKind,
  type RuntimePrompt,
  type RuntimePromptQuestion,
  type RuntimePromptResponse,
  type RuntimeSession,
} from "@/features/chat/types"
import type { RuntimeProviderAdapter, RuntimeProviderContext } from "./providerTypes"
import type { ProviderSettingsService } from "./providerSettings"
import { captureRuntimeError } from "./runtimeTelemetry"

const CLAUDE_MODEL_CACHE_TTL_MS = 5 * 60 * 1000
const CLAUDE_COMMAND_CACHE_TTL_MS = 5 * 60 * 1000

const KNOWN_CLAUDE_MODELS: RuntimeModel[] = [
  {
    id: "claude-opus-4-6",
    displayName: "Claude Opus 4.6",
    isDefault: false,
    supportedReasoningEfforts: ["low", "medium", "high", "max"],
    defaultReasoningEffort: "high",
    supportsFastMode: true,
  },
  {
    id: "claude-sonnet-4-6",
    displayName: "Claude Sonnet 4.6",
    isDefault: true,
    supportedReasoningEfforts: ["low", "medium", "high", "max"],
    defaultReasoningEffort: "high",
  },
  {
    id: "claude-haiku-4-5",
    displayName: "Claude Haiku 4.5",
    isDefault: false,
    supportedReasoningEfforts: [],
  },
]

const KNOWN_CLAUDE_MODELS_BY_ID = new Map(
  KNOWN_CLAUDE_MODELS.map((model) => [model.id, model] as const)
)

const CLAUDE_ALIAS_TO_VERSIONED_MODEL_ID: Record<string, string> = {
  default: "claude-sonnet-4-6",
  opus: "claude-opus-4-6",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5",
}

function sanitizeClaudeModelToken(value: string): string {
  return value
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\[[0-9;]*m\]/g, "")
    .trim()
}

function sanitizeClaudeCommandToken(value: string): string {
  return sanitizeClaudeModelToken(value).replace(/^\/+/, "").trim()
}

function splitLaunchArgs(value: string): string[] {
  const tokens: string[] = []
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(value)) != null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "")
  }

  return tokens.filter((token) => token.length > 0)
}

function parseClaudeExtraArgs(launchArgs: string): Record<string, string | null> | undefined {
  const tokens = splitLaunchArgs(launchArgs)
  if (tokens.length === 0) {
    return undefined
  }

  const extraArgs: Record<string, string | null> = {}
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token.startsWith("--")) {
      continue
    }

    const normalized = token.slice(2)
    const equalsIndex = normalized.indexOf("=")
    if (equalsIndex >= 0) {
      extraArgs[normalized.slice(0, equalsIndex)] = normalized.slice(equalsIndex + 1)
      continue
    }

    const nextToken = tokens[index + 1]
    if (nextToken && !nextToken.startsWith("--")) {
      extraArgs[normalized] = nextToken
      index += 1
      continue
    }

    extraArgs[normalized] = null
  }

  return Object.keys(extraArgs).length > 0 ? extraArgs : undefined
}

interface ClaudePersistedState {
  version: 1
  claudeSessionId?: string
  projectPath: string
  model?: string | null
  permissionMode?: PermissionMode
  fastMode?: boolean
}

interface PendingClaudeApproval {
  prompt: RuntimePrompt
  resolve: (result: PermissionResult) => void
}

interface PendingClaudeQuestion {
  prompt: RuntimePrompt
  resolve: (result: ElicitationResult) => void
}

interface PendingClaudeTurn {
  turnId: string
  assistantMessageId: string
  textPartId: string
  text: string
  resolve: (result: HarnessTurnResult) => void
  reject: (error: Error) => void
}

interface ClaudeSessionState {
  session: RuntimeSession
  projectPath: string
  claudeSessionId?: string
  model?: string | null
  permissionMode: PermissionMode
  fastMode: boolean
  promptQueue: AsyncMessageQueue | null
  query: Query | null
  pendingApproval: PendingClaudeApproval | null
  pendingQuestion: PendingClaudeQuestion | null
  pendingTurn: PendingClaudeTurn | null
}

class AsyncMessageQueue implements AsyncIterable<SDKUserMessage> {
  private closed = false
  private values: SDKUserMessage[] = []
  private resolvers: Array<(result: IteratorResult<SDKUserMessage>) => void> = []

  push(value: SDKUserMessage): void {
    if (this.closed) {
      throw new Error("Claude message queue is closed")
    }

    const resolver = this.resolvers.shift()
    if (resolver) {
      resolver({ done: false, value })
      return
    }

    this.values.push(value)
  }

  close(): void {
    this.closed = true
    while (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift()
      resolver?.({ done: true, value: undefined })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: async () => {
        const value = this.values.shift()
        if (value) {
          return { done: false, value }
        }

        if (this.closed) {
          return { done: true, value: undefined }
        }

        return new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
          this.resolvers.push(resolve)
        })
      },
    }
  }
}

function createAssistantMessage(
  sessionId: string,
  messageId: string,
  partId: string,
  text: string,
  turnId?: string
): HarnessTurnResult["messages"] {
  const parts: RuntimeMessagePart[] = [
    {
      id: partId,
      type: "text",
      text,
    },
  ]

  return [
    {
      info: {
        id: messageId,
        sessionId,
        role: "assistant",
        createdAt: Date.now(),
        finishReason: "end_turn",
        turnId,
      },
      parts,
    },
  ]
}

function extractAssistantText(content: unknown): string {
  if (!Array.isArray(content)) {
    return ""
  }

  return content
    .flatMap((block) => {
      if (!block || typeof block !== "object") {
        return []
      }

      if ("type" in block && block.type === "text" && "text" in block && typeof block.text === "string") {
        return [block.text]
      }

      return []
    })
    .join("")
}

function mapClaudePermissionMode(
  collaborationMode: HarnessTurnInput["collaborationMode"],
  runtimeMode: RuntimeModeKind
): PermissionMode {
  if (collaborationMode === "plan") {
    return "plan"
  }

  switch (runtimeMode) {
    case "auto-accept-edits":
      return "acceptEdits"
    case "full-access":
      return "bypassPermissions"
    case "approval-required":
    default:
      return "default"
  }
}

function getPromptQuestionKind(definition: Record<string, unknown>): RuntimePromptQuestion["kind"] {
  if (Array.isArray(definition.enum)) {
    return "single_select"
  }

  if (definition.type === "array") {
    return "multi_select"
  }

  return "text"
}

function mapElicitationSchemaToQuestions(schema: Record<string, unknown> | undefined): RuntimePromptQuestion[] {
  if (!schema || typeof schema !== "object") {
    return []
  }

  const properties =
    "properties" in schema && schema.properties && typeof schema.properties === "object"
      ? (schema.properties as Record<string, Record<string, unknown>>)
      : {}
  const required = Array.isArray(schema.required) ? new Set(schema.required) : new Set<unknown>()

  return Object.entries(properties).map(([id, definition]) => {
    const options = Array.isArray(definition.enum)
      ? definition.enum
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => ({
            id: `${id}:${entry}`,
            label: entry,
          }))
      : undefined

    return {
      id,
      label:
        (typeof definition.title === "string" && definition.title.trim()) ||
        (typeof definition.description === "string" && definition.description.trim()) ||
        id,
      description:
        typeof definition.description === "string" && definition.description.trim().length > 0
          ? definition.description
          : undefined,
      kind: getPromptQuestionKind(definition),
      options,
      required: required.has(id),
    }
  })
}

function buildElicitationContent(
  response: Extract<RuntimePromptResponse, { kind: "question" }>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(response.answers).map(([key, value]) => [key, value])
  )
}

function buildClaudeApprovalPrompt(
  session: ClaudeSessionState,
  requestId: string,
  toolName: string,
  input: Record<string, unknown>,
  options: {
    title?: string
    description?: string
    decisionReason?: string
    blockedPath?: string
    suggestions?: PermissionUpdate[]
  }
): RuntimePrompt {
  const normalizedTool = toolName.toLowerCase()
  const isFileChangeTool =
    normalizedTool === "edit" || normalizedTool === "write" || normalizedTool === "multiedit"
  const command =
    typeof input.command === "string"
      ? input.command
      : typeof input.cmd === "string"
        ? input.cmd
        : ""
  const filePath =
    typeof input.file_path === "string"
      ? input.file_path
      : typeof input.path === "string"
        ? input.path
        : typeof options.blockedPath === "string"
          ? options.blockedPath
          : ""

  return {
    id: `claude:${requestId}`,
    kind: "approval",
    title: options.title ?? `Approve ${toolName}`,
    body: options.description ?? options.decisionReason,
    approval: {
      kind: isFileChangeTool ? "fileChange" : "commandExecution",
      callId: requestId,
      turnId: session.pendingTurn?.assistantMessageId ?? requestId,
      conversationId: session.session.remoteId ?? session.session.id,
      requestId,
      changes: isFileChangeTool && filePath
        ? [
            {
              path: filePath,
              type: normalizedTool === "write" ? "add" : "update",
            },
          ]
        : undefined,
      command: command || undefined,
      commandSegments: command ? [command] : undefined,
      cwd: session.projectPath,
      reason: options.decisionReason,
      commandActions: options.suggestions,
    },
  }
}

function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function parseClaudeInitializationCommands(
  commands: ReadonlyArray<ClaudeSlashCommand> | undefined
): RuntimeCommand[] {
  return dedupeClaudeSlashCommands(
    (commands ?? []).flatMap((command) => {
      const name = sanitizeClaudeCommandToken(command.name)
      if (!name) {
        return []
      }

      const description = sanitizeClaudeCommandToken(command.description)
      const inputHint = sanitizeClaudeCommandToken(command.argumentHint)

      return [{
        name,
        description,
        kind: "builtin",
        ...(inputHint ? { inputHint } : {}),
      } satisfies RuntimeCommand]
    })
  )
}

function dedupeClaudeSlashCommands(commands: ReadonlyArray<RuntimeCommand>): RuntimeCommand[] {
  const commandsByName = new Map<string, RuntimeCommand>()

  for (const command of commands) {
    const name = sanitizeClaudeCommandToken(command.name)
    if (!name) {
      continue
    }

    const key = name.toLowerCase()
    const existing = commandsByName.get(key)
    if (!existing) {
      commandsByName.set(key, {
        ...command,
        name,
        description: sanitizeClaudeCommandToken(command.description),
        inputHint: sanitizeClaudeCommandToken(command.inputHint ?? ""),
      })
      continue
    }

    commandsByName.set(key, {
      ...existing,
      ...(existing.description ? {} : command.description ? { description: command.description } : {}),
      ...(existing.inputHint ? {} : command.inputHint ? { inputHint: command.inputHint } : {}),
    })
  }

  return [...commandsByName.values()].sort((left, right) => left.name.localeCompare(right.name))
}

function normalizeClaudeModelId(modelId: string): string {
  const trimmedModelId = sanitizeClaudeModelToken(modelId)
  if (!trimmedModelId) {
    return trimmedModelId
  }

  return CLAUDE_ALIAS_TO_VERSIONED_MODEL_ID[trimmedModelId] ?? trimmedModelId
}

function isVersionedClaudeModelId(modelId: string): boolean {
  return /^claude-[a-z0-9]+-\d+(?:-\d+)*$/i.test(modelId)
}

function getClaudeDefaultModelId(models: RuntimeModel[]): string | null {
  const preferredDefault =
    models.find((model) => model.id === "claude-sonnet-4-6") ??
    models.find((model) => model.isDefault) ??
    models[0]

  return preferredDefault?.id ?? null
}

function normalizeClaudeSupportedEfforts(model: ModelInfo): string[] {
  return Array.from(new Set(model.supportedEffortLevels ?? []))
}

function mapClaudeModelInfoToRuntimeModel(
  model: ModelInfo,
  defaultModelId: string | null
): RuntimeModel {
  const normalizedId = normalizeClaudeModelId(model.value)
  const supportedReasoningEfforts = normalizeClaudeSupportedEfforts(model)
  const knownModel = KNOWN_CLAUDE_MODELS_BY_ID.get(normalizedId)

  return {
    id: normalizedId,
    displayName: knownModel?.displayName ?? sanitizeClaudeModelToken(model.displayName),
    isDefault: normalizedId === defaultModelId,
    supportedReasoningEfforts: knownModel?.supportedReasoningEfforts ?? supportedReasoningEfforts,
    defaultReasoningEffort:
      knownModel?.defaultReasoningEffort ??
      (supportedReasoningEfforts.includes("high") ? "high" : supportedReasoningEfforts[0] ?? null),
    supportsFastMode: knownModel?.supportsFastMode ?? (model.supportsFastMode === true),
  }
}

export class ClaudeRuntimeProvider implements RuntimeProviderAdapter {
  readonly harnessId = "claude-code" as const

  private sessions = new Map<string, ClaudeSessionState>()
  private modelCache: { models: RuntimeModel[]; fetchedAt: number } | null = null
  private modelRequest: Promise<RuntimeModel[]> | null = null
  private commandCache = new Map<string, { commands: RuntimeCommand[]; fetchedAt: number }>()
  private commandRequests = new Map<string, Promise<RuntimeCommand[]>>()

  constructor(
    private readonly context: RuntimeProviderContext,
    private readonly providerSettingsService?: ProviderSettingsService
  ) {}

  async createSession(
    projectPath: string,
    options?: { runtimeMode?: RuntimeModeKind }
  ): Promise<RuntimeSession> {
    const remoteId = `claude-${randomUUID()}`
    const session: RuntimeSession = {
      id: remoteId,
      remoteId,
      harnessId: this.harnessId,
      runtimeMode: options?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
      projectPath,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    const state: ClaudeSessionState = {
      session,
      projectPath,
      claudeSessionId: undefined,
      model: null,
      permissionMode: mapClaudePermissionMode(
        undefined,
        options?.runtimeMode ?? DEFAULT_RUNTIME_MODE
      ),
      fastMode: false,
      promptQueue: null,
      query: null,
      pendingApproval: null,
      pendingQuestion: null,
      pendingTurn: null,
    }

    this.sessions.set(remoteId, state)
    await this.persistState(state)

    return session
  }

  async listAgents(): Promise<RuntimeAgent[]> {
    return []
  }

  async listCommands(projectPath?: string): Promise<RuntimeCommand[]> {
    const cacheKey = this.getCommandCacheKey(projectPath)
    const cached = this.commandCache.get(cacheKey)
    if (cached && Date.now() - cached.fetchedAt < CLAUDE_COMMAND_CACHE_TTL_MS) {
      return cached.commands
    }

    const inFlight = this.commandRequests.get(cacheKey)
    if (inFlight) {
      return inFlight
    }

    const commandRequest = this.loadCommandsFromSdk(projectPath)
    this.commandRequests.set(cacheKey, commandRequest)

    try {
      const commands = await commandRequest
      this.commandCache.set(cacheKey, {
        commands,
        fetchedAt: Date.now(),
      })
      return commands
    } finally {
      this.commandRequests.delete(cacheKey)
    }
  }

  async listModels(): Promise<RuntimeModel[]> {
    if (this.modelCache && Date.now() - this.modelCache.fetchedAt < CLAUDE_MODEL_CACHE_TTL_MS) {
      return this.modelCache.models
    }

    if (this.modelRequest) {
      return this.modelRequest
    }

    this.modelRequest = this.loadModelsFromSdk()

    try {
      const models = await this.modelRequest
      this.modelCache = {
        models,
        fetchedAt: Date.now(),
      }
      return models
    } finally {
      this.modelRequest = null
    }
  }

  async searchFiles(_query: string, _directory?: string): Promise<RuntimeFileSearchResult[]> {
    return []
  }

  async sendTurn(input: HarnessTurnInput): Promise<HarnessTurnResult> {
    let state: ClaudeSessionState
    try {
      state = await this.ensureSessionState(input.session)
      await this.ensureQuery(state, input)
    } catch (error) {
      captureRuntimeError("provider_operation_failed", error, {
        harnessId: this.harnessId,
        phase: "claude.session_ready",
        session: input.session,
        model: input.model,
        runtimeMode: input.runtimeMode,
      })
      throw error
    }

    if (!state.promptQueue || !state.query) {
      throw new Error("Claude session did not initialize correctly.")
    }

    if (state.pendingTurn) {
      throw new Error("Claude already has an active turn for this session.")
    }

    state.model = input.model ?? state.model ?? null
    state.permissionMode = mapClaudePermissionMode(
      input.collaborationMode,
      input.runtimeMode ?? input.session.runtimeMode ?? DEFAULT_RUNTIME_MODE
    )
    state.fastMode =
      input.fastMode === true &&
      state.model != null &&
      KNOWN_CLAUDE_MODELS_BY_ID.get(state.model)?.supportsFastMode === true
    await this.persistState(state)

    const turnDeferred = createDeferred<HarnessTurnResult>()
    state.pendingTurn = {
      turnId: input.turnId,
      assistantMessageId: `claude:${randomUUID()}:message`,
      textPartId: `claude:${randomUUID()}:text`,
      text: "",
      resolve: turnDeferred.resolve,
      reject: turnDeferred.reject,
    }

    try {
      state.promptQueue.push({
        type: "user",
        message: {
          role: "user",
          content: input.text,
        },
        parent_tool_use_id: null,
      })
    } catch (error) {
      state.pendingTurn = null
      captureRuntimeError("provider_operation_failed", error, {
        harnessId: this.harnessId,
        phase: "claude.message_send",
        session: input.session,
        model: state.model,
        runtimeMode: input.runtimeMode,
      })
      throw error
    }

    return turnDeferred.promise
  }

  async answerPrompt(input: HarnessPromptInput): Promise<HarnessTurnResult> {
    const remoteId = input.session.remoteId ?? input.session.id
    const state = await this.ensureSessionState(input.session)

    if (state.pendingApproval?.prompt.id === input.response.promptId) {
      if (input.response.kind !== "approval") {
        throw new Error("Claude approval prompts require approval responses.")
      }

      const pendingApproval = state.pendingApproval
      state.pendingApproval = null
      pendingApproval.resolve(
        input.response.decision === "approve"
          ? { behavior: "allow" }
          : { behavior: "deny", message: "Denied by user." }
      )
      this.context.emitUpdate(remoteId, this.harnessId, { prompt: null })
      return {}
    }

    if (state.pendingQuestion?.prompt.id === input.response.promptId) {
      if (input.response.kind !== "question") {
        throw new Error("Claude question prompts require question responses.")
      }

      const pendingQuestion = state.pendingQuestion
      state.pendingQuestion = null
      pendingQuestion.resolve({
        action: "accept",
        content: buildElicitationContent(input.response),
      })
      this.context.emitUpdate(remoteId, this.harnessId, { prompt: null })
      return {}
    }

    return {}
  }

  async interruptTurn(session: RuntimeSession): Promise<void> {
    const state = await this.ensureSessionState(session)
    await state.query?.interrupt()
  }

  getActiveTurnCount(): number {
    return Array.from(this.sessions.values()).filter((session) => session.pendingTurn).length
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      session.promptQueue?.close()
      session.query?.close()
    }
    this.sessions.clear()
  }

  private async ensureSessionState(session: RuntimeSession): Promise<ClaudeSessionState> {
    const remoteId = session.remoteId ?? session.id
    const existing = this.sessions.get(remoteId)
    if (existing) {
      return existing
    }

    const persisted = await this.context.persistence.load(remoteId)
    if (!persisted || persisted.harnessId !== this.harnessId) {
      throw new Error(`Unknown Claude session: ${remoteId}`)
    }

    const persistedState = persisted.state as ClaudePersistedState
    const restored: ClaudeSessionState = {
      session: {
        ...session,
        remoteId,
        projectPath: persisted.projectPath,
      },
      projectPath: persisted.projectPath,
      claudeSessionId: persistedState.claudeSessionId,
      model: persistedState.model ?? null,
      permissionMode: persistedState.permissionMode ?? "default",
      fastMode: persistedState.fastMode === true,
      promptQueue: null,
      query: null,
      pendingApproval: null,
      pendingQuestion: null,
      pendingTurn: null,
    }
    this.sessions.set(remoteId, restored)
    return restored
  }

  private async getClaudeExecutablePath(): Promise<string | undefined> {
    const settings = await this.providerSettingsService?.getProviderSettings("claude-code")
    return settings?.binaryPath.trim() || process.env.NUCLEUS_CLAUDE_PATH?.trim() || undefined
  }

  private async getClaudeExtraArgs(): Promise<Record<string, string | null> | undefined> {
    const settings = await this.providerSettingsService?.getProviderSettings("claude-code")
    return parseClaudeExtraArgs(settings?.launchArgs ?? "")
  }

  private async ensureQuery(state: ClaudeSessionState, input: HarnessTurnInput): Promise<void> {
    const requestedModel = input.model ?? state.model ?? null
    const requestedFastMode =
      input.fastMode === true &&
      requestedModel != null &&
      KNOWN_CLAUDE_MODELS_BY_ID.get(requestedModel)?.supportsFastMode === true

    if (state.query && state.promptQueue) {
      if (input.model && input.model !== state.model) {
        await state.query.setModel(input.model)
        state.model = input.model
      }
      const nextPermissionMode = mapClaudePermissionMode(
        input.collaborationMode,
        input.runtimeMode ?? input.session.runtimeMode ?? DEFAULT_RUNTIME_MODE
      )
      if (nextPermissionMode !== state.permissionMode) {
        await state.query.setPermissionMode(nextPermissionMode)
        state.permissionMode = nextPermissionMode
      }
      if (requestedFastMode !== state.fastMode) {
        await state.query.applyFlagSettings({ fastMode: requestedFastMode })
        state.fastMode = requestedFastMode
      }
      await this.persistState(state)
      return
    }

    const promptQueue = new AsyncMessageQueue()
    const canUseTool = this.createPermissionHandler(state)
    const onElicitation = this.createElicitationHandler(state)
    const options: ClaudeOptions = {
      cwd: state.projectPath,
      model: requestedModel ?? undefined,
      resume: state.claudeSessionId,
      permissionMode: mapClaudePermissionMode(
        input.collaborationMode,
        input.runtimeMode ?? input.session.runtimeMode ?? DEFAULT_RUNTIME_MODE
      ),
      persistSession: true,
      includePartialMessages: true,
      settingSources: ["user", "project", "local"],
      ...(requestedFastMode ? { settings: { fastMode: true } } : {}),
      extraArgs: await this.getClaudeExtraArgs(),
      canUseTool,
      onElicitation,
      pathToClaudeCodeExecutable: await this.getClaudeExecutablePath(),
      stderr: (data) => {
        const trimmed = data.trim()
        if (trimmed) {
          console.warn("[claude]", trimmed)
        }
      },
    }

    const activeQuery = query({
      prompt: promptQueue,
      options,
    })

    state.promptQueue = promptQueue
    state.query = activeQuery
    state.permissionMode = options.permissionMode ?? "default"
    state.model = options.model ?? null
    state.fastMode = requestedFastMode
    void this.consumeQuery(state, activeQuery)
  }

  private createPermissionHandler(state: ClaudeSessionState): CanUseTool {
    return async (toolName, input, options) => {
      const remoteId = state.session.remoteId ?? state.session.id
      const requestId = randomUUID()
      const prompt = buildClaudeApprovalPrompt(state, requestId, toolName, input, options)
      const deferred = createDeferred<PermissionResult>()
      state.pendingApproval = {
        prompt,
        resolve: deferred.resolve,
      }
      this.context.emitUpdate(remoteId, this.harnessId, { prompt })
      return deferred.promise
    }
  }

  private createElicitationHandler(state: ClaudeSessionState) {
    return async (request: ElicitationRequest): Promise<ElicitationResult> => {
      const remoteId = state.session.remoteId ?? state.session.id
      const prompt: RuntimePrompt = {
        id: `claude-elicitation:${request.elicitationId ?? randomUUID()}`,
        kind: "question",
        title: request.title ?? request.displayName ?? "Claude needs input",
        body: request.description ?? request.message,
        questions: mapElicitationSchemaToQuestions(request.requestedSchema),
      }

      const deferred = createDeferred<ElicitationResult>()
      state.pendingQuestion = {
        prompt,
        resolve: deferred.resolve,
      }
      this.context.emitUpdate(remoteId, this.harnessId, { prompt })
      return deferred.promise
    }
  }

  private async consumeQuery(state: ClaudeSessionState, activeQuery: Query): Promise<void> {
    const remoteId = state.session.remoteId ?? state.session.id
    let completedByResult = false

    try {
      for await (const message of activeQuery) {
        await this.handleSdkMessage(state, message)
        if (message.type === "result") {
          completedByResult = true
        }
      }
    } catch (error) {
      captureRuntimeError("provider_operation_failed", error, {
        harnessId: this.harnessId,
        phase: "claude.message_send",
        session: state.session,
        model: state.model,
      })
      state.pendingTurn?.reject(
        error instanceof Error ? error : new Error(String(error))
      )
      state.pendingTurn = null
    } finally {
      if (!completedByResult) {
        const pendingTurn = state.pendingTurn
        state.pendingTurn = null

        if (pendingTurn) {
          pendingTurn.resolve({
            messages: pendingTurn.text
              ? createAssistantMessage(
                  remoteId,
                  pendingTurn.assistantMessageId,
                  pendingTurn.textPartId,
                  pendingTurn.text,
                  pendingTurn.turnId
                )
              : [],
          })
        }
      }

      state.query = null
      state.promptQueue?.close()
      state.promptQueue = null
    }

    await this.context.persistence.save(remoteId, {
      harnessId: this.harnessId,
      projectPath: state.projectPath,
      state: {
        version: 1,
        claudeSessionId: state.claudeSessionId,
        projectPath: state.projectPath,
        model: state.model ?? null,
        permissionMode: state.permissionMode,
        fastMode: state.fastMode,
      } satisfies ClaudePersistedState,
      updatedAt: Date.now(),
    })
  }

  private async handleSdkMessage(state: ClaudeSessionState, message: SDKMessage): Promise<void> {
    const remoteId = state.session.remoteId ?? state.session.id

    if ("session_id" in message && typeof message.session_id === "string") {
      state.claudeSessionId = message.session_id
      await this.persistState(state)
    }

    if (message.type === "stream_event") {
      const turn = state.pendingTurn
      if (!turn) {
        return
      }

      const event = message.event as {
        type?: string
        delta?: { type?: string; text?: string }
      }
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        turn.text += event.delta.text ?? ""
        this.context.emitUpdate(remoteId, this.harnessId, {
          messages: createAssistantMessage(
            remoteId,
            turn.assistantMessageId,
            turn.textPartId,
            turn.text,
            turn.turnId
          ),
        })
      }
      return
    }

    if (message.type === "assistant") {
      const turn = state.pendingTurn
      if (!turn) {
        return
      }

      const nextText = extractAssistantText(message.message.content)
      if (nextText.length > 0) {
        turn.text = nextText
        this.context.emitUpdate(remoteId, this.harnessId, {
          messages: createAssistantMessage(
            remoteId,
            turn.assistantMessageId,
            turn.textPartId,
            turn.text,
            turn.turnId
          ),
        })
      }
      return
    }

    if (message.type === "result") {
      const turn = state.pendingTurn
      if (!turn) {
        return
      }

      state.pendingTurn = null
      if (message.subtype !== "success") {
        const reason = "errors" in message && Array.isArray(message.errors)
          ? message.errors.join(" ")
          : "Claude turn failed."
        const error = new Error(reason)
        captureRuntimeError("provider_operation_failed", error, {
          harnessId: this.harnessId,
          phase: "claude.message_send",
          session: state.session,
          model: state.model,
          extra: {
            result_subtype: message.subtype,
          },
        })
        turn.reject(error)
        return
      }

      const finalText = turn.text || ("result" in message && typeof message.result === "string"
        ? message.result
        : "")
      turn.resolve({
        messages: finalText
          ? createAssistantMessage(
              remoteId,
              turn.assistantMessageId,
              turn.textPartId,
              finalText,
              turn.turnId
            )
          : [],
      })
    }
  }

  private async persistState(state: ClaudeSessionState): Promise<void> {
    const remoteId = state.session.remoteId ?? state.session.id
    await this.context.persistence.save(remoteId, {
      harnessId: this.harnessId,
      projectPath: state.projectPath,
      state: {
        version: 1,
        claudeSessionId: state.claudeSessionId,
        projectPath: state.projectPath,
        model: state.model ?? null,
        permissionMode: state.permissionMode,
        fastMode: state.fastMode,
      } satisfies ClaudePersistedState,
      updatedAt: Date.now(),
    })
  }

  private async loadModelsFromSdk(): Promise<RuntimeModel[]> {
    const pathToClaudeCodeExecutable = await this.getClaudeExecutablePath()
    const probe = query({
      prompt: ".",
      options: {
        cwd: process.cwd(),
        persistSession: false,
        maxTurns: 0,
        settingSources: ["user", "project", "local"],
        pathToClaudeCodeExecutable,
        stderr: (data) => {
          const trimmed = data.trim()
          if (trimmed) {
            console.warn("[claude]", trimmed)
          }
        },
      },
    })

    try {
      const supportedModels = await probe.supportedModels()
      if (supportedModels.length === 0) {
        console.warn("[models][claude] sdk returned no models, using known fallback models")
        return KNOWN_CLAUDE_MODELS
      }

      const normalizedModels = supportedModels
        .map((model) => mapClaudeModelInfoToRuntimeModel(model, null))
        .filter((model) => isVersionedClaudeModelId(model.id))

      const dedupedModels = Array.from(
        new Map(normalizedModels.map((model) => [model.id, model])).values()
      )

      const resolvedModels = dedupedModels.length > 0 ? dedupedModels : KNOWN_CLAUDE_MODELS
      const defaultModelId = getClaudeDefaultModelId(resolvedModels)

      return resolvedModels
        .map((model) => ({
          ...model,
          isDefault: model.id === defaultModelId,
        }))
        .sort((left, right) => {
          if (left.isDefault !== right.isDefault) {
            return left.isDefault ? -1 : 1
          }

          return left.displayName.localeCompare(right.displayName)
        })
    } catch (error) {
      console.warn("[models][claude] Failed to load models from Claude SDK, using fallback list.", error)
      return KNOWN_CLAUDE_MODELS
    } finally {
      probe.close()
    }
  }

  private getCommandCacheKey(projectPath?: string): string {
    return projectPath?.trim() || process.cwd()
  }

  private async loadCommandsFromSdk(projectPath?: string): Promise<RuntimeCommand[]> {
    const cwd = projectPath?.trim() || process.cwd()
    const pathToClaudeCodeExecutable = await this.getClaudeExecutablePath()
    const probe = query({
      prompt: ".",
      options: {
        cwd,
        persistSession: false,
        maxTurns: 0,
        settingSources: ["user", "project", "local"],
        pathToClaudeCodeExecutable,
        stderr: (data) => {
          const trimmed = data.trim()
          if (trimmed) {
            console.warn("[claude]", trimmed)
          }
        },
      },
    })

    try {
      const initialization = await probe.initializationResult()
      const rawCommands = Array.isArray(initialization.commands) ? initialization.commands : []
      const parsedCommands = parseClaudeInitializationCommands(rawCommands)
      return parsedCommands
    } catch (error) {
      console.warn("[claude] Failed to load slash commands from Claude SDK.", error)
      return []
    } finally {
      probe.close()
    }
  }
}
