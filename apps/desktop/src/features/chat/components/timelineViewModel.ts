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
  type TimelineFileChangeEntry,
  type TimelineBlock,
} from "./timelineActivity"

export interface TimelineFileChangeSummary {
  fileCount: number
  label: string
  added: number
  removed: number
  entries: Array<{
    path: string
    label: string
    added: number
    removed: number
    changes: TimelineFileChangeEntry[]
  }>
}

export interface ChatTimelineViewModel {
  renderedMessages: MessageWithParts[]
  timelineBlocks: TimelineBlock[]
  approvalStateByMessageId: Map<string, RuntimeApprovalDisplayState>
  latestTurnFooterMessage: MessageWithParts | null
  latestTurnFooterMessageId: string | null
  latestTurnStreamingTextMessageId: string | null
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

function getFileLabel(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function buildFileChangeSummary(
  changeTotals: Map<string, { added: number; removed: number; changes: TimelineFileChangeEntry[] }>
): TimelineFileChangeSummary | null {
  if (changeTotals.size === 0) {
    return null
  }

  const entries = Array.from(changeTotals.entries()).map(([path, totals]) => ({
    path,
    label: getFileLabel(path),
    added: totals.added,
    removed: totals.removed,
    changes: totals.changes,
  }))
  const totalAdded = entries.reduce((sum, entry) => sum + entry.added, 0)
  const totalRemoved = entries.reduce((sum, entry) => sum + entry.removed, 0)

  return {
    fileCount: entries.length,
    label: entries.length === 1 ? entries[0]?.label ?? entries[0]?.path ?? "file" : `${entries.length} files`,
    added: totalAdded,
    removed: totalRemoved,
    entries,
  }
}

function accumulateFileChanges(
  changeTotals: Map<string, { added: number; removed: number; changes: TimelineFileChangeEntry[] }>,
  changes: TimelineFileChangeEntry[]
) {
  for (const change of changes) {
    const current = changeTotals.get(change.path) ?? { added: 0, removed: 0, changes: [] }
    const diffTotals = countDiffLines(change.diff)

    changeTotals.set(change.path, {
      added: current.added + diffTotals.added,
      removed: current.removed + diffTotals.removed,
      changes: [...current.changes, change],
    })
  }
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

function isAssistantWorkMessage(message: MessageWithParts): boolean {
  return message.info.role === "assistant" && message.info.itemType !== "providerNotice"
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
  const latestTurnFooterMessage =
    [...latestTurnMessages].reverse().find(isAssistantWorkMessage) ?? null
  const latestTurnFooterMessageId = latestTurnFooterMessage?.info.id ?? null
  const latestTurnStreamingTextMessageId =
    [...latestTurnMessages]
      .reverse()
      .find(
        (message) =>
          isAssistantWorkMessage(message) &&
          message.parts.some((part) => part.type === "text" && part.text.trim())
      )?.info.id ?? null
  const changeTotals = new Map<string, { added: number; removed: number; changes: TimelineFileChangeEntry[] }>()
  for (const candidate of latestTurnMessages) {
    if (candidate.info.itemType !== "fileChange") {
      continue
    }

    const output = getToolPartFromMessage(candidate)?.state.output
    const source =
      output && typeof output === "object" && "changes" in output
        ? (output as { changes?: unknown[] }).changes
        : undefined

    accumulateFileChanges(changeTotals, getFileChangeEntries(source))
  }

  const latestTurnChangedFilesSummary =
    latestTurnFooterMessageId == null || changeTotals.size === 0
      ? null
      : buildFileChangeSummary(changeTotals)

  const earliestTimestampByTurnId = new Map<string, number>()
  const completedWorkDurationByMessageId = new Map<string, number>()
  const lastAssistantMessageByTurnId = new Map<string, MessageWithParts>()
  const fileChangeTotalsByTurnId = new Map<
    string,
    Map<string, { added: number; removed: number; changes: TimelineFileChangeEntry[] }>
  >()
  let latestUserTimestamp: number | null = null

  for (const message of renderedMessages) {
    if (message.info.role === "user") {
      latestUserTimestamp = message.info.createdAt
      continue
    }

    if (message.info.itemType === "providerNotice") {
      continue
    }

    const turnId = message.info.turnId
    if (!turnId) {
      continue
    }

    const existingTimestamp = earliestTimestampByTurnId.get(turnId)
    if (existingTimestamp == null) {
      earliestTimestampByTurnId.set(turnId, latestUserTimestamp ?? message.info.createdAt)
    } else {
      earliestTimestampByTurnId.set(turnId, Math.min(existingTimestamp, message.info.createdAt))
    }

    if (message.info.itemType === "fileChange") {
      const output = getToolPartFromMessage(message)?.state.output
      const source =
        output && typeof output === "object" && "changes" in output
          ? (output as { changes?: unknown[] }).changes
          : undefined
      const turnChangeTotals =
        fileChangeTotalsByTurnId.get(turnId) ??
        new Map<string, { added: number; removed: number; changes: TimelineFileChangeEntry[] }>()

      accumulateFileChanges(turnChangeTotals, getFileChangeEntries(source))

      fileChangeTotalsByTurnId.set(turnId, turnChangeTotals)
    }
  }

  for (const message of renderedMessages) {
    if (!isAssistantWorkMessage(message)) {
      continue
    }

    const turnId = message.info.turnId
    if (!turnId) {
      continue
    }

    const startTime = earliestTimestampByTurnId.get(turnId)
    if (startTime == null) {
      continue
    }

    completedWorkDurationByMessageId.set(
      message.info.id,
      Math.max(0, message.info.createdAt - startTime)
    )
    lastAssistantMessageByTurnId.set(turnId, message)
  }

  const completedFooterByMessageId = new Map<
    string,
    {
      durationMs: number
      changedFilesSummary: TimelineFileChangeSummary | null
    }
  >()

  for (const [turnId, message] of lastAssistantMessageByTurnId.entries()) {
    const durationMs = completedWorkDurationByMessageId.get(message.info.id)
    if (durationMs == null) {
      continue
    }

    const turnChangeTotals = fileChangeTotalsByTurnId.get(turnId)
    const changedFilesSummary = turnChangeTotals ? buildFileChangeSummary(turnChangeTotals) : null

    completedFooterByMessageId.set(message.info.id, {
      durationMs,
      changedFilesSummary,
    })
  }

  const childSessionData = childSessions && childSessions.size > 0
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
    latestTurnFooterMessage,
    latestTurnFooterMessageId,
    latestTurnStreamingTextMessageId,
    latestTurnChangedFilesSummary,
    completedWorkDurationByMessageId,
    completedFooterByMessageId,
    childSessionData,
    orphanChildSessions,
  }
}
