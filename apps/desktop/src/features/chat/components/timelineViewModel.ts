import type {
  ChildSessionState,
  MessageWithParts,
  RuntimeApprovalDisplayState,
  RuntimePromptState,
} from "../types"
import { isRuntimeApprovalPrompt } from "../domain/runtimePrompts"
import type { ChildSessionData } from "./agent-activity/AgentActivitySubagent"
import {
  buildTimelineBlocks,
  getFileChangeEntries,
  getToolPartFromMessage,
  type TimelineBlock,
} from "./timelineActivity"

export interface TimelineFileChangeSummary {
  fileCount: number
  label: string
  added: number
  removed: number
}

export interface ChatTimelineViewModel {
  renderedMessages: MessageWithParts[]
  timelineBlocks: TimelineBlock[]
  approvalStateByMessageId: Map<string, RuntimeApprovalDisplayState>
  latestTurnLastAssistantTextMessage: MessageWithParts | null
  latestTurnLastAssistantTextMessageId: string | null
  latestTurnChangedFilesSummary: TimelineFileChangeSummary | null
  completedWorkDurationByMessageId: Map<string, number>
  completedFooterByMessageId: Map<
    string,
    {
      durationMs: number
      changedFilesSummary: TimelineFileChangeSummary | null
    }
  >
  childSessionData?: Map<string, ChildSessionData>
  orphanChildSessions: ChildSessionData[]
}

function countDiffLines(diff: string | undefined): { added: number; removed: number } {
  if (!diff) {
    return { added: 0, removed: 0 }
  }

  return diff.split("\n").reduce(
    (totals, line) => {
      if (line.startsWith("+++ ") || line.startsWith("--- ")) {
        return totals
      }
      if (line.startsWith("+")) {
        return { ...totals, added: totals.added + 1 }
      }
      if (line.startsWith("-")) {
        return { ...totals, removed: totals.removed + 1 }
      }
      return totals
    },
    { added: 0, removed: 0 }
  )
}

function getApprovalDisplayState(
  activePromptState: RuntimePromptState | null | undefined
): RuntimeApprovalDisplayState | null {
  if (!activePromptState || !isRuntimeApprovalPrompt(activePromptState.prompt)) {
    return null
  }

  if (activePromptState.status === "active") {
    return "pending"
  }

  if (
    activePromptState.status === "answered" &&
    activePromptState.response?.kind === "approval" &&
    activePromptState.response.decision === "approve"
  ) {
    return "approved"
  }

  return "denied"
}

function buildApprovalTimelineMessage(
  activePromptState: RuntimePromptState,
  approvalDisplayState: RuntimeApprovalDisplayState
): MessageWithParts {
  const approvalPrompt = activePromptState.prompt
  const itemType =
    approvalPrompt.approval.kind === "fileChange" ? "fileChange" : "commandExecution"
  const messageId = approvalPrompt.approval.itemId
    ? `approval:${approvalPrompt.approval.itemId}`
    : `approval:${approvalPrompt.id}`

  return {
    info: {
      id: messageId,
      sessionId: messageId,
      role: "assistant",
      createdAt: activePromptState.updatedAt ?? activePromptState.createdAt,
      turnId: approvalPrompt.approval.turnId,
      itemType,
    },
    parts: [
      {
        id: `${messageId}:tool`,
        type: "tool",
        messageId,
        sessionId: messageId,
        tool: itemType === "fileChange" ? "fileChange" : "command/exec",
        state: {
          status:
            approvalDisplayState === "approved"
              ? "completed"
              : approvalDisplayState === "denied"
                ? "error"
                : "pending",
          title:
            itemType === "fileChange"
              ? "Apply file changes"
              : approvalPrompt.approval.command ?? "Run command",
          subtitle: approvalPrompt.approval.cwd,
          input:
            itemType === "fileChange"
              ? {
                  reason: approvalPrompt.approval.reason,
                }
              : {
                  command: approvalPrompt.approval.command,
                  cwd: approvalPrompt.approval.cwd,
                  commandActions: approvalPrompt.approval.commandActions,
                },
          output:
            itemType === "fileChange"
              ? {
                  changes: approvalPrompt.approval.changes ?? [],
                  outputText: null,
                }
              : undefined,
        },
      },
    ],
  }
}

function buildApprovalStateByMessageId(
  renderedMessages: MessageWithParts[],
  activePromptState: RuntimePromptState | null,
  approvalDisplayState: RuntimeApprovalDisplayState | null
): Map<string, RuntimeApprovalDisplayState> {
  const approvalStateByMessageId = new Map<string, RuntimeApprovalDisplayState>()

  if (!activePromptState || !approvalDisplayState || !isRuntimeApprovalPrompt(activePromptState.prompt)) {
    return approvalStateByMessageId
  }

  const fallbackMessageId = activePromptState.prompt.approval.itemId
    ? `approval:${activePromptState.prompt.approval.itemId}`
    : `approval:${activePromptState.prompt.id}`
  const targetItemId = activePromptState.prompt.approval.itemId
  const targetMessageId = targetItemId ? `${targetItemId}:message` : null

  for (const message of renderedMessages) {
    const matchesApproval =
      message.info.id === fallbackMessageId ||
      (targetMessageId != null && message.info.id === targetMessageId) ||
      (targetItemId != null && getToolPartFromMessage(message)?.id === targetItemId)

    if (matchesApproval) {
      approvalStateByMessageId.set(message.info.id, approvalDisplayState)
    }
  }

  return approvalStateByMessageId
}

export function buildChatTimelineViewModel({
  messages,
  activePromptState,
  childSessions,
}: {
  messages: MessageWithParts[]
  activePromptState?: RuntimePromptState | null
  childSessions?: Map<string, ChildSessionState>
}): ChatTimelineViewModel {
  const approvalPromptState =
    activePromptState && isRuntimeApprovalPrompt(activePromptState.prompt)
      ? activePromptState
      : null
  const approvalDisplayState = getApprovalDisplayState(approvalPromptState)
  const approvalTargetItemId = approvalPromptState?.prompt.approval.itemId ?? null
  const approvalTargetMessageId = approvalTargetItemId
    ? `${approvalTargetItemId}:message`
    : null
  const approvalMatchesExistingTool =
    approvalTargetItemId == null
      ? false
      : messages.some(
          (message) =>
            message.info.id === approvalTargetMessageId ||
            message.parts.some(
              (part) => part.type === "tool" && part.id === approvalTargetItemId
            )
        )
  const renderedMessages =
    approvalPromptState && approvalDisplayState && !approvalMatchesExistingTool
      ? [
          ...messages,
          buildApprovalTimelineMessage(approvalPromptState, approvalDisplayState),
        ]
      : messages

  let latestTurnStartIndex = 0
  for (let i = renderedMessages.length - 1; i >= 0; i--) {
    if (renderedMessages[i].info.role === "user") {
      latestTurnStartIndex = i + 1
      break
    }
  }

  const latestTurnMessages = renderedMessages.slice(latestTurnStartIndex)
  const latestTurnLastAssistantTextMessage =
    [...latestTurnMessages]
      .reverse()
      .find(
        (message) =>
          message.info.role === "assistant" &&
          message.parts.some((part) => part.type === "text" && part.text.trim())
      ) ?? null
  const latestTurnLastAssistantTextMessageId =
    latestTurnLastAssistantTextMessage?.info.id ?? null

  const changeTotals = new Map<string, { added: number; removed: number }>()
  for (const candidate of latestTurnMessages) {
    if (candidate.info.itemType !== "fileChange") {
      continue
    }

    const output = getToolPartFromMessage(candidate)?.state.output
    const source =
      output && typeof output === "object" && "changes" in output
        ? (output as { changes?: unknown[] }).changes
        : undefined

    for (const change of getFileChangeEntries(source)) {
      const current = changeTotals.get(change.path) ?? { added: 0, removed: 0 }
      const diffTotals = countDiffLines(change.diff)

      changeTotals.set(change.path, {
        added: current.added + diffTotals.added,
        removed: current.removed + diffTotals.removed,
      })
    }
  }

  const latestTurnChangedFilesSummary =
    latestTurnLastAssistantTextMessageId == null || changeTotals.size === 0
      ? null
      : (() => {
          const entries = Array.from(changeTotals.entries())
          const [firstPath] = entries[0]
          const totalAdded = entries.reduce((sum, [, totals]) => sum + totals.added, 0)
          const totalRemoved = entries.reduce((sum, [, totals]) => sum + totals.removed, 0)

          return {
            fileCount: entries.length,
            label:
              entries.length === 1
                ? firstPath.split(/[\\/]/).filter(Boolean).at(-1) ?? firstPath
                : `${entries.length} files`,
            added: totalAdded,
            removed: totalRemoved,
          }
        })()

  const earliestTimestampByTurnId = new Map<string, number>()
  const completedWorkDurationByMessageId = new Map<string, number>()
  const lastAssistantTextMessageByTurnId = new Map<string, MessageWithParts>()
  const fileChangeTotalsByTurnId = new Map<string, Map<string, { added: number; removed: number }>>()

  for (const message of renderedMessages) {
    const turnId = message.info.turnId
    if (!turnId) {
      continue
    }

    const existingTimestamp = earliestTimestampByTurnId.get(turnId)
    earliestTimestampByTurnId.set(
      turnId,
      existingTimestamp == null
        ? message.info.createdAt
        : Math.min(existingTimestamp, message.info.createdAt)
    )

    if (message.info.itemType === "fileChange") {
      const output = getToolPartFromMessage(message)?.state.output
      const source =
        output && typeof output === "object" && "changes" in output
          ? (output as { changes?: unknown[] }).changes
          : undefined
      const turnChangeTotals = fileChangeTotalsByTurnId.get(turnId) ?? new Map<string, { added: number; removed: number }>()

      for (const change of getFileChangeEntries(source)) {
        const current = turnChangeTotals.get(change.path) ?? { added: 0, removed: 0 }
        const diffTotals = countDiffLines(change.diff)

        turnChangeTotals.set(change.path, {
          added: current.added + diffTotals.added,
          removed: current.removed + diffTotals.removed,
        })
      }

      fileChangeTotalsByTurnId.set(turnId, turnChangeTotals)
    }
  }

  for (const message of renderedMessages) {
    if (
      message.info.role !== "assistant" ||
      !message.parts.some((part) => part.type === "text" && part.text.trim())
    ) {
      continue
    }

    const turnId = message.info.turnId
    const startTime = turnId ? earliestTimestampByTurnId.get(turnId) : null
    if (startTime == null) {
      continue
    }

    completedWorkDurationByMessageId.set(
      message.info.id,
      Math.max(0, message.info.createdAt - startTime)
    )
    lastAssistantTextMessageByTurnId.set(turnId, message)
  }

  const completedFooterByMessageId = new Map<
    string,
    {
      durationMs: number
      changedFilesSummary: TimelineFileChangeSummary | null
    }
  >()

  for (const [turnId, message] of lastAssistantTextMessageByTurnId.entries()) {
    const durationMs = completedWorkDurationByMessageId.get(message.info.id)
    if (durationMs == null) {
      continue
    }

    const turnChangeTotals = fileChangeTotalsByTurnId.get(turnId)
    const changedFilesSummary =
      !turnChangeTotals || turnChangeTotals.size === 0
        ? null
        : (() => {
            const entries = Array.from(turnChangeTotals.entries())
            const [firstPath] = entries[0]
            const totalAdded = entries.reduce((sum, [, totals]) => sum + totals.added, 0)
            const totalRemoved = entries.reduce((sum, [, totals]) => sum + totals.removed, 0)

            return {
              fileCount: entries.length,
              label:
                entries.length === 1
                  ? firstPath.split(/[\\/]/).filter(Boolean).at(-1) ?? firstPath
                  : `${entries.length} files`,
              added: totalAdded,
              removed: totalRemoved,
            }
          })()

    completedFooterByMessageId.set(message.info.id, {
      durationMs,
      changedFilesSummary,
    })
  }

  const childSessionData = childSessions
    ? new Map(
        Array.from(childSessions.entries()).map(([id, state]) => [
          id,
          {
            session: state.session,
            toolParts: state.toolParts,
            isActive: state.isActive,
          },
        ])
      )
    : undefined
  const hasCollabTimelineItem = messages.some(
    (message) => message.info.itemType === "collabAgentToolCall"
  )
  const orphanChildSessions =
    !childSessionData || childSessionData.size === 0 || hasCollabTimelineItem
      ? []
      : Array.from(childSessionData.values())

  return {
    renderedMessages,
    timelineBlocks: buildTimelineBlocks(renderedMessages),
    approvalStateByMessageId: buildApprovalStateByMessageId(
      renderedMessages,
      approvalPromptState,
      approvalDisplayState
    ),
    latestTurnLastAssistantTextMessage,
    latestTurnLastAssistantTextMessageId,
    latestTurnChangedFilesSummary,
    completedWorkDurationByMessageId,
    completedFooterByMessageId,
    childSessionData,
    orphanChildSessions,
  }
}
