import type {
  HarnessPromptInput,
  HarnessTurnInput,
  HarnessTurnResult,
  RuntimeModel,
  RuntimePrompt,
  RuntimeSession,
} from "@/features/chat/types"
import { getRuntimeModelLabel } from "@/features/chat/domain/runtimeModels"
import { getRemoteSessionId } from "@/features/chat/domain/runtimeSessions"
import { mapTurnItemsToMessages } from "@/features/chat/runtime/codexMessageMapper"
import {
  mapReasoningEffort,
  mapThreadToSession,
  readCodexTurn,
  TURN_SYNC_INTERVAL_MS,
  type CodexModel,
  type CodexModelListResponse,
  type CodexServerRequestResolvedNotification,
  type CodexThread,
  type CodexTurn,
  type CodexTurnStartResponse,
} from "@/features/chat/runtime/codexProtocol"
import {
  codexModelSupportsFastMode,
  mapCodexFastModeToServiceTier,
} from "@/features/chat/runtime/codexFastMode"
import {
  logCodexApprovalDebug,
  mapApprovalDecisionToClientRequest,
  mapApprovalDecisionToServerResponse,
  mapApprovalPromptToApplyPatchApprovalParams,
  mapApprovalPromptToExecCommandApprovalParams,
  mapRuntimePromptResponseToCodexResponse,
  type CodexPendingApprovalRequest,
  type CodexPendingUserInputRequest,
} from "@/features/chat/runtime/codexPrompts"
import { waitForCodexTurnCompletion } from "@/features/chat/runtime/codexTurnTracker"
import type { GitService } from "../git"
import type { CodexServerService } from "../codexServer"
import { MainCodexRpcClient } from "./codexRpcClient"
import type { RuntimeProviderAdapter, RuntimeProviderContext } from "./providerTypes"

type CodexSessionPermissionPreset = {
  approvalPolicy: "on-request"
  sandbox: "read-only" | "workspace-write"
}

const CODEX_REASONING_SUMMARY = "detailed" as const
const CODEX_MODEL_CACHE_TTL_MS = 30 * 60 * 1000

async function getDefaultCodexSessionPermissionPreset(
  gitService: GitService,
  projectPath: string
): Promise<CodexSessionPermissionPreset> {
  try {
    await gitService.getBranches(projectPath)
    return {
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
    }
  } catch {
    return {
      approvalPolicy: "on-request",
      sandbox: "read-only",
    }
  }
}

export class CodexRuntimeProvider implements RuntimeProviderAdapter {
  readonly harnessId = "codex" as const

  private rpc: MainCodexRpcClient
  private activeTurns = new Map<string, string>()
  private pendingUserInputRequests = new Map<string, CodexPendingUserInputRequest>()
  private pendingApprovalRequests = new Map<string, CodexPendingApprovalRequest>()
  private pendingApprovalNotificationPrompts = new Map<string, RuntimePrompt>()
  private modelCache: { models: RuntimeModel[]; fetchedAt: number } | null = null
  private modelRequest: Promise<RuntimeModel[]> | null = null

  constructor(
    private readonly context: RuntimeProviderContext,
    private readonly gitService: GitService,
    codexServerService: CodexServerService
  ) {
    this.rpc = new MainCodexRpcClient(codexServerService)
  }

  async createSession(projectPath: string): Promise<RuntimeSession> {
    await this.rpc.connect()
    const permissionPreset = await getDefaultCodexSessionPermissionPreset(this.gitService, projectPath)

    const response = await this.rpc.request<{ thread: CodexThread }>("thread/start", {
      cwd: projectPath,
      approvalPolicy: permissionPreset.approvalPolicy,
      sandbox: permissionPreset.sandbox,
      experimentalRawEvents: false,
      persistExtendedHistory: false,
    })

    return mapThreadToSession(response.thread)
  }

  async listAgents() {
    return []
  }

  async listCommands(_projectPath?: string) {
    return []
  }

  async listModels(): Promise<RuntimeModel[]> {
    if (this.modelCache && Date.now() - this.modelCache.fetchedAt < CODEX_MODEL_CACHE_TTL_MS) {
      return this.modelCache.models
    }

    if (this.modelRequest) {
      return this.modelRequest
    }

    this.modelRequest = this.loadModelsFromRpc()

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

  private async loadModelsFromRpc(): Promise<RuntimeModel[]> {
    await this.rpc.connect()

    const models: RuntimeModel[] = []
    let cursor: string | null = null

    do {
      const params: { limit: number; includeHidden: boolean; cursor?: string } = {
        limit: 100,
        includeHidden: false,
      }

      if (cursor) {
        params.cursor = cursor
      }

      const response: CodexModelListResponse = await this.rpc.request("model/list", params)

      models.push(
        ...response.data.map((model: CodexModel) => ({
          id: model.id || model.model,
          displayName: getRuntimeModelLabel({
            displayName: model.displayName,
            id: model.model || model.id,
          }),
          isDefault: model.isDefault ?? false,
          defaultReasoningEffort: model.defaultReasoningEffort ?? null,
          supportedReasoningEfforts:
            model.supportedReasoningEfforts
              ?.map((entry: { reasoningEffort: string }) => entry.reasoningEffort)
              .filter((value: string): value is string => value.length > 0) ?? [],
          supportsFastMode: codexModelSupportsFastMode(model.id || model.model),
        }))
      )

      cursor = response.nextCursor
    } while (cursor)

    return Array.from(new Map(models.map((model) => [model.id, model])).values()).sort(
      (left, right) => {
        if (left.isDefault !== right.isDefault) {
          return left.isDefault ? -1 : 1
        }

        return left.displayName.localeCompare(right.displayName)
      }
    )
  }

  async sendTurn(input: HarnessTurnInput): Promise<HarnessTurnResult> {
    const threadId = getRemoteSessionId(input.session)
    const response = await this.rpc.request<CodexTurnStartResponse>("turn/start", {
      threadId,
      cwd: input.projectPath ?? input.session.projectPath ?? null,
      model: input.model ?? null,
      effort: mapReasoningEffort(input.reasoningEffort),
      serviceTier: mapCodexFastModeToServiceTier(input.fastMode),
      summary: CODEX_REASONING_SUMMARY,
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
    this.activeTurns.set(threadId, turnId)
    input.onUpdate?.({})

    const completedTurn = await waitForCodexTurnCompletion({
      rpc: this.rpc as any,
      threadId,
      sessionId: threadId,
      turnId,
      onUpdate: (result) => {
        input.onUpdate?.(result)
        this.context.emitUpdate(threadId, this.harnessId, result)
      },
      pendingUserInputRequests: this.pendingUserInputRequests,
      pendingApprovalRequests: this.pendingApprovalRequests,
      pendingApprovalNotificationPrompts: this.pendingApprovalNotificationPrompts,
    })
    this.activeTurns.delete(threadId)

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
      messages: mapTurnItemsToMessages(turn, threadId),
    }
  }

  async answerPrompt(input: HarnessPromptInput): Promise<HarnessTurnResult> {
    const remoteId = getRemoteSessionId(input.session)
    const pendingRequest = this.pendingUserInputRequests.get(remoteId)
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
      } catch {}

      this.pendingUserInputRequests.delete(remoteId)
      return {}
    }

    const pendingApprovalRequest = this.pendingApprovalRequests.get(remoteId)
    if (pendingApprovalRequest && pendingApprovalRequest.prompt.id === input.prompt.id) {
      logCodexApprovalDebug("answer:start", {
        sessionId: remoteId,
        promptId: input.prompt.id,
        protocol: pendingApprovalRequest.protocol,
        requestId: pendingApprovalRequest.requestId ?? null,
        callId: pendingApprovalRequest.callId,
      })

      if (pendingApprovalRequest.protocol === "v2ServerRequest") {
        if (pendingApprovalRequest.requestId == null) {
          throw new Error("Approval server request is missing a request id.")
        }

        this.rpc.respond(
          pendingApprovalRequest.requestId,
          mapApprovalDecisionToServerResponse(input.prompt, input.response)
        )
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

      this.pendingApprovalRequests.delete(remoteId)
      this.pendingApprovalNotificationPrompts.delete(remoteId)
      return {}
    }

    if (input.prompt.kind === "approval") {
      throw new Error("Approval request is no longer pending.")
    }

    return this.sendTurn({
      session: input.session,
      projectPath: input.projectPath,
      text: input.response.text,
    })
  }

  async interruptTurn(session: RuntimeSession): Promise<void> {
    const threadId = getRemoteSessionId(session)
    const turnId = this.activeTurns.get(threadId)
    if (!turnId) {
      return
    }

    await this.rpc.request("turn/interrupt", {
      threadId,
      turnId,
    })
    this.activeTurns.delete(threadId)
  }

  getActiveTurnCount(): number {
    return this.activeTurns.size
  }

  dispose(): void {}

  private async readTurn(threadId: string, turnId: string): Promise<CodexTurn | undefined> {
    try {
      return await readCodexTurn(this.rpc as any, threadId, turnId)
    } catch (error) {
      throw new Error(
        error instanceof Error ? error.message : `Thread not found: ${threadId}`
      )
    }
  }
}
