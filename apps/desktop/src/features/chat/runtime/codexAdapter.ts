import type {
  HarnessAdapter,
  HarnessCommandInput,
  HarnessDefinition,
  HarnessPromptInput,
  HarnessTurnInput,
  HarnessTurnResult,
  RuntimeModel,
  RuntimePrompt,
  RuntimeSession,
} from "../types"
import { desktop } from "@/desktop/client"
import { getRuntimeModelLabel } from "../domain/runtimeModels"
import { getRemoteSessionId } from "../domain/runtimeSessions"
import { mapTurnItemsToMessages } from "./codexMessageMapper"
import {
  mapReasoningEffort,
  mapThreadToSession,
  readCodexTurn,
  type CodexModel,
  type CodexModelListResponse,
  TURN_SYNC_INTERVAL_MS,
  type CodexServerRequestResolvedNotification,
  type CodexThread,
  type CodexTurn,
  type CodexTurnStartResponse,
} from "./codexProtocol"
import {
  type CodexPendingApprovalRequest,
  type CodexPendingUserInputRequest,
  logCodexApprovalDebug,
  mapApprovalDecisionToClientRequest,
  mapApprovalDecisionToServerResponse,
  mapApprovalPromptToApplyPatchApprovalParams,
  mapApprovalPromptToExecCommandApprovalParams,
  mapRuntimePromptResponseToCodexResponse,
} from "./codexPrompts"
import { getCodexRpcClient } from "./codexRpcClient"
import { waitForCodexTurnCompletion } from "./codexTurnTracker"

type CodexSessionPermissionPreset = {
  approvalPolicy: "on-request"
  sandbox: "read-only" | "workspace-write"
}

async function getDefaultCodexSessionPermissionPreset(
  projectPath: string
): Promise<CodexSessionPermissionPreset> {
  try {
    await desktop.git.getBranches(projectPath)

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
    const permissionPreset = await getDefaultCodexSessionPermissionPreset(projectPath)

    const response = await this.rpc.request<{
      thread: CodexThread
    }>("thread/start", {
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

  async listCommands() {
    return []
  }

  async listModels(): Promise<RuntimeModel[]> {
    await this.initialize()

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
        }))
      )

      cursor = response.nextCursor
    } while (cursor)

    const uniqueModels = Array.from(new Map(models.map((model) => [model.id, model])).values())

    uniqueModels.sort((left, right) => {
      if (left.isDefault !== right.isDefault) {
        return left.isDefault ? -1 : 1
      }

      return left.displayName.localeCompare(right.displayName)
    })

    return uniqueModels
  }

  async searchFiles() {
    return []
  }

  async sendMessage(input: HarnessTurnInput): Promise<HarnessTurnResult> {
    const threadId = getRemoteSessionId(input.session)
    const response = await this.rpc.request<CodexTurnStartResponse>("turn/start", {
      threadId,
      cwd: input.projectPath ?? input.session.projectPath ?? null,
      model: input.model ?? null,
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
        approvalKind: input.prompt.kind === "approval" ? input.prompt.approval.kind : null,
        decision: input.response.kind === "approval" ? input.response.decision : null,
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
        {
          info: {
            id: `command:${now}:message`,
            sessionId: input.session.id,
            role: "assistant",
            createdAt: now,
          },
          parts: [
            {
              id: `command:${now}:text`,
              type: "text",
              text: `Command execution through the Codex adapter is not wired up yet. Requested command: /${input.command}${input.args ? ` ${input.args}` : ""}`,
            },
          ],
        },
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
    return waitForCodexTurnCompletion({
      rpc: this.rpc,
      threadId,
      sessionId,
      turnId,
      onUpdate,
      pendingUserInputRequests: this.pendingUserInputRequests,
      pendingApprovalRequests: this.pendingApprovalRequests,
      pendingApprovalNotificationPrompts: this.pendingApprovalNotificationPrompts,
    })
  }

  private async readTurn(threadId: string, turnId: string): Promise<CodexTurn | undefined> {
    return readCodexTurn(this.rpc, threadId, turnId)
  }
}
