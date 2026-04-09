import { measureElement as measureVirtualElement, useVirtualizer } from "@tanstack/react-virtual"
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { Project, ProjectWorktree } from "@/features/workspace/types"
import type {
  ChildSessionState,
  MessageWithParts,
  RuntimeApprovalDisplayState,
  RuntimePromptState,
} from "../types"
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "./ai-elements/conversation"
import {
  Message as MessageComponent,
  MessageContent,
} from "./ai-elements/message"
import { CheckCircle, Copy, File } from "@/components/icons"
import { LoadingDots } from "@/features/shared/components/ui/loading-dots"
import { useStickToBottomContext } from "use-stick-to-bottom"
import { ChatImagePreviewModal } from "./ChatImagePreviewModal"
import {
  ChatTimelineItem,
  InlineSubagentActivity,
  type ChatImagePreviewRequest,
} from "./ChatTimelineItem"
import { formatElapsedDuration, useElapsedDuration } from "./workDuration"
import { TurnStepsDropdown } from "./TurnStepsDropdown"
import {
  buildChatTimelineViewModel,
  type TimelineFileChangeSummary,
} from "./timelineViewModel"
import {
  getToolPart,
  type TimelineBlock,
} from "./timelineActivity"
import type { ChildSessionData } from "./agent-activity/AgentActivitySubagent"
import { getMessageAttachmentParts, getMessageTextContent } from "../domain/runtimeMessages"

interface ChatMessagesProps {
  threadKey: string
  messages: MessageWithParts[]
  status: "idle" | "connecting" | "streaming" | "error"
  activePromptState?: RuntimePromptState | null
  selectedProject?: Project | null
  selectedWorktree?: ProjectWorktree | null
  childSessions?: Map<string, ChildSessionState>
}

interface LatestTurnDropdownBlock {
  type: "turnStepsDropdown"
  key: string
  messages: MessageWithParts[]
}

type DisplayBlock = TimelineBlock | LatestTurnDropdownBlock

type CompletedFooterStateByMessageId = Map<string, {
  durationMs: number
  changedFilesSummary: TimelineFileChangeSummary | null
}>

interface PreparedDisplayBlock {
  block: DisplayBlock
  key: string
  paddingTop: number
}

const ALWAYS_UNVIRTUALIZED_TAIL_BLOCKS = 8
const SAME_ROLE_BLOCK_GAP_PX = 12
const ROLE_CHANGE_BLOCK_GAP_PX = 28
const DEFAULT_TIMELINE_WIDTH_PX = 723
const ESTIMATED_TEXT_LINE_HEIGHT_PX = 24
const USER_MESSAGE_WIDTH_RATIO = 0.78
const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 80
const ESTIMATED_CODE_LINE_HEIGHT_PX = 20
const ESTIMATED_MARKDOWN_BLOCK_GAP_PX = 16

function getMessageText(message: MessageWithParts): string {
  return getMessageTextContent(message.parts)
}

function hasRenderableMessageContent(message: MessageWithParts): boolean {
  return message.parts.some((part) =>
    part.type === "tool" ||
    part.type === "attachment" ||
    (part.type === "text" && part.text.trim().length > 0)
  )
}

function dedupeMessagesByLastId(messages: MessageWithParts[]): MessageWithParts[] {
  const lastIndexById = new Map<string, number>()

  messages.forEach((message, index) => {
    lastIndexById.set(message.info.id, index)
  })

  return messages.filter((message, index) => lastIndexById.get(message.info.id) === index)
}

function getTurnCollapsedMessagesByFooterId(
  messages: MessageWithParts[],
  status: "idle" | "connecting" | "streaming" | "error"
): Map<string, MessageWithParts[]> {
  const collapsedMessagesByFooterId = new Map<string, MessageWithParts[]>()
  const dedupedMessages = dedupeMessagesByLastId(messages)

  if (dedupedMessages.length === 0) {
    return collapsedMessagesByFooterId
  }

  let turnStartIndex = 0

  const processTurn = (turnEndIndex: number) => {
    if (turnEndIndex < turnStartIndex) {
      return
    }

    const turnMessages = dedupedMessages.slice(turnStartIndex, turnEndIndex + 1)
    const footerMessage = [...turnMessages].reverse().find((message) => message.info.role === "assistant")
    if (!footerMessage || !getMessageText(footerMessage).trim()) {
      return
    }

    if (status === "streaming" && turnEndIndex === dedupedMessages.length - 1) {
      return
    }

    const collapsedMessages = turnMessages.filter(
      (message) =>
        message.info.role === "assistant" &&
        message.info.id !== footerMessage.info.id &&
        hasRenderableMessageContent(message)
    )

    if (collapsedMessages.length === 0) {
      return
    }

    collapsedMessagesByFooterId.set(footerMessage.info.id, collapsedMessages)
  }

  for (let index = 0; index < dedupedMessages.length; index++) {
    if (dedupedMessages[index]?.info.role !== "user") {
      continue
    }

    processTurn(index - 1)
    turnStartIndex = index + 1
  }

  processTurn(dedupedMessages.length - 1)

  return collapsedMessagesByFooterId
}

function buildDisplayBlocks(
  timelineBlocks: TimelineBlock[],
  collapsedMessagesByFooterId: Map<string, MessageWithParts[]>
): DisplayBlock[] {
  if (collapsedMessagesByFooterId.size === 0) {
    return timelineBlocks
  }

  const collapsedMessageIds = new Set(
    Array.from(collapsedMessagesByFooterId.values()).flatMap((groupMessages) =>
      groupMessages.map((message) => message.info.id)
    )
  )

  return timelineBlocks.flatMap((block) => {
    if (block.type !== "message") {
      return [block]
    }

    if (collapsedMessageIds.has(block.message.info.id)) {
      return []
    }

    const collapsedMessages = collapsedMessagesByFooterId.get(block.message.info.id)
    if (collapsedMessages) {

      return [
        {
          type: "turnStepsDropdown" as const,
          key: `turn-steps-dropdown:${block.message.info.id}`,
          messages: collapsedMessages,
        },
        block,
      ]
    }

    return [block]
  })
}

function getDisplayBlockRole(block: DisplayBlock): "user" | "assistant" | null {
  if (block.type === "message") {
    return block.message.info.role
  }

  return "assistant"
}

function getDisplayBlockPaddingTop(
  previousBlock: DisplayBlock | null,
  currentBlock: DisplayBlock
): number {
  const previousRole = previousBlock ? getDisplayBlockRole(previousBlock) : null
  const currentRole = getDisplayBlockRole(currentBlock)

  if (previousRole == null) {
    return 0
  }

  return previousRole === currentRole ? SAME_ROLE_BLOCK_GAP_PX : ROLE_CHANGE_BLOCK_GAP_PX
}

function estimateWrappedTextLineCount(text: string, widthPx: number): number {
  const normalized = text.trim()
  if (!normalized) {
    return 0
  }

  const approximateCharactersPerLine = Math.max(18, Math.floor(widthPx / 7.4))

  return normalized.split("\n").reduce((total, rawLine) => {
    const line = rawLine.trimEnd()

    if (!line.length) {
      return total + 1
    }

    return total + Math.max(1, Math.ceil(line.length / approximateCharactersPerLine))
  }, 0)
}

function countNonEmptyLines(text: string): number {
  return text.split("\n").filter((line) => line.trim().length > 0).length
}

function estimateMarkdownBlockHeight(markdown: string, widthPx: number): number {
  const trimmed = markdown.trim()
  if (!trimmed) {
    return ESTIMATED_TEXT_LINE_HEIGHT_PX
  }

  const blocks = trimmed
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)

  if (blocks.length === 0) {
    return ESTIMATED_TEXT_LINE_HEIGHT_PX
  }

  let totalHeight = 0

  for (const block of blocks) {
    if (/^```/.test(block)) {
      totalHeight += Math.max(2, countNonEmptyLines(block) - 1) * ESTIMATED_CODE_LINE_HEIGHT_PX + 20
      continue
    }

    if (/^(?:[-*+] |\d+\. )/m.test(block)) {
      totalHeight += estimateWrappedTextLineCount(block, widthPx - 24) * ESTIMATED_TEXT_LINE_HEIGHT_PX + 8
      continue
    }

    if (/^> /m.test(block)) {
      totalHeight += estimateWrappedTextLineCount(block.replace(/^>\s?/gm, ""), widthPx - 18) * ESTIMATED_TEXT_LINE_HEIGHT_PX + 8
      continue
    }

    if (/^#{1,6}\s/m.test(block)) {
      totalHeight += estimateWrappedTextLineCount(block.replace(/^#{1,6}\s+/gm, ""), widthPx) * (ESTIMATED_TEXT_LINE_HEIGHT_PX + 4)
      continue
    }

    totalHeight += estimateWrappedTextLineCount(block, widthPx) * ESTIMATED_TEXT_LINE_HEIGHT_PX
  }

  return totalHeight + Math.max(0, blocks.length - 1) * ESTIMATED_MARKDOWN_BLOCK_GAP_PX
}

function estimateDisplayBlockHeight(
  preparedBlock: PreparedDisplayBlock,
  timelineWidthPx: number | null,
  status: "idle" | "connecting" | "streaming" | "error",
  latestTurnFooterMessageId: string | null,
  completedFooterByMessageId: CompletedFooterStateByMessageId
): number {
  const contentWidth = Math.max(320, timelineWidthPx ?? DEFAULT_TIMELINE_WIDTH_PX)

  if (preparedBlock.block.type === "turnStepsDropdown") {
    return preparedBlock.paddingTop + 56
  }

  const message = preparedBlock.block.message
  const toolPart = getToolPart(message.parts)
  const text = getMessageText(message)
  const attachments = getMessageAttachmentParts(message.parts)
  let estimatedHeight = 0

  if (message.info.role === "user") {
    const userWidth = Math.max(240, Math.floor(contentWidth * USER_MESSAGE_WIDTH_RATIO) - 32)
    const lineCount = estimateWrappedTextLineCount(text, userWidth)
    const attachmentsHeight = attachments.reduce((total, attachment) => {
      return total + (attachment.kind === "image" ? 170 : 92)
    }, 0)
    estimatedHeight =
      34 +
      lineCount * ESTIMATED_TEXT_LINE_HEIGHT_PX +
      attachmentsHeight +
      (attachments.length > 0 && lineCount > 0 ? 12 : 0) +
      Math.max(0, attachments.length - 1) * 8
  } else if (toolPart) {
    estimatedHeight =
      message.info.itemType === "fileChange"
        ? 68
        : message.info.itemType === "commandExecution"
          ? 62
          : 54
  } else {
    const assistantWidth = Math.max(320, contentWidth - 8)
    estimatedHeight = 20 + estimateMarkdownBlockHeight(text, assistantWidth)

    if (
      message.info.itemType === "plan" ||
      message.info.itemType === "approval" ||
      message.info.itemType === "enteredReviewMode" ||
      message.info.itemType === "exitedReviewMode"
    ) {
      estimatedHeight += 20
    }
  }

  const completedFooter = completedFooterByMessageId.get(message.info.id)
  const shouldRenderInlineCompletedFooter =
    completedFooter != null &&
    !(status === "streaming" && message.info.id === latestTurnFooterMessageId)

  if (shouldRenderInlineCompletedFooter) {
    const changedFilesCount = completedFooter?.changedFilesSummary?.entries.length ?? 0
    estimatedHeight += changedFilesCount > 0 ? 56 : 36
  }

  return preparedBlock.paddingTop + Math.max(estimatedHeight, 52)
}

function getFirstUnvirtualizedBlockIndex(
  preparedDisplayBlocks: PreparedDisplayBlock[],
  status: "idle" | "connecting" | "streaming" | "error",
  latestTurnFooterMessageId: string | null,
  latestTurnStreamingTextMessageId: string | null
): number {
  const firstTailBlockIndex = Math.max(
    preparedDisplayBlocks.length - ALWAYS_UNVIRTUALIZED_TAIL_BLOCKS,
    0
  )

  if (status !== "streaming") {
    return firstTailBlockIndex
  }

  const currentTurnAnchorMessageId =
    latestTurnStreamingTextMessageId ?? latestTurnFooterMessageId

  if (!currentTurnAnchorMessageId) {
    return firstTailBlockIndex
  }

  let currentTurnAnchorIndex = -1

  for (let index = preparedDisplayBlocks.length - 1; index >= 0; index -= 1) {
    const preparedBlock = preparedDisplayBlocks[index]
    if (
      preparedBlock?.block.type === "message" &&
      preparedBlock.block.message.info.id === currentTurnAnchorMessageId
    ) {
      currentTurnAnchorIndex = index
      break
    }
  }

  if (currentTurnAnchorIndex < 0) {
    return firstTailBlockIndex
  }

  for (let index = currentTurnAnchorIndex - 1; index >= 0; index -= 1) {
    const candidate = preparedDisplayBlocks[index]?.block
    if (!candidate || candidate.type !== "message") {
      continue
    }

    if (candidate.message.info.role === "user") {
      return Math.min(index, firstTailBlockIndex)
    }
  }

  return Math.min(currentTurnAnchorIndex, firstTailBlockIndex)
}

export function ChatMessages({
  threadKey,
  messages,
  status,
  activePromptState = null,
  selectedProject,
  selectedWorktree,
  childSessions,
}: ChatMessagesProps) {
  const timelineViewModel = useMemo(
    () =>
      buildChatTimelineViewModel({
        messages,
        activePromptState,
        childSessions,
      }),
    [activePromptState, childSessions, messages]
  )
  const {
    renderedMessages,
    timelineBlocks,
    approvalStateByMessageId,
    latestTurnFooterMessage,
    latestTurnFooterMessageId,
    latestTurnStreamingTextMessageId,
    latestTurnChangedFilesSummary,
    completedWorkDurationByMessageId,
    completedFooterByMessageId,
    childSessionData,
    orphanChildSessions,
  } = timelineViewModel
  const hasContent = renderedMessages.length > 0
  const [activeWorkStartTime, setActiveWorkStartTime] = useState<number | null>(null)
  const [lastCompletedWork, setLastCompletedWork] = useState<{
    messageId: string
    durationMs: number
  } | null>(null)
  const [previewImage, setPreviewImage] = useState<ChatImagePreviewRequest | null>(null)
  const previousStatusRef = useRef(status)

  useEffect(() => {
    setActiveWorkStartTime(status === "streaming" ? Date.now() : null)
    setLastCompletedWork(null)
    setPreviewImage(null)
    previousStatusRef.current = status
  }, [threadKey])

  useEffect(() => {
    const previousStatus = previousStatusRef.current

    if (status === "streaming" && activeWorkStartTime == null) {
      setActiveWorkStartTime(Date.now())
      setLastCompletedWork(null)
    } else if (previousStatus !== "streaming" && status === "streaming") {
      setActiveWorkStartTime(Date.now())
      setLastCompletedWork(null)
    }

    if (previousStatus === "streaming" && status !== "streaming" && activeWorkStartTime != null) {
      if (latestTurnFooterMessage) {
        setLastCompletedWork({
          messageId: latestTurnFooterMessage.info.id,
          durationMs: Date.now() - activeWorkStartTime,
        })
      }

      setActiveWorkStartTime(null)
    }

    previousStatusRef.current = status
  }, [activeWorkStartTime, latestTurnFooterMessage, status])
  const resolvedCompletedFooterByMessageId = useMemo(() => {
    const resolved = new Map(completedFooterByMessageId)

    if (lastCompletedWork?.messageId) {
      const previousFooter = resolved.get(lastCompletedWork.messageId)

      resolved.set(lastCompletedWork.messageId, {
        durationMs: lastCompletedWork.durationMs,
        changedFilesSummary: previousFooter?.changedFilesSummary ?? latestTurnChangedFilesSummary,
      })
    }

    return resolved
  }, [completedFooterByMessageId, lastCompletedWork, latestTurnChangedFilesSummary])
  const latestTurnDurationMs =
    latestTurnFooterMessageId == null
      ? null
      : latestTurnFooterMessageId === lastCompletedWork?.messageId
        ? lastCompletedWork.durationMs
        : (completedWorkDurationByMessageId.get(latestTurnFooterMessageId) ?? null)
  const shouldRenderLatestTurnFooter =
    status === "connecting" || (status === "streaming" && activeWorkStartTime != null)

  const collapsedMessagesByFooterId = useMemo(
    () => getTurnCollapsedMessagesByFooterId(renderedMessages, status),
    [renderedMessages, status]
  )
  const displayBlocks = useMemo(
    () => buildDisplayBlocks(timelineBlocks, collapsedMessagesByFooterId)
      .filter((block) => block.type !== "message" || hasRenderableMessageContent(block.message)),
    [collapsedMessagesByFooterId, timelineBlocks]
  )
  const preparedDisplayBlocks = useMemo(
    () =>
      displayBlocks.map((block, index) => ({
        block,
        key: block.type === "message" ? block.key : block.key,
        paddingTop: getDisplayBlockPaddingTop(
          index > 0 ? displayBlocks[index - 1] ?? null : null,
          block
        ),
      })),
    [displayBlocks]
  )
  const [preparedThreadKey, setPreparedThreadKey] = useState(threadKey)
  const isThreadPrepared = preparedThreadKey === threadKey
  const handleOpenImagePreview = useMemo(
    () => (preview: ChatImagePreviewRequest) => {
      setPreviewImage(preview)
    },
    []
  )

  if (!hasContent) {
    return null
  }

  return (
    <Conversation
      key={threadKey}
      className={isThreadPrepared ? "h-full" : "h-full invisible"}
    >
      <ChatAutoScroll
        threadKey={threadKey}
        messages={messages}
        status={status}
        onThreadPrepared={setPreparedThreadKey}
      />
      <ConversationContent className="mx-auto flex w-full max-w-[803px] flex-col gap-0 px-10 pb-10">
        <>
          <HybridTimelineBlocks
            preparedDisplayBlocks={preparedDisplayBlocks}
            childSessions={childSessionData}
            approvalStateByMessageId={approvalStateByMessageId}
            completedFooterByMessageId={resolvedCompletedFooterByMessageId}
            latestTurnFooterMessageId={latestTurnFooterMessageId}
            latestTurnStreamingTextMessageId={latestTurnStreamingTextMessageId}
            status={status}
            worktreePath={selectedWorktree?.path ?? null}
            onOpenImagePreview={handleOpenImagePreview}
          />
          {orphanChildSessions.length > 0 ? (
            <div className="space-y-3">
              {orphanChildSessions.map((childSession) => (
                <InlineSubagentActivity key={childSession.session.id} childSession={childSession} />
              ))}
            </div>
          ) : null}
          {shouldRenderLatestTurnFooter ? (
            <AssistantTurnFooter
              activityState={status === "connecting" ? "connecting" : "streaming"}
              startTime={status === "streaming" ? activeWorkStartTime : null}
              completedDurationMs={latestTurnDurationMs ?? undefined}
            />
          ) : null}
        </>
      </ConversationContent>
      <ConversationScrollButton />
      <ChatImagePreviewModal
        image={previewImage}
        open={previewImage != null}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewImage(null)
          }
        }}
      />
    </Conversation>
  )
}

function HybridTimelineBlocks({
  preparedDisplayBlocks,
  childSessions,
  approvalStateByMessageId,
  completedFooterByMessageId,
  latestTurnFooterMessageId,
  latestTurnStreamingTextMessageId,
  status,
  worktreePath,
  onOpenImagePreview,
}: {
  preparedDisplayBlocks: PreparedDisplayBlock[]
  childSessions: Map<string, ChildSessionData>
  approvalStateByMessageId: Map<string, RuntimeApprovalDisplayState | null>
  completedFooterByMessageId: CompletedFooterStateByMessageId
  latestTurnFooterMessageId: string | null
  latestTurnStreamingTextMessageId: string | null
  status: "idle" | "connecting" | "streaming" | "error"
  worktreePath?: string | null
  onOpenImagePreview?: (preview: ChatImagePreviewRequest) => void
}) {
  const { scrollRef } = useStickToBottomContext()
  const timelineRootRef = useRef<HTMLDivElement | null>(null)
  const [timelineWidthPx, setTimelineWidthPx] = useState<number | null>(null)

  useLayoutEffect(() => {
    const timelineRoot = timelineRootRef.current
    if (!timelineRoot) {
      return
    }

    const updateWidth = (nextWidth: number) => {
      setTimelineWidthPx((previousWidth) => {
        if (previousWidth !== null && Math.abs(previousWidth - nextWidth) < 0.5) {
          return previousWidth
        }

        return nextWidth
      })
    }

    updateWidth(timelineRoot.getBoundingClientRect().width)

    if (typeof ResizeObserver === "undefined") {
      return
    }

    const observer = new ResizeObserver(() => {
      updateWidth(timelineRoot.getBoundingClientRect().width)
    })
    observer.observe(timelineRoot)

    return () => {
      observer.disconnect()
    }
  }, [preparedDisplayBlocks.length])

  const firstUnvirtualizedBlockIndex = useMemo(
    () =>
      getFirstUnvirtualizedBlockIndex(
        preparedDisplayBlocks,
        status,
        latestTurnFooterMessageId,
        latestTurnStreamingTextMessageId
      ),
    [
      latestTurnFooterMessageId,
      latestTurnStreamingTextMessageId,
      preparedDisplayBlocks,
      status,
    ]
  )
  const measurementScopeKey =
    timelineWidthPx === null ? "width:unknown" : `width:${Math.round(timelineWidthPx)}`

  const rowVirtualizer = useVirtualizer({
    count: firstUnvirtualizedBlockIndex,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index: number) =>
      `${measurementScopeKey}:${preparedDisplayBlocks[index]?.key ?? String(index)}`,
    estimateSize: (index: number) => {
      const preparedBlock = preparedDisplayBlocks[index]
      if (!preparedBlock) {
        return 96
      }

      return estimateDisplayBlockHeight(
        preparedBlock,
        timelineWidthPx,
        status,
        latestTurnFooterMessageId,
        completedFooterByMessageId
      )
    },
    measureElement: measureVirtualElement,
    useAnimationFrameWithResizeObserver: true,
    overscan: 8,
  })

  useEffect(() => {
    if (timelineWidthPx === null) {
      return
    }

    rowVirtualizer.measure()
  }, [rowVirtualizer, timelineWidthPx])
  useEffect(() => {
    rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = (
      item,
      _delta,
      instance
    ) => {
      const viewportHeight = instance.scrollRect?.height ?? 0
      const scrollOffset = instance.scrollOffset ?? 0
      const itemIntersectsViewport =
        item.end > scrollOffset && item.start < scrollOffset + viewportHeight

      if (itemIntersectsViewport) {
        return false
      }

      const remainingDistance = instance.getTotalSize() - (scrollOffset + viewportHeight)
      return remainingDistance > AUTO_SCROLL_BOTTOM_THRESHOLD_PX
    }

    return () => {
      rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined
    }
  }, [rowVirtualizer])

  const virtualItems = rowVirtualizer.getVirtualItems()
  const tailBlocks = preparedDisplayBlocks.slice(firstUnvirtualizedBlockIndex)

  return (
    <div ref={timelineRootRef} className="flex w-full flex-col">
      {firstUnvirtualizedBlockIndex > 0 ? (
        <div className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
          {virtualItems.map((virtualItem) => {
            const preparedBlock = preparedDisplayBlocks[virtualItem.index]
            if (!preparedBlock) {
              return null
            }

            return (
              <div
                key={virtualItem.key}
                ref={rowVirtualizer.measureElement}
                className="absolute left-0 top-0 w-full"
                data-index={virtualItem.index}
                style={{ transform: `translateY(${virtualItem.start}px)` }}
              >
                <DisplayBlockRow
                  preparedBlock={preparedBlock}
                  childSessions={childSessions}
                  approvalStateByMessageId={approvalStateByMessageId}
                  completedFooterByMessageId={completedFooterByMessageId}
                  latestTurnFooterMessageId={latestTurnFooterMessageId}
                  latestTurnStreamingTextMessageId={latestTurnStreamingTextMessageId}
                  status={status}
                  worktreePath={worktreePath}
                  onOpenImagePreview={onOpenImagePreview}
                />
              </div>
            )
          })}
        </div>
      ) : null}
      {tailBlocks.map((preparedBlock) => (
        <DisplayBlockRow
          key={preparedBlock.key}
          preparedBlock={preparedBlock}
          childSessions={childSessions}
          approvalStateByMessageId={approvalStateByMessageId}
          completedFooterByMessageId={completedFooterByMessageId}
          latestTurnFooterMessageId={latestTurnFooterMessageId}
          latestTurnStreamingTextMessageId={latestTurnStreamingTextMessageId}
          status={status}
          worktreePath={worktreePath}
          onOpenImagePreview={onOpenImagePreview}
        />
      ))}
    </div>
  )
}

function DisplayBlockRow({
  preparedBlock,
  childSessions,
  approvalStateByMessageId,
  completedFooterByMessageId,
  latestTurnFooterMessageId,
  latestTurnStreamingTextMessageId,
  status,
  worktreePath,
  onOpenImagePreview,
}: {
  preparedBlock: PreparedDisplayBlock
  childSessions: Map<string, ChildSessionData>
  approvalStateByMessageId: Map<string, RuntimeApprovalDisplayState | null>
  completedFooterByMessageId: CompletedFooterStateByMessageId
  latestTurnFooterMessageId: string | null
  latestTurnStreamingTextMessageId: string | null
  status: "idle" | "connecting" | "streaming" | "error"
  worktreePath?: string | null
  onOpenImagePreview?: (preview: ChatImagePreviewRequest) => void
}) {
  const block = preparedBlock.block

  return (
    <div
      className="w-full"
      style={preparedBlock.paddingTop > 0 ? { paddingTop: `${preparedBlock.paddingTop}px` } : undefined}
    >
      {block.type === "turnStepsDropdown" ? (
        <TurnStepsDropdown
          messages={block.messages}
          childSessions={childSessions}
          approvalStateByMessageId={approvalStateByMessageId}
          worktreePath={worktreePath}
          onOpenImagePreview={onOpenImagePreview}
        />
      ) : (
        <>
          <ChatTimelineItem
            message={block.message}
            childSessions={childSessions}
            approvalState={approvalStateByMessageId.get(block.message.info.id) ?? null}
            isStreaming={
              status === "streaming" &&
              block.message.info.id === latestTurnStreamingTextMessageId
            }
            worktreePath={worktreePath}
            onOpenImagePreview={onOpenImagePreview}
          />
          {completedFooterByMessageId.get(block.message.info.id) != null &&
          !(status === "streaming" && block.message.info.id === latestTurnFooterMessageId) ? (
            <AssistantTurnFooter
              startTime={null}
              completedDurationMs={completedFooterByMessageId.get(block.message.info.id)?.durationMs}
              copyText={getMessageText(block.message)}
              changedFilesSummary={
                completedFooterByMessageId.get(block.message.info.id)?.changedFilesSummary
              }
            />
          ) : null}
        </>
      )}
    </div>
  )
}

function ChatAutoScroll({
  threadKey,
  messages,
  status,
  onThreadPrepared,
}: {
  threadKey: string
  messages: MessageWithParts[]
  status: "idle" | "connecting" | "streaming" | "error"
  onThreadPrepared: (threadKey: string) => void
}) {
  const { scrollToBottom, state } = useStickToBottomContext()
  const previousLastMessageIdRef = useRef<string | null>(null)
  const previousStatusRef = useRef<typeof status>(status)

  const lastMessage = messages[messages.length - 1] ?? null
  const lastMessageId = lastMessage?.info.id ?? null

  useLayoutEffect(() => {
    const targetScrollTop = state.calculatedTargetScrollTop
    state.scrollTop = targetScrollTop
    state.lastScrollTop = targetScrollTop
    previousLastMessageIdRef.current = lastMessageId
    previousStatusRef.current = status
    onThreadPrepared(threadKey)
  }, [lastMessageId, onThreadPrepared, state, status, threadKey])

  useEffect(() => {
    const previousLastMessageId = previousLastMessageIdRef.current
    const previousStatus = previousStatusRef.current
    const hasNewMessage = !!lastMessageId && lastMessageId !== previousLastMessageId
    const userJustSentMessage = hasNewMessage && lastMessage?.info.role === "user"
    const agentJustStartedResponding = status === "streaming" && previousStatus !== "streaming"

    if (userJustSentMessage || agentJustStartedResponding) {
      requestAnimationFrame(() => {
        void scrollToBottom("instant")
      })
    }

    previousLastMessageIdRef.current = lastMessageId
    previousStatusRef.current = status
  }, [lastMessage?.info.role, lastMessageId, scrollToBottom, status])

  return null
}

function AssistantTurnFooter({
  activityState,
  startTime,
  completedDurationMs,
  copyText,
  changedFilesSummary,
}: {
  activityState?: "connecting" | "streaming"
  startTime: number | null
  completedDurationMs?: number
  copyText?: string | null
  changedFilesSummary?: TimelineFileChangeSummary | null
}) {
  const [isCopied, setIsCopied] = useState(false)
  const isConnecting = activityState === "connecting"
  const isStreaming = activityState === "streaming"
  const isWorking = isConnecting || isStreaming
  const elapsed = useElapsedDuration(
    startTime,
    isStreaming,
    startTime != null && completedDurationMs != null ? startTime + completedDurationMs : undefined
  )
  const workLabel = isConnecting
    ? "Connecting"
    : isStreaming
    ? elapsed ?? formatElapsedDuration(0)
    : completedDurationMs != null && completedDurationMs > 0
      ? formatElapsedDuration(completedDurationMs)
      : null
  const canCopyMessage = !isWorking && Boolean(copyText?.trim())

  useEffect(() => {
    if (!isCopied) {
      return
    }

    const timeoutId = window.setTimeout(() => setIsCopied(false), 1800)
    return () => window.clearTimeout(timeoutId)
  }, [isCopied])

  const visibleChangedFiles = changedFilesSummary?.entries.slice(0, 4) ?? []
  const hiddenChangedFileCount =
    changedFilesSummary == null ? 0 : Math.max(0, changedFilesSummary.entries.length - visibleChangedFiles.length)

  return (
    <MessageComponent from="assistant">
      <MessageContent>
        <div className="mt-5 flex flex-wrap items-center gap-2 text-xs tracking-[0.01em] text-muted-foreground/80 tabular-nums">
          {isWorking ? (
            <LoadingDots
              className="shrink-0"
              variant={isConnecting ? "connecting" : "loading"}
            />
          ) : null}
          {workLabel ? <span>{workLabel}</span> : null}
          {canCopyMessage ? (
            <>
              {workLabel ? (
                <span aria-hidden="true" className="text-muted-foreground/45">
                  ·
                </span>
              ) : null}
              <button
                type="button"
                onClick={async () => {
                  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText || !copyText) {
                    return
                  }

                  await navigator.clipboard.writeText(copyText)
                  setIsCopied(true)
                }}
                className="inline-flex h-5 w-5 items-center justify-center rounded-sm p-0.5 text-muted-foreground/88 transition-colors hover:bg-muted/55 hover:text-foreground"
                aria-label="Copy message"
              >
                {isCopied ? <CheckCircle size={14} /> : <Copy size={15} />}
              </button>
            </>
          ) : null}
          {!isWorking && changedFilesSummary ? (
            <>
              {canCopyMessage ? (
                <span aria-hidden="true" className="text-muted-foreground/45">
                  ·
                </span>
              ) : null}
              <div className="flex flex-wrap items-center gap-1.5">
                {visibleChangedFiles.map((entry) => (
                  <span
                    key={entry.path}
                    className="inline-flex max-w-[180px] items-center gap-1.5 rounded-[0.35rem] border border-border/70 bg-background/65 px-2 py-1.5 text-[11px] leading-none text-foreground/88 shadow-[0_0_0_1px_rgba(255,255,255,0.015)_inset]"
                    title={entry.path}
                  >
                    <File size={11} className="shrink-0 text-[var(--color-chat-file-accent)]" />
                    <span className="truncate font-medium text-muted-foreground/92">
                      {entry.label}
                    </span>
                    {entry.added > 0 ? (
                      <span className="shrink-0 font-medium text-emerald-500">
                        +{entry.added}
                      </span>
                    ) : null}
                    {entry.removed > 0 ? (
                      <span className="shrink-0 font-medium text-red-500">
                        -{entry.removed}
                      </span>
                    ) : null}
                  </span>
                ))}
                {hiddenChangedFileCount > 0 ? (
                  <span className="inline-flex items-center rounded-[0.35rem] border border-border/60 bg-muted/25 px-2 py-1.5 text-[11px] leading-none text-muted-foreground/88">
                    +{hiddenChangedFileCount} more
                  </span>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </MessageContent>
    </MessageComponent>
  )
}
