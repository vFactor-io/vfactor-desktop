import type { HarnessTurnInput, RuntimePrompt } from "../types"
import type { CodexRpcClient } from "./codexRpcClient"
import { CodexTurnState, mapTurnItemsToMessages } from "./codexMessageMapper"
import {
  isTransientTurnReadError,
  readCodexTurn,
  TURN_STALL_TIMEOUT_MS,
  TURN_SYNC_INTERVAL_MS,
  type CodexApprovalNotificationParams,
  type CodexCommandApprovalServerRequestParams,
  type CodexFileChangeApprovalServerRequestParams,
  type CodexItemNotification,
  type CodexOutputDeltaNotification,
  type CodexReasoningSummaryTextDeltaNotification,
  type CodexReasoningTextDeltaNotification,
  type CodexServerRequestResolvedNotification,
  type CodexTextDeltaNotification,
  type CodexToolRequestUserInputParams,
  type CodexTurn,
  type CodexTurnNotification,
} from "./codexProtocol"
import {
  logCodexApprovalDebug,
  mapApplyPatchApprovalNotificationToPrompt,
  mapCodexApprovalChanges,
  mapCodexUserInputRequestToPrompt,
  mapCommandApprovalServerRequestToPrompt,
  mapExecApprovalNotificationToPrompt,
  mapFileChangeApprovalServerRequestToPrompt,
  mergeApprovalPrompts,
  toOptionalString,
  type CodexPendingApprovalRequest,
  type CodexPendingUserInputRequest,
} from "./codexPrompts"

interface WaitForCodexTurnCompletionOptions {
  rpc: CodexRpcClient
  threadId: string
  sessionId: string
  turnId: string
  onUpdate?: HarnessTurnInput["onUpdate"]
  pendingUserInputRequests: Map<string, CodexPendingUserInputRequest>
  pendingApprovalRequests: Map<string, CodexPendingApprovalRequest>
  pendingApprovalNotificationPrompts: Map<string, RuntimePrompt>
}

export function waitForCodexTurnCompletion(
  options: WaitForCodexTurnCompletionOptions
): Promise<CodexTurn | undefined> {
  const {
    rpc,
    threadId,
    sessionId,
    turnId,
    onUpdate,
    pendingUserInputRequests,
    pendingApprovalRequests,
    pendingApprovalNotificationPrompts,
  } = options

  return new Promise<CodexTurn>((resolve, reject) => {
    const turnState = new CodexTurnState()
    let settled = false
    let emitQueued = false
    let lastEmittedSnapshot = ""
    let activePromptId: string | null = null
    let lastActivityAt = Date.now()
    let syncInFlight = false

    const noteActivity = () => {
      lastActivityAt = Date.now()
    }

    const registerApprovalPrompt = (
      prompt: RuntimePrompt,
      pendingApproval: Omit<CodexPendingApprovalRequest, "callId" | "prompt" | "threadId" | "turnId">
    ) => {
      if (prompt.kind !== "approval") {
        return
      }

      const promptWithMetadata = mergeApprovalPrompts(
        prompt,
        pendingApprovalNotificationPrompts.get(sessionId)
      )

      const existingPendingApproval = pendingApprovalRequests.get(sessionId)
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

          pendingApprovalRequests.set(sessionId, {
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

      pendingApprovalRequests.set(sessionId, {
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
      noteActivity()
      onUpdate?.({ prompt: promptWithMetadata })
    }

    const emitUpdate = () => {
      if (!onUpdate || emitQueued || settled) {
        return
      }

      const items = turnState.orderedItems()
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
      if (settled || syncInFlight) {
        return
      }

      syncInFlight = true

      try {
        const turn = await readCodexTurn(rpc, threadId, turnId)
        if (!turn) {
          return
        }

        noteActivity()

        for (const item of turn.items) {
          turnState.upsert(item)
        }

        emitUpdate()

        if (turn.status !== "inProgress") {
          finish(turn)
        }
      } catch (error) {
        if (!isTransientTurnReadError(error)) {
          fail(error)
        }
      } finally {
        syncInFlight = false
      }
    }

    const finish = (turn: CodexTurn) => {
      if (settled) {
        return
      }

      settled = true
      window.clearInterval(syncIntervalId)
      window.clearInterval(stallIntervalId)
      unsubscribe()
      unsubscribeServerRequest()
      pendingUserInputRequests.delete(sessionId)
      pendingApprovalRequests.delete(sessionId)
      pendingApprovalNotificationPrompts.delete(sessionId)
      resolve(turn)
    }

    const fail = (error: unknown) => {
      if (settled) {
        return
      }

      settled = true
      window.clearInterval(syncIntervalId)
      window.clearInterval(stallIntervalId)
      unsubscribe()
      unsubscribeServerRequest()
      pendingUserInputRequests.delete(sessionId)
      pendingApprovalRequests.delete(sessionId)
      pendingApprovalNotificationPrompts.delete(sessionId)
      reject(error instanceof Error ? error : new Error(String(error)))
    }

    const syncIntervalId = window.setInterval(() => {
      void syncTurnFromRead()
    }, TURN_SYNC_INTERVAL_MS)

    const stallIntervalId = window.setInterval(() => {
      if (settled || activePromptId || syncInFlight) {
        return
      }

      if (Date.now() - lastActivityAt < TURN_STALL_TIMEOUT_MS) {
        return
      }

      void (async () => {
        await syncTurnFromRead()

        if (settled || activePromptId) {
          return
        }

        if (Date.now() - lastActivityAt < TURN_STALL_TIMEOUT_MS) {
          return
        }

        fail(
          new Error(
            "Codex stopped sending turn updates. Partial progress was preserved, but the turn was marked as interrupted."
          )
        )
      })()
    }, TURN_SYNC_INTERVAL_MS)

    const unsubscribe = rpc.onNotification((notification) => {
      try {
        switch (notification.method) {
          case "item/started": {
            const params = notification.params as CodexItemNotification | undefined
            if (!params || params.threadId !== threadId || params.turnId !== turnId) {
              return
            }

            noteActivity()
            turnState.upsert(params.item)
            emitUpdate()
            return
          }

          case "item/completed": {
            const params = notification.params as CodexItemNotification | undefined
            if (!params || params.threadId !== threadId || params.turnId !== turnId) {
              return
            }

            noteActivity()
            turnState.upsert(params.item)
            emitUpdate()
            return
          }

          case "item/agentMessage/delta": {
            const params = notification.params as CodexTextDeltaNotification | undefined
            if (!params || params.threadId !== threadId || params.turnId !== turnId) {
              return
            }

            noteActivity()
            turnState.appendAgentMessageDelta(params.itemId, params.delta)
            emitUpdate()
            return
          }

          case "item/plan/delta": {
            const params = notification.params as CodexTextDeltaNotification | undefined
            if (!params || params.threadId !== threadId || params.turnId !== turnId) {
              return
            }

            noteActivity()
            turnState.appendPlanDelta(params.itemId, params.delta)
            emitUpdate()
            return
          }

          case "item/reasoning/textDelta": {
            const params = notification.params as CodexReasoningTextDeltaNotification | undefined
            if (!params || params.threadId !== threadId || params.turnId !== turnId) {
              return
            }

            noteActivity()
            turnState.appendReasoningContentDelta(params.itemId, params.contentIndex, params.delta)
            emitUpdate()
            return
          }

          case "item/reasoning/summaryTextDelta": {
            const params =
              notification.params as CodexReasoningSummaryTextDeltaNotification | undefined
            if (!params || params.threadId !== threadId || params.turnId !== turnId) {
              return
            }

            noteActivity()
            turnState.appendReasoningSummaryDelta(params.itemId, params.summaryIndex, params.delta)
            emitUpdate()
            return
          }

          case "item/commandExecution/outputDelta": {
            const params = notification.params as CodexOutputDeltaNotification | undefined
            if (!params || params.threadId !== threadId || params.turnId !== turnId) {
              return
            }

            noteActivity()
            turnState.appendCommandOutputDelta(params.itemId, params.delta)
            emitUpdate()
            return
          }

          case "item/fileChange/outputDelta": {
            const params = notification.params as CodexOutputDeltaNotification | undefined
            if (!params || params.threadId !== threadId || params.turnId !== turnId) {
              return
            }

            noteActivity()
            turnState.appendFileChangeOutputDelta(params.itemId, params.delta)
            emitUpdate()
            return
          }

          case "turn/completed": {
            const params = notification.params as CodexTurnNotification | undefined
            if (!params || params.threadId !== threadId || params.turn.id !== turnId) {
              return
            }

            noteActivity()
            const completedTurn: CodexTurn = {
              ...params.turn,
              items: turnState.orderedItems(),
            }
            finish(completedTurn)
            return
          }

          case "serverRequest/resolved": {
            const params = notification.params as CodexServerRequestResolvedNotification | undefined
            if (!params || params.threadId !== threadId) {
              return
            }

            const pendingRequest = pendingUserInputRequests.get(sessionId)
            if (pendingRequest?.requestId === params.requestId) {
              pendingUserInputRequests.delete(sessionId)
              activePromptId = null
              noteActivity()
              onUpdate?.({ prompt: null })
              return
            }

            const pendingApprovalRequest = pendingApprovalRequests.get(sessionId)
            if (pendingApprovalRequest?.requestId !== params.requestId) {
              return
            }

            pendingApprovalRequests.delete(sessionId)
            pendingApprovalNotificationPrompts.delete(sessionId)
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
            noteActivity()
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

            pendingApprovalNotificationPrompts.set(sessionId, prompt)
            noteActivity()
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

            pendingApprovalNotificationPrompts.set(sessionId, prompt)
            noteActivity()
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

    const unsubscribeServerRequest = rpc.onServerRequest((request) => {
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
          noteActivity()
          pendingUserInputRequests.set(sessionId, {
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
          if (
            !params ||
            (params.threadId ?? params.conversationId) !== threadId ||
            params.turnId !== turnId
          ) {
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
          if (
            !params ||
            (params.threadId ?? params.conversationId) !== threadId ||
            params.turnId !== turnId
          ) {
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
