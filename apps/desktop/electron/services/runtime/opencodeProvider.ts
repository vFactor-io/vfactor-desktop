import { stat } from "node:fs/promises"
import path from "node:path"
import {
  createOpencodeClient,
  type Agent,
  type Command,
  type GlobalEvent,
  type Message,
  type Part,
  type ToolState,
  type OpencodeClient,
} from "@opencode-ai/sdk/v2/client"
import type {
  HarnessPromptInput,
  HarnessTurnInput,
  HarnessTurnResult,
  MessageWithParts,
  RuntimeAgent,
  RuntimeCommand,
  RuntimeFileSearchResult,
  RuntimeMessage,
  RuntimeMessagePart,
  RuntimeModel,
  RuntimeModeKind,
  RuntimePrompt,
  RuntimeSession,
  RuntimeToolPart,
  RuntimeToolState,
} from "@/features/chat/types"
import { getRemoteSessionId } from "@/features/chat/domain/runtimeSessions"
import type { OpenCodeServerService } from "../opencodeServer"
import type { RuntimeProviderAdapter, RuntimeProviderContext } from "./providerTypes"
import type { ProviderSettingsService } from "./providerSettings"
import {
  buildOpenCodeApprovalPrompt,
  buildOpenCodeQuestionPrompt,
  flattenOpenCodeModels,
  getOpenCodePermissionRuleset,
  mapOpenCodeQuestionResponse,
  parseOpenCodeModelId,
} from "./opencodeTransforms"
import { captureRuntimeError } from "./runtimeTelemetry"

const OPEN_CODE_MODEL_CACHE_TTL_MS = 5 * 60 * 1000
const OPEN_CODE_AGENT_CACHE_TTL_MS = 5 * 60 * 1000
const OPEN_CODE_COMMAND_CACHE_TTL_MS = 5 * 60 * 1000

type OpenCodeResponse<T> = {
  data?: T
  error?: unknown
}

type TrackedMessage = {
  info: Message
  partOrder: string[]
  partsById: Map<string, Part>
}

type OpenCodeSessionState = {
  session: RuntimeSession
  projectPath: string
  runtimeMode: RuntimeModeKind
  messageOrder: string[]
  messagesById: Map<string, TrackedMessage>
  pendingPrompts: Map<string, RuntimePrompt>
  activePrompt: RuntimePrompt | null
  activeTurn?: {
    resolve: (result: HarnessTurnResult) => void
    reject: (error: Error) => void
  }
  onUpdate?: (result: HarnessTurnResult) => void
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

function createProvisionalAssistantInfo(sessionId: string, messageId: string): Message {
  return {
    id: messageId,
    sessionID: sessionId,
    role: "assistant",
    time: {
      created: Date.now(),
    },
    parentID: `provisional:${messageId}`,
    modelID: "unknown",
    providerID: "opencode",
    mode: "build",
    agent: "build",
    path: {
      cwd: "",
      root: "",
    },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
  }
}

function assertOpenCodeData<T>(result: OpenCodeResponse<T>, context: string): T {
  if (result.error) {
    throw result.error instanceof Error ? result.error : new Error(String(result.error))
  }

  if (result.data == null) {
    throw new Error(`OpenCode returned no data for ${context}.`)
  }

  return result.data
}

function assertOpenCodeAccepted(result: OpenCodeResponse<void>, context: string): void {
  if (result.error) {
    throw result.error instanceof Error ? result.error : new Error(String(result.error))
  }
}

function mapToolStatus(status: ToolState["status"]): RuntimeToolState["status"] {
  switch (status) {
    case "pending":
      return "pending"
    case "running":
      return "running"
    case "error":
      return "error"
    case "completed":
    default:
      return "completed"
  }
}

function createAssistantMessage(
  sessionId: string,
  messageId: string,
  createdAt: number,
  parts: RuntimeMessagePart[],
  metadata?: Pick<RuntimeMessage, "itemType" | "finishReason">
): MessageWithParts {
  return {
    info: {
      id: messageId,
      sessionId,
      role: "assistant",
      createdAt,
      finishReason: metadata?.finishReason,
      itemType: metadata?.itemType,
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
  itemType: RuntimeMessage["itemType"] = "dynamicToolCall"
): MessageWithParts {
  return createAssistantMessage(
    sessionId,
    `${itemId}:message`,
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
    { itemType }
  )
}

function toToolOutput(state: ToolState): unknown {
  if (state.status === "completed") {
    return state.output
  }

  if (state.status === "error") {
    return undefined
  }

  return undefined
}

function toToolError(state: ToolState): unknown {
  return state.status === "error" ? state.error : undefined
}

function mapTrackedMessagesToRuntimeMessages(
  state: OpenCodeSessionState
): MessageWithParts[] {
  return state.messageOrder.flatMap((messageId) => {
    const trackedMessage = state.messagesById.get(messageId)
    if (!trackedMessage || trackedMessage.info.role !== "assistant") {
      return []
    }

    const parts = trackedMessage.partOrder
      .map((partId) => trackedMessage.partsById.get(partId))
      .filter((part): part is Part => Boolean(part))

    const runtimeMessages: MessageWithParts[] = []
    const text = parts
      .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text")
      .filter((part) => part.ignored !== true)
      .map((part) => part.text)
      .join("")
      .trim()

    if (text.length > 0) {
      runtimeMessages.push(
        createAssistantMessage(
          state.session.id,
          trackedMessage.info.id,
          trackedMessage.info.time.created,
          [
            {
              id: `${trackedMessage.info.id}:text`,
              type: "text",
              text,
            },
          ],
          {
            finishReason: trackedMessage.info.time.completed ? "end_turn" : undefined,
          }
        )
      )
    }

    for (const part of parts) {
      switch (part.type) {
        case "reasoning":
          runtimeMessages.push(
            createAssistantMessage(
              state.session.id,
              `${part.id}:message`,
              part.time.start,
              [
                {
                  id: part.id,
                  type: "text",
                  text: part.text,
                },
              ],
              {
                itemType: "reasoning",
              }
            )
          )
          break
        case "tool":
          runtimeMessages.push(
            createToolMessage(
              state.session.id,
              part.id,
              part.state.status === "pending"
                ? trackedMessage.info.time.created
                : part.state.time.start,
              part.tool,
              {
                status: mapToolStatus(part.state.status),
                title:
                  part.state.status === "running" || part.state.status === "completed"
                    ? part.state.title
                    : undefined,
                input: part.state.input,
                output: toToolOutput(part.state),
                error: toToolError(part.state),
              },
              "dynamicToolCall"
            )
          )
          break
        case "patch":
          runtimeMessages.push(
            createToolMessage(
              state.session.id,
              part.id,
              trackedMessage.info.time.created,
              "fileChange",
              {
                status: "completed",
                title: "Apply file changes",
                input: {
                  hash: part.hash,
                  files: part.files,
                },
                output: {
                  changes: part.files.map((file) => ({
                    path: file,
                    type: "change",
                  })),
                  hash: part.hash,
                },
              },
              "fileChange"
            )
          )
          break
        case "subtask":
          runtimeMessages.push(
            createAssistantMessage(
              state.session.id,
              `${part.id}:message`,
              trackedMessage.info.time.created,
              [
                {
                  id: `${part.id}:text`,
                  type: "text",
                  text: `Delegated to ${part.agent}: ${part.description}`,
                },
              ],
            )
          )
          break
        default:
          break
      }
    }

    return runtimeMessages
  })
}

function updateTrackedMessageInfo(
  state: OpenCodeSessionState,
  info: Message
): void {
  const existing = ensureTrackedMessage(state, info.id, info.sessionID)
  state.messagesById.set(info.id, {
    info,
    partOrder: existing.partOrder,
    partsById: existing.partsById,
  })
}

function ensureTrackedMessage(
  state: OpenCodeSessionState,
  messageId: string,
  sessionId: string
): TrackedMessage {
  const existing = state.messagesById.get(messageId)
  if (existing) {
    return existing
  }

  const trackedMessage: TrackedMessage = {
    info: createProvisionalAssistantInfo(sessionId, messageId),
    partOrder: [],
    partsById: new Map<string, Part>(),
  }
  state.messagesById.set(messageId, trackedMessage)
  state.messageOrder.push(messageId)
  return trackedMessage
}

function updateTrackedPart(
  state: OpenCodeSessionState,
  part: Part
): void {
  const trackedMessage = ensureTrackedMessage(state, part.messageID, part.sessionID)

  if (!trackedMessage.partsById.has(part.id)) {
    trackedMessage.partOrder.push(part.id)
  }

  trackedMessage.partsById.set(part.id, part)
}

function applyTrackedPartDelta(
  state: OpenCodeSessionState,
  payload: {
    sessionID: string
    messageID: string
    partID: string
    field: string
    delta: string
  }
): void {
  if (payload.field !== "text" || payload.delta.length === 0) {
    return
  }

  const trackedMessage = ensureTrackedMessage(state, payload.messageID, payload.sessionID)
  const existingPart = trackedMessage.partsById.get(payload.partID)

  if (existingPart && (existingPart.type === "text" || existingPart.type === "reasoning")) {
    trackedMessage.partsById.set(payload.partID, {
      ...existingPart,
      text: `${existingPart.text}${payload.delta}`,
    })
    return
  }

  if (!trackedMessage.partOrder.includes(payload.partID)) {
    trackedMessage.partOrder.push(payload.partID)
  }

  trackedMessage.partsById.set(payload.partID, {
    id: payload.partID,
    sessionID: payload.sessionID,
    messageID: payload.messageID,
    type: "text",
    text: payload.delta,
    synthetic: true,
    time: {
      start: Date.now(),
    },
  })
}

function removeTrackedPart(
  state: OpenCodeSessionState,
  messageId: string,
  partId: string
): void {
  const trackedMessage = state.messagesById.get(messageId)
  if (!trackedMessage) {
    return
  }

  trackedMessage.partsById.delete(partId)
  trackedMessage.partOrder = trackedMessage.partOrder.filter((candidate) => candidate !== partId)
}

async function resolveSearchResultType(
  projectPath: string,
  resultPath: string
): Promise<RuntimeFileSearchResult["type"]> {
  const absolutePath = path.isAbsolute(resultPath)
    ? resultPath
    : path.join(projectPath, resultPath)

  try {
    const entry = await stat(absolutePath)
    return entry.isDirectory() ? "directory" : "file"
  } catch {
    return "file"
  }
}

export class OpenCodeRuntimeProvider implements RuntimeProviderAdapter {
  readonly harnessId = "opencode" as const

  private client: OpencodeClient | null = null
  private clientBaseUrl: string | null = null
  private eventAbortController: AbortController | null = null
  private eventTask: Promise<void> | null = null
  private sessions = new Map<string, OpenCodeSessionState>()
  private modelCache: { models: RuntimeModel[]; fetchedAt: number } | null = null
  private modelRequest: Promise<RuntimeModel[]> | null = null
  private agentCache: { agents: RuntimeAgent[]; fetchedAt: number } | null = null
  private agentRequest: Promise<RuntimeAgent[]> | null = null
  private commandCache = new Map<string, { commands: RuntimeCommand[]; fetchedAt: number }>()
  private commandRequests = new Map<string, Promise<RuntimeCommand[]>>()
  private activeTurns = new Set<string>()

  constructor(
    private readonly context: RuntimeProviderContext,
    private readonly openCodeServerService: OpenCodeServerService,
    private readonly providerSettingsService?: ProviderSettingsService
  ) {}

  async createSession(
    projectPath: string,
    options?: { runtimeMode?: RuntimeModeKind }
  ): Promise<RuntimeSession> {
    const client = await this.getClient()
    const runtimeMode = options?.runtimeMode ?? "full-access"
    const session = assertOpenCodeData(
      await client.session.create({
        directory: projectPath,
        title: path.basename(projectPath),
        permission: getOpenCodePermissionRuleset(runtimeMode),
      }),
      "session.create"
    )

    const nextSession: RuntimeSession = {
      id: session.id,
      remoteId: session.id,
      harnessId: this.harnessId,
      runtimeMode,
      projectPath,
      title: session.title,
      createdAt: session.time.created,
      updatedAt: session.time.updated,
    }

    const state = this.createSessionState(nextSession, projectPath, runtimeMode)
    this.sessions.set(session.id, state)
    await this.persistSession(session.id, projectPath, runtimeMode)

    return nextSession
  }

  async listAgents(): Promise<RuntimeAgent[]> {
    if (this.agentCache && Date.now() - this.agentCache.fetchedAt < OPEN_CODE_AGENT_CACHE_TTL_MS) {
      return this.agentCache.agents
    }

    if (this.agentRequest) {
      return this.agentRequest
    }

    this.agentRequest = this.loadAgents()

    try {
      const agents = await this.agentRequest
      this.agentCache = {
        agents,
        fetchedAt: Date.now(),
      }
      return agents
    } finally {
      this.agentRequest = null
    }
  }

  async listCommands(projectPath?: string): Promise<RuntimeCommand[]> {
    const cacheKey = projectPath ?? "__global__"
    const cached = this.commandCache.get(cacheKey)
    if (cached && Date.now() - cached.fetchedAt < OPEN_CODE_COMMAND_CACHE_TTL_MS) {
      return cached.commands
    }

    const inFlight = this.commandRequests.get(cacheKey)
    if (inFlight) {
      return inFlight
    }

    const request = this.loadCommands(projectPath)
    this.commandRequests.set(cacheKey, request)

    try {
      const commands = await request
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
    if (this.modelCache && Date.now() - this.modelCache.fetchedAt < OPEN_CODE_MODEL_CACHE_TTL_MS) {
      return this.modelCache.models
    }

    if (this.modelRequest) {
      return this.modelRequest
    }

    this.modelRequest = this.loadModels()

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

  async searchFiles(query: string, directory?: string): Promise<RuntimeFileSearchResult[]> {
    const client = await this.getClient()
    const targetDirectory = directory?.trim()
    const projectPath = targetDirectory || this.getAnyKnownProjectPath()
    const paths = assertOpenCodeData(
      await client.find.files({
        directory: targetDirectory || undefined,
        query,
        dirs: "true",
      }),
      "find.files"
    )

    return Promise.all(
      paths.map(async (resultPath) => ({
        path: resultPath,
        type:
          projectPath == null
            ? "file"
            : await resolveSearchResultType(projectPath, resultPath),
      }))
    )
  }

  async sendTurn(input: HarnessTurnInput): Promise<HarnessTurnResult> {
    let client: OpencodeClient
    try {
      client = await this.getClient()
    } catch (error) {
      captureRuntimeError("provider_operation_failed", error, {
        harnessId: this.harnessId,
        phase: "opencode.client",
        session: input.session,
        model: input.model,
        runtimeMode: input.runtimeMode,
      })
      throw error
    }

    try {
      await this.ensureEventStream()
    } catch (error) {
      captureRuntimeError("provider_operation_failed", error, {
        harnessId: this.harnessId,
        phase: "opencode.event_stream",
        session: input.session,
        model: input.model,
        runtimeMode: input.runtimeMode,
      })
      throw error
    }

    const remoteId = getRemoteSessionId(input.session)
    const state = await this.ensureSessionState(input.session)
    state.onUpdate = input.onUpdate
    state.activePrompt = null
    state.pendingPrompts.clear()
    state.projectPath = input.projectPath ?? state.projectPath
    state.runtimeMode = input.runtimeMode ?? state.runtimeMode
    this.activeTurns.add(remoteId)

    const model = parseOpenCodeModelId(input.model ?? input.session.model ?? null)
    const turnDeferred = createDeferred<HarnessTurnResult>()
    state.activeTurn = {
      resolve: turnDeferred.resolve,
      reject: turnDeferred.reject,
    }

    try {
      assertOpenCodeAccepted(
        await client.session.promptAsync({
          sessionID: remoteId,
          directory: state.projectPath,
          agent: input.agent,
          model: model ?? undefined,
          parts: [
            {
              type: "text",
              text: input.text,
            },
          ],
        }),
        "session.promptAsync"
      )

      return await turnDeferred.promise
    } catch (error) {
      captureRuntimeError("provider_operation_failed", error, {
        harnessId: this.harnessId,
        phase: "opencode.session_prompt",
        session: input.session,
        model: input.model,
        runtimeMode: input.runtimeMode,
        extra: {
          has_agent: Boolean(input.agent),
        },
      })
      if (state.activeTurn?.reject === turnDeferred.reject) {
        state.activeTurn = undefined
      }
      throw error instanceof Error ? error : new Error(String(error))
    } finally {
      if (state.activeTurn?.reject === turnDeferred.reject) {
        state.activeTurn = undefined
        this.activeTurns.delete(remoteId)
      }
      if (!state.activeTurn) {
        state.onUpdate = undefined
      }
    }
  }

  async answerPrompt(input: HarnessPromptInput): Promise<HarnessTurnResult> {
    const client = await this.getClient()
    const state = await this.ensureSessionState(input.session)
    const pendingPrompt = state.pendingPrompts.get(input.prompt.id)

    if (pendingPrompt && input.prompt.kind === "approval" && input.response.kind === "approval") {
      const requestId = input.prompt.approval.requestId
      if (typeof requestId !== "string") {
        throw new Error("OpenCode approval request is missing a request id.")
      }

      assertOpenCodeData(
        await client.permission.reply({
          requestID: requestId,
          directory: state.projectPath,
          reply: input.response.decision === "approve" ? "once" : "reject",
        }),
        "permission.reply"
      )

      state.pendingPrompts.delete(input.prompt.id)
      state.activePrompt = null
      this.context.emitUpdate(getRemoteSessionId(input.session), this.harnessId, { prompt: null })
      return { prompt: null }
    }

    if (pendingPrompt && input.prompt.kind === "question" && input.response.kind === "question") {
      const requestId = input.prompt.id.replace(/^opencode-question:/, "")
      assertOpenCodeData(
        await client.question.reply({
          requestID: requestId,
          directory: state.projectPath,
          answers: mapOpenCodeQuestionResponse(input.prompt, input.response),
        }),
        "question.reply"
      )

      state.pendingPrompts.delete(input.prompt.id)
      state.activePrompt = null
      this.context.emitUpdate(getRemoteSessionId(input.session), this.harnessId, { prompt: null })
      return { prompt: null }
    }

    return this.sendTurn({
      session: input.session,
      projectPath: input.projectPath ?? state.projectPath,
      text: input.response.text,
    })
  }

  async interruptTurn(session: RuntimeSession): Promise<void> {
    const remoteId = getRemoteSessionId(session)
    if (!this.activeTurns.has(remoteId)) {
      return
    }

    const client = await this.getClient()
    assertOpenCodeData(
      await client.session.abort({
        sessionID: remoteId,
        directory: session.projectPath ?? undefined,
      }),
      "session.abort"
    )
    this.activeTurns.delete(remoteId)
    const state = this.sessions.get(remoteId)
    if (state?.activeTurn) {
      state.activeTurn.reject(new Error("OpenCode turn interrupted."))
      state.activeTurn = undefined
      state.onUpdate = undefined
    }
  }

  getActiveTurnCount(): number {
    return this.activeTurns.size
  }

  dispose(): void {
    this.eventAbortController?.abort()
    this.eventAbortController = null
    this.eventTask = null
    for (const state of this.sessions.values()) {
      state.activeTurn?.reject(new Error("OpenCode provider disposed."))
      state.activeTurn = undefined
      state.onUpdate = undefined
    }
    this.sessions.clear()
    this.activeTurns.clear()
  }

  private createSessionState(
    session: RuntimeSession,
    projectPath: string,
    runtimeMode: RuntimeModeKind
  ): OpenCodeSessionState {
    return {
      session,
      projectPath,
      runtimeMode,
      messageOrder: [],
      messagesById: new Map(),
      pendingPrompts: new Map(),
      activePrompt: null,
    }
  }

  private async ensureSessionState(session: RuntimeSession): Promise<OpenCodeSessionState> {
    const remoteId = getRemoteSessionId(session)
    const existing = this.sessions.get(remoteId)
    if (existing) {
      existing.session = {
        ...existing.session,
        ...session,
        remoteId,
      }
      existing.projectPath = session.projectPath ?? existing.projectPath
      existing.runtimeMode = session.runtimeMode ?? existing.runtimeMode
      return existing
    }

    const persisted = await this.context.persistence.load(remoteId)
    if (!persisted || persisted.harnessId !== this.harnessId) {
      throw new Error(`Unknown OpenCode session: ${remoteId}`)
    }

    const persistedState =
      persisted.state && typeof persisted.state === "object"
        ? (persisted.state as { runtimeMode?: RuntimeModeKind })
        : {}
    const nextSession: RuntimeSession = {
      ...session,
      remoteId,
      harnessId: this.harnessId,
      projectPath: session.projectPath ?? persisted.projectPath,
      runtimeMode: session.runtimeMode ?? persistedState.runtimeMode ?? "full-access",
    }
    const nextState = this.createSessionState(
      nextSession,
      nextSession.projectPath ?? persisted.projectPath,
      nextSession.runtimeMode ?? "full-access"
    )
    this.sessions.set(remoteId, nextState)
    return nextState
  }

  private async loadModels(): Promise<RuntimeModel[]> {
    const client = await this.getClient()
    const providerList = assertOpenCodeData(await client.provider.list(), "provider.list")
    return flattenOpenCodeModels(providerList)
  }

  private async loadAgents(): Promise<RuntimeAgent[]> {
    const client = await this.getClient()
    const agents = assertOpenCodeData(await client.app.agents(), "app.agents")
    return agents.map((agent: Agent) => ({
      name: agent.name,
      description: agent.description ?? "",
      mode: agent.mode,
      builtIn: agent.builtIn,
    }))
  }

  private async loadCommands(projectPath?: string): Promise<RuntimeCommand[]> {
    const client = await this.getClient()
    const commands = assertOpenCodeData(
      await client.command.list({
        directory: projectPath ?? undefined,
      }),
      "command.list"
    )

    return commands.map((command: Command) => ({
      name: command.name.replace(/^\//, ""),
      description: command.description ?? "",
      kind: "builtin",
      agent: command.agent,
      model: command.model,
    }))
  }

  private async getClient(): Promise<OpencodeClient> {
    const baseUrl = await this.openCodeServerService.getBaseUrl()
    if (this.client && this.clientBaseUrl === baseUrl) {
      return this.client
    }

    const settings = await this.providerSettingsService?.getProviderSettings("opencode")
    const serverPassword = settings?.serverUrl.trim() ? settings.serverPassword.trim() : ""
    this.client = createOpencodeClient({
      baseUrl,
      ...(serverPassword
        ? {
            headers: {
              Authorization: `Basic ${Buffer.from(`opencode:${serverPassword}`, "utf8").toString("base64")}`,
            },
          }
        : {}),
    })
    this.clientBaseUrl = baseUrl
    return this.client
  }

  private async ensureEventStream(): Promise<void> {
    if (this.eventTask) {
      return
    }

    const client = await this.getClient()
    const controller = new AbortController()
    this.eventAbortController = controller
    this.eventTask = (async () => {
      try {
        const eventResult = await client.global.event({
          signal: controller.signal,
        })

        for await (const event of eventResult.stream as AsyncIterable<GlobalEvent>) {
          this.handleGlobalEvent(event)
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn("[opencode] Event stream closed unexpectedly:", error)
        }
      } finally {
        if (this.eventAbortController === controller) {
          this.eventAbortController = null
        }
        this.eventTask = null
      }
    })()
  }

  private handleGlobalEvent(event: GlobalEvent): void {
    const payload = event.payload
    if (!payload) {
      return
    }

    switch (payload.type) {
      case "message.updated": {
        const sessionState = this.sessions.get(payload.properties.info.sessionID)
        if (!sessionState) {
          return
        }

        updateTrackedMessageInfo(sessionState, payload.properties.info)
        this.emitSessionUpdate(sessionState)
        return
      }

      case "session.status": {
        if (payload.properties.status.type === "idle") {
          this.settleActiveTurn(payload.properties.sessionID)
        }
        return
      }

      case "session.idle": {
        this.settleActiveTurn(payload.properties.sessionID)
        return
      }

      case "message.part.updated": {
        const sessionState = this.sessions.get(payload.properties.part.sessionID)
        if (!sessionState) {
          return
        }

        updateTrackedPart(sessionState, payload.properties.part)
        this.emitSessionUpdate(sessionState)
        return
      }

      case "message.part.delta": {
        const sessionState = this.sessions.get(payload.properties.sessionID)
        if (!sessionState) {
          return
        }

        applyTrackedPartDelta(sessionState, payload.properties)
        this.emitSessionUpdate(sessionState)
        return
      }

      case "message.part.removed": {
        const sessionState = this.sessions.get(payload.properties.sessionID)
        if (!sessionState) {
          return
        }

        removeTrackedPart(sessionState, payload.properties.messageID, payload.properties.partID)
        this.emitSessionUpdate(sessionState)
        return
      }

      case "message.removed": {
        const sessionState = this.sessions.get(payload.properties.sessionID)
        if (!sessionState) {
          return
        }

        sessionState.messagesById.delete(payload.properties.messageID)
        sessionState.messageOrder = sessionState.messageOrder.filter(
          (messageId) => messageId !== payload.properties.messageID
        )
        this.emitSessionUpdate(sessionState)
        return
      }

      case "permission.asked": {
        const sessionState = this.sessions.get(payload.properties.sessionID)
        if (!sessionState) {
          return
        }

        const prompt = buildOpenCodeApprovalPrompt(
          payload.properties,
          sessionState.projectPath
        )
        sessionState.pendingPrompts.set(prompt.id, prompt)
        sessionState.activePrompt = prompt
        this.emitSessionUpdate(sessionState, { prompt })
        return
      }

      case "permission.replied": {
        const sessionState = this.sessions.get(payload.properties.sessionID)
        if (!sessionState) {
          return
        }

        const promptId = `opencode-approval:${payload.properties.requestID}`
        sessionState.pendingPrompts.delete(promptId)
        if (sessionState.activePrompt?.id === promptId) {
          sessionState.activePrompt = null
        }
        this.emitSessionUpdate(sessionState, { prompt: null })
        return
      }

      case "question.asked": {
        const sessionState = this.sessions.get(payload.properties.sessionID)
        if (!sessionState) {
          return
        }

        const prompt = buildOpenCodeQuestionPrompt(payload.properties)
        sessionState.pendingPrompts.set(prompt.id, prompt)
        sessionState.activePrompt = prompt
        this.emitSessionUpdate(sessionState, { prompt })
        return
      }

      case "question.replied":
      case "question.rejected": {
        const sessionState = this.sessions.get(payload.properties.sessionID)
        if (!sessionState) {
          return
        }

        const promptId = `opencode-question:${payload.properties.requestID}`
        sessionState.pendingPrompts.delete(promptId)
        if (sessionState.activePrompt?.id === promptId) {
          sessionState.activePrompt = null
        }
        this.emitSessionUpdate(sessionState, { prompt: null })
        return
      }

      case "session.error": {
        const sessionId = payload.properties.sessionID
        if (!sessionId) {
          return
        }

        const sessionState = this.sessions.get(sessionId)
        if (!sessionState) {
          return
        }

        this.activeTurns.delete(sessionId)
        const errorMessage =
          payload.properties.error && typeof payload.properties.error === "object"
            ? JSON.stringify(payload.properties.error)
            : "OpenCode session failed."
        const activeTurn = sessionState.activeTurn
        sessionState.onUpdate?.({
          messages: [
            createAssistantMessage(
              sessionState.session.id,
              `opencode-error:${sessionId}`,
              Date.now(),
              [
                {
                  id: `opencode-error:${sessionId}:text`,
                  type: "text",
                  text: errorMessage,
                },
              ],
              {
                itemType: "approval",
              }
            ),
          ],
        })
        activeTurn?.reject(new Error(errorMessage))
        sessionState.activeTurn = undefined
        sessionState.onUpdate = undefined
        return
      }

      default:
        return
    }
  }

  private emitSessionUpdate(
    sessionState: OpenCodeSessionState,
    overrideResult?: HarnessTurnResult
  ): void {
    const result =
      overrideResult ??
      ({
        messages: mapTrackedMessagesToRuntimeMessages(sessionState),
        prompt: sessionState.activePrompt,
      } satisfies HarnessTurnResult)

    sessionState.onUpdate?.(result)
    this.context.emitUpdate(
      getRemoteSessionId(sessionState.session),
      this.harnessId,
      result
    )
  }

  private settleActiveTurn(sessionId: string): void {
    const sessionState = this.sessions.get(sessionId)
    const activeTurn = sessionState?.activeTurn
    if (!sessionState || !activeTurn) {
      return
    }

    this.activeTurns.delete(sessionId)
    sessionState.activeTurn = undefined
    sessionState.onUpdate = undefined
    activeTurn.resolve({
      messages: mapTrackedMessagesToRuntimeMessages(sessionState),
      prompt: sessionState.activePrompt,
    })
  }

  private async persistSession(
    remoteId: string,
    projectPath: string,
    runtimeMode: RuntimeModeKind
  ): Promise<void> {
    await this.context.persistence.save(remoteId, {
      harnessId: this.harnessId,
      projectPath,
      state: {
        runtimeMode,
      },
      updatedAt: Date.now(),
    })
  }

  private getAnyKnownProjectPath(): string | null {
    const firstSession = this.sessions.values().next().value as OpenCodeSessionState | undefined
    return firstSession?.projectPath ?? null
  }
}
