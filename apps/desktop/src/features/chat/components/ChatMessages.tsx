import {
  useEffect,
  useLayoutEffect,
  useCallback,
  memo,
  useMemo,
  useRef,
  useState,
} from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { motion, useReducedMotion } from "framer-motion"
import { vcsTextClassNames } from "@/features/shared/appearance"
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
  useConversationScrollContext,
  useConversationScrollState,
} from "./ai-elements/conversation"
import {
  Message as MessageComponent,
  MessageContent,
} from "./ai-elements/message"
import { Check, Copy, File } from "@/components/icons"
import { LoadingDots } from "@/features/shared/components/ui/loading-dots"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/features/shared/components/ui/hover-card"
import { ChatImagePreviewModal } from "./ChatImagePreviewModal"
import {
  ChatTimelineItem,
  InlineSubagentActivity,
  type ChatImagePreviewRequest,
} from "./ChatTimelineItem"
import { FileChangeDiffCard } from "./FileChangeDiffCard"
import { formatElapsedDuration, useElapsedDuration } from "./workDuration"
import { TurnStepsDropdown } from "./TurnStepsDropdown"
import {
  buildChatTimelineViewModel,
  type TimelineFileChangeSummary,
} from "./timelineViewModel"
import {
  type TimelineBlock,
} from "./timelineActivity"
import type { ChildSessionData } from "./agent-activity/AgentActivitySubagent"
import { getMessageTextContent } from "../domain/runtimeMessages"
import { cn } from "@/lib/utils"
import { getTurnCollapsedMessagesByFooterId } from "./chatTimelineCollapse"

interface ChatMessagesProps {
  threadKey: string
  messages: MessageWithParts[]
  status: "idle" | "connecting" | "streaming" | "error"
  workStartedAt?: number | null
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

interface CompletedFooterState {
  durationMs: number
  changedFilesSummary: TimelineFileChangeSummary | null
}

type CompletedFooterStateByMessageId = Map<string, CompletedFooterState>

interface PreparedDisplayBlock {
  block: DisplayBlock
  key: string
  paddingTop: number
}

interface StablePreparedDisplayBlocksState {
  byKey: Map<string, PreparedDisplayBlock>
  result: PreparedDisplayBlock[]
}

const SAME_ROLE_BLOCK_GAP_PX = 12
const ROLE_CHANGE_BLOCK_GAP_PX = 28
const TIMELINE_OVERSCAN_ROWS = 8
const DEFAULT_ROW_ESTIMATE_PX = 104
const TURN_STEPS_ROW_ESTIMATE_PX = 68
const TOOL_ROW_ESTIMATE_PX = 96
const FILE_CHANGE_ROW_ESTIMATE_PX = 156
const USER_ROW_ESTIMATE_PX = 88
const TEXT_LINE_HEIGHT_ESTIMATE_PX = 22
const FALLBACK_TIMELINE_WIDTH_PX = 784
const ESTIMATED_AVERAGE_CHARACTER_WIDTH_PX = 7.2
const MIN_ESTIMATED_CHARS_PER_LINE = 1
const ALWAYS_MOUNTED_TAIL_BLOCK_COUNT = 4
const EMPTY_APPROVAL_STATE_BY_MESSAGE_ID = new Map<string, RuntimeApprovalDisplayState>()

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

function estimateTextHeight(text: string, timelineWidth: number): number {
  const trimmedText = text.trim()

  if (!trimmedText) {
    return TEXT_LINE_HEIGHT_ESTIMATE_PX
  }

  const estimatedCharsPerLine = Math.max(
    MIN_ESTIMATED_CHARS_PER_LINE,
    Math.floor(
      (Number.isFinite(timelineWidth) && timelineWidth > 0
        ? timelineWidth
        : FALLBACK_TIMELINE_WIDTH_PX) / ESTIMATED_AVERAGE_CHARACTER_WIDTH_PX
    )
  )
  const explicitLines = trimmedText.split("\n")
  const estimatedLineCount = explicitLines.reduce((lineCount, line) => {
    return lineCount + Math.max(1, Math.ceil(line.length / estimatedCharsPerLine))
  }, 0)

  return estimatedLineCount * TEXT_LINE_HEIGHT_ESTIMATE_PX
}

function estimateDisplayBlockSize(
  preparedBlock: PreparedDisplayBlock,
  timelineWidth: number
): number {
  const block = preparedBlock.block
  const paddingTop = preparedBlock.paddingTop

  if (block.type === "turnStepsDropdown") {
    return paddingTop + TURN_STEPS_ROW_ESTIMATE_PX + block.messages.length * 10
  }

  const message = block.message
  const text = getMessageText(message)
  const hasAttachment = message.parts.some((part) => part.type === "attachment")
  const toolPart = message.parts.find((part) => part.type === "tool")

  if (message.info.role === "user") {
    return (
      paddingTop +
      USER_ROW_ESTIMATE_PX +
      estimateTextHeight(text, timelineWidth) +
      (hasAttachment ? 42 : 0)
    )
  }

  if (toolPart) {
    return (
      paddingTop +
      (message.info.itemType === "fileChange" ? FILE_CHANGE_ROW_ESTIMATE_PX : TOOL_ROW_ESTIMATE_PX)
    )
  }

  return paddingTop + DEFAULT_ROW_ESTIMATE_PX + estimateTextHeight(text, timelineWidth)
}

function areMessageListsEqualById(
  currentMessages: MessageWithParts[],
  nextMessages: MessageWithParts[]
): boolean {
  if (currentMessages === nextMessages) {
    return true
  }

  if (currentMessages.length !== nextMessages.length) {
    return false
  }

  return currentMessages.every(
    (message, index) => message.info.id === nextMessages[index]?.info.id
  )
}

function isPreparedDisplayBlockUnchanged(
  currentBlock: PreparedDisplayBlock,
  nextBlock: PreparedDisplayBlock
): boolean {
  if (
    currentBlock.key !== nextBlock.key ||
    currentBlock.paddingTop !== nextBlock.paddingTop ||
    currentBlock.block.type !== nextBlock.block.type
  ) {
    return false
  }

  if (currentBlock.block.type === "turnStepsDropdown") {
    return (
      nextBlock.block.type === "turnStepsDropdown" &&
      areMessageListsEqualById(currentBlock.block.messages, nextBlock.block.messages)
    )
  }

  return (
    nextBlock.block.type === "message" &&
    currentBlock.block.message === nextBlock.block.message
  )
}

function computeStablePreparedDisplayBlocks(
  nextBlocks: PreparedDisplayBlock[],
  previousState: StablePreparedDisplayBlocksState
): StablePreparedDisplayBlocksState {
  const nextByKey = new Map<string, PreparedDisplayBlock>()
  let didChange = nextBlocks.length !== previousState.result.length

  const result = nextBlocks.map((nextBlock, index) => {
    const previousBlock = previousState.byKey.get(nextBlock.key)
    const resolvedBlock =
      previousBlock && isPreparedDisplayBlockUnchanged(previousBlock, nextBlock)
        ? previousBlock
        : nextBlock

    nextByKey.set(nextBlock.key, resolvedBlock)

    if (!didChange && previousState.result[index] !== resolvedBlock) {
      didChange = true
    }

    return resolvedBlock
  })

  return didChange ? { byKey: nextByKey, result } : previousState
}

function displayBlockContainsMessageId(block: DisplayBlock, messageId: string): boolean {
  if (block.type === "message") {
    return block.message.info.id === messageId
  }

  return block.messages.some((message) => message.info.id === messageId)
}

function getAlwaysMountedTailStartIndex(
  preparedDisplayBlocks: PreparedDisplayBlock[],
  latestTurnFooterMessageId: string | null,
  latestTurnStreamingTextMessageId: string | null
): number {
  if (preparedDisplayBlocks.length === 0) {
    return 0
  }

  const defaultTailStartIndex = Math.max(
    0,
    preparedDisplayBlocks.length - ALWAYS_MOUNTED_TAIL_BLOCK_COUNT
  )
  const anchoredMessageIds = [
    latestTurnFooterMessageId,
    latestTurnStreamingTextMessageId,
  ].filter((messageId): messageId is string => messageId != null)
  const firstAnchoredIndex =
    anchoredMessageIds.length === 0
      ? -1
      : preparedDisplayBlocks.findIndex((preparedBlock) =>
          anchoredMessageIds.some((messageId) =>
            displayBlockContainsMessageId(preparedBlock.block, messageId)
          )
        )

  return firstAnchoredIndex === -1
    ? defaultTailStartIndex
    : Math.min(defaultTailStartIndex, firstAnchoredIndex)
}

export function ChatMessages({
  threadKey,
  messages,
  status,
  workStartedAt = null,
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
  const [lastCompletedWork, setLastCompletedWork] = useState<{
    messageId: string
    durationMs: number
  } | null>(null)
  const [previewImage, setPreviewImage] = useState<ChatImagePreviewRequest | null>(null)
  const previousStatusRef = useRef(status)
  const previousWorkStartedAtRef = useRef<number | null>(workStartedAt)

  useEffect(() => {
    setLastCompletedWork(null)
    setPreviewImage(null)
    previousStatusRef.current = status
    previousWorkStartedAtRef.current = workStartedAt
  }, [threadKey])

  useEffect(() => {
    const previousStatus = previousStatusRef.current
    const previousWorkStartedAt = previousWorkStartedAtRef.current

    if (previousStatus !== "streaming" && status === "streaming") {
      setLastCompletedWork(null)
    }

    if (previousStatus === "streaming" && status !== "streaming" && previousWorkStartedAt != null) {
      if (latestTurnFooterMessage) {
        setLastCompletedWork({
          messageId: latestTurnFooterMessage.info.id,
          durationMs: Date.now() - previousWorkStartedAt,
        })
      }
    }

    previousStatusRef.current = status
    previousWorkStartedAtRef.current = workStartedAt
  }, [latestTurnFooterMessage, status, workStartedAt])
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
    status === "connecting" || (status === "streaming" && workStartedAt != null)

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
  const stablePreparedDisplayBlocks = useStablePreparedDisplayBlocks(preparedDisplayBlocks)
  const {
    virtualizedPreparedDisplayBlocks,
    alwaysMountedPreparedDisplayBlocks,
  } = useMemo(() => {
    const tailStartIndex = getAlwaysMountedTailStartIndex(
      stablePreparedDisplayBlocks,
      latestTurnFooterMessageId,
      latestTurnStreamingTextMessageId
    )

    return {
      virtualizedPreparedDisplayBlocks: stablePreparedDisplayBlocks.slice(0, tailStartIndex),
      alwaysMountedPreparedDisplayBlocks: stablePreparedDisplayBlocks.slice(tailStartIndex),
    }
  }, [
    latestTurnFooterMessageId,
    latestTurnStreamingTextMessageId,
    stablePreparedDisplayBlocks,
  ])
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
      <ConversationContent className="mx-auto flex w-full max-w-[784px] flex-col gap-0 px-6 pb-10">
        <>
          <VirtualizedTimelineBlocks
            preparedDisplayBlocks={virtualizedPreparedDisplayBlocks}
            childSessions={childSessionData}
            approvalStateByMessageId={approvalStateByMessageId}
            completedFooterByMessageId={resolvedCompletedFooterByMessageId}
            latestTurnFooterMessageId={latestTurnFooterMessageId}
            latestTurnStreamingTextMessageId={latestTurnStreamingTextMessageId}
            status={status}
            worktreePath={selectedWorktree?.path ?? null}
            onOpenImagePreview={handleOpenImagePreview}
          />
          {alwaysMountedPreparedDisplayBlocks.map((preparedBlock) => (
            <TimelineDisplayBlockRow
              key={preparedBlock.key}
              preparedBlock={preparedBlock}
              childSessions={childSessionData}
              approvalStateByMessageId={approvalStateByMessageId}
              completedFooterByMessageId={resolvedCompletedFooterByMessageId}
              latestTurnFooterMessageId={latestTurnFooterMessageId}
              latestTurnStreamingTextMessageId={latestTurnStreamingTextMessageId}
              status={status}
              worktreePath={selectedWorktree?.path ?? null}
              onOpenImagePreview={handleOpenImagePreview}
            />
          ))}
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
              startTime={status === "streaming" ? workStartedAt : null}
              completedDurationMs={latestTurnDurationMs ?? undefined}
            />
          ) : null}
        </>
      </ConversationContent>
      <ConversationEdgeFades />
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

function ConversationEdgeFades() {
  const { isAtTop, isAtBottom } = useConversationScrollState()

  return (
    <>
      <div
        className={cn(
          "chat-top-fade pointer-events-none absolute inset-x-0 top-0 z-10 h-9 transition-opacity duration-150",
          isAtTop ? "opacity-0" : "opacity-100"
        )}
      />
      <div
        className={cn(
          "chat-bottom-fade pointer-events-none absolute inset-x-0 bottom-0 z-10 h-10 transition-opacity duration-150",
          isAtBottom ? "opacity-0" : "opacity-100"
        )}
      />
    </>
  )
}

function TimelineDisplayBlockRow({
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
  childSessions?: Map<string, ChildSessionData>
  approvalStateByMessageId: Map<string, RuntimeApprovalDisplayState>
  completedFooterByMessageId: CompletedFooterStateByMessageId
  latestTurnFooterMessageId: string | null
  latestTurnStreamingTextMessageId: string | null
  status: "idle" | "connecting" | "streaming" | "error"
  worktreePath?: string | null
  onOpenImagePreview?: (preview: ChatImagePreviewRequest) => void
}) {
  const message = preparedBlock.block.type === "message" ? preparedBlock.block.message : null
  const completedFooter =
    message == null ? null : completedFooterByMessageId.get(message.info.id) ?? null
  const approvalState =
    message == null ? null : approvalStateByMessageId.get(message.info.id) ?? null
  const isLatestTurnFooterMessage =
    message != null && message.info.id === latestTurnFooterMessageId
  const isLatestTurnStreamingTextMessage =
    message != null && message.info.id === latestTurnStreamingTextMessageId
  const groupApprovalStateByMessageId =
    preparedBlock.block.type === "turnStepsDropdown" ? approvalStateByMessageId : undefined

  return (
    <MemoizedDisplayBlockRow
      preparedBlock={preparedBlock}
      childSessions={childSessions}
      approvalState={approvalState}
      groupApprovalStateByMessageId={groupApprovalStateByMessageId}
      completedFooter={completedFooter}
      isLatestTurnFooterMessage={isLatestTurnFooterMessage}
      isLatestTurnStreamingTextMessage={isLatestTurnStreamingTextMessage}
      status={status}
      worktreePath={worktreePath}
      onOpenImagePreview={onOpenImagePreview}
    />
  )
}

function VirtualizedTimelineBlocks({
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
  childSessions?: Map<string, ChildSessionData>
  approvalStateByMessageId: Map<string, RuntimeApprovalDisplayState>
  completedFooterByMessageId: CompletedFooterStateByMessageId
  latestTurnFooterMessageId: string | null
  latestTurnStreamingTextMessageId: string | null
  status: "idle" | "connecting" | "streaming" | "error"
  worktreePath?: string | null
  onOpenImagePreview?: (preview: ChatImagePreviewRequest) => void
}) {
  const { scrollRef } = useConversationScrollContext()
  const preparedDisplayBlocksRef = useRef(preparedDisplayBlocks)
  preparedDisplayBlocksRef.current = preparedDisplayBlocks
  const [timelineElement, setTimelineElement] = useState<HTMLDivElement | null>(null)
  const [timelineWidth, setTimelineWidth] = useState(FALLBACK_TIMELINE_WIDTH_PX)
  const timelineWidthKey = Math.max(1, Math.round(timelineWidth))

  useLayoutEffect(() => {
    if (timelineElement == null) {
      return
    }

    const updateTimelineWidth = () => {
      setTimelineWidth((previousWidth) => {
        const nextWidth = Math.max(1, timelineElement.getBoundingClientRect().width)

        return Math.abs(previousWidth - nextWidth) < 0.5 ? previousWidth : nextWidth
      })
    }

    updateTimelineWidth()

    if (typeof ResizeObserver === "undefined") {
      return
    }

    const observer = new ResizeObserver(updateTimelineWidth)
    observer.observe(timelineElement)

    return () => observer.disconnect()
  }, [timelineElement])

  const getItemKey = useCallback(
    (index: number) => {
      const itemKey = preparedDisplayBlocksRef.current[index]?.key ?? index

      return `${timelineWidthKey}:${itemKey}`
    },
    [timelineWidthKey]
  )
  const estimateSize = useCallback(
    (index: number) => {
      const preparedBlock = preparedDisplayBlocksRef.current[index]
      return preparedBlock
        ? estimateDisplayBlockSize(preparedBlock, timelineWidth)
        : DEFAULT_ROW_ESTIMATE_PX
    },
    [timelineWidth]
  )
  const rowVirtualizer = useVirtualizer({
    count: preparedDisplayBlocks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    getItemKey,
    overscan: TIMELINE_OVERSCAN_ROWS,
  })
  const virtualItems = rowVirtualizer.getVirtualItems()

  useLayoutEffect(() => {
    rowVirtualizer.measure()
  }, [rowVirtualizer, timelineWidthKey])

  return (
    <div
      ref={setTimelineElement}
      className="relative w-full"
      style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
    >
      {virtualItems.map((virtualItem) => {
        const preparedBlock = preparedDisplayBlocks[virtualItem.index]

        if (!preparedBlock) {
          return null
        }

        return (
          <div
            key={virtualItem.key}
            ref={rowVirtualizer.measureElement}
            data-index={virtualItem.index}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${virtualItem.start}px)` }}
          >
            <TimelineDisplayBlockRow
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
  )
}

function useStablePreparedDisplayBlocks(
  preparedDisplayBlocks: PreparedDisplayBlock[]
): PreparedDisplayBlock[] {
  const previousStateRef = useRef<StablePreparedDisplayBlocksState>({
    byKey: new Map<string, PreparedDisplayBlock>(),
    result: [],
  })

  return useMemo(() => {
    const nextState = computeStablePreparedDisplayBlocks(
      preparedDisplayBlocks,
      previousStateRef.current
    )
    previousStateRef.current = nextState
    return nextState.result
  }, [preparedDisplayBlocks])
}

function DisplayBlockRow({
  preparedBlock,
  childSessions,
  approvalState,
  groupApprovalStateByMessageId,
  completedFooter,
  isLatestTurnFooterMessage,
  isLatestTurnStreamingTextMessage,
  status,
  worktreePath,
  onOpenImagePreview,
}: {
  preparedBlock: PreparedDisplayBlock
  childSessions?: Map<string, ChildSessionData>
  approvalState: RuntimeApprovalDisplayState | null
  groupApprovalStateByMessageId?: Map<string, RuntimeApprovalDisplayState>
  completedFooter: CompletedFooterState | null
  isLatestTurnFooterMessage: boolean
  isLatestTurnStreamingTextMessage: boolean
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
          approvalStateByMessageId={groupApprovalStateByMessageId ?? EMPTY_APPROVAL_STATE_BY_MESSAGE_ID}
          worktreePath={worktreePath}
          onOpenImagePreview={onOpenImagePreview}
        />
      ) : (
        <>
          <ChatTimelineItem
            message={block.message}
            childSessions={childSessions}
            approvalState={approvalState}
            isStreaming={
              status === "streaming" &&
              isLatestTurnStreamingTextMessage
            }
            worktreePath={worktreePath}
            onOpenImagePreview={onOpenImagePreview}
          />
          {completedFooter != null &&
          !(status === "streaming" && isLatestTurnFooterMessage) ? (
            <AssistantTurnFooter
              startTime={null}
              completedDurationMs={completedFooter.durationMs}
              copyText={getMessageText(block.message)}
              changedFilesSummary={completedFooter.changedFilesSummary}
            />
          ) : null}
        </>
      )}
    </div>
  )
}

const MemoizedDisplayBlockRow = memo(
  DisplayBlockRow,
  (previousProps, nextProps) =>
    previousProps.preparedBlock === nextProps.preparedBlock &&
    previousProps.childSessions === nextProps.childSessions &&
    previousProps.approvalState === nextProps.approvalState &&
    previousProps.groupApprovalStateByMessageId === nextProps.groupApprovalStateByMessageId &&
    previousProps.completedFooter === nextProps.completedFooter &&
    previousProps.isLatestTurnFooterMessage === nextProps.isLatestTurnFooterMessage &&
    previousProps.isLatestTurnStreamingTextMessage ===
      nextProps.isLatestTurnStreamingTextMessage &&
    previousProps.status === nextProps.status &&
    previousProps.worktreePath === nextProps.worktreePath &&
    previousProps.onOpenImagePreview === nextProps.onOpenImagePreview
)

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
  const { forceScrollToBottom } = useConversationScrollContext()
  const lastMessage = messages[messages.length - 1] ?? null
  const lastMessageId = lastMessage?.info.id ?? null
  const previousLastMessageIdRef = useRef<string | null>(lastMessageId)
  const previousStatusRef = useRef<typeof status>(status)

  useLayoutEffect(() => {
    forceScrollToBottom("instant")
    onThreadPrepared(threadKey)
  }, [forceScrollToBottom, onThreadPrepared, threadKey])

  useEffect(() => {
    const previousLastMessageId = previousLastMessageIdRef.current
    const previousStatus = previousStatusRef.current
    const hasNewMessage = !!lastMessageId && lastMessageId !== previousLastMessageId
    const userJustSentMessage = hasNewMessage && lastMessage?.info.role === "user"
    const agentJustStartedResponding = status === "streaming" && previousStatus !== "streaming"

    if (userJustSentMessage || agentJustStartedResponding) {
      requestAnimationFrame(() => {
        forceScrollToBottom("instant")
      })
    }

    previousLastMessageIdRef.current = lastMessageId
    previousStatusRef.current = status
  }, [forceScrollToBottom, lastMessage?.info.role, lastMessageId, status])

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
  const shouldReduceMotion = useReducedMotion()
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
                className={cn(
                  "relative inline-flex h-5 w-5 items-center justify-center overflow-hidden rounded-sm p-0.5 text-muted-foreground/88",
                  "transition-[background-color,color,transform] duration-150 ease-out hover:bg-muted/55 hover:text-foreground active:scale-[0.96]",
                  isCopied && "text-foreground"
                )}
                aria-label={isCopied ? "Copied message" : "Copy message"}
              >
                <Copy
                  size={15}
                  aria-hidden="true"
                  className={cn(
                    "absolute transition-[opacity,transform,filter] duration-180 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
                    isCopied
                      ? "translate-y-1 scale-[0.72] opacity-0 blur-[8px] motion-reduce:translate-y-0 motion-reduce:scale-100 motion-reduce:blur-0"
                      : "translate-y-0 scale-100 opacity-100 blur-0"
                  )}
                />
                <Check
                  size={14}
                  aria-hidden="true"
                  className={cn(
                    "absolute transition-[opacity,transform,filter] duration-180 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
                    isCopied
                      ? "translate-y-0 scale-100 opacity-100 blur-0"
                      : "-translate-y-1 scale-[0.72] opacity-0 blur-[8px] motion-reduce:translate-y-0 motion-reduce:scale-100 motion-reduce:blur-0"
                  )}
                />
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
                {visibleChangedFiles.map((entry) => {
                  const trigger = (
                    <span
                      className={cn(
                        "inline-flex max-w-[180px] items-center gap-1.5 rounded-[0.35rem] border border-border/70 bg-background/65 px-2 py-1.5 text-[11px] leading-none text-foreground/88 shadow-[0_0_0_1px_rgba(255,255,255,0.015)_inset]",
                        "transition-[background-color,border-color,color] duration-150 ease-out hover:border-border hover:bg-background/82"
                      )}
                      title={entry.path}
                    >
                      <File size={11} className="shrink-0 text-[var(--color-chat-file-accent)]" />
                      <span className="truncate font-medium text-muted-foreground/92">
                        {entry.label}
                      </span>
                      {entry.added > 0 ? (
                        <span className={cn("shrink-0 font-medium", vcsTextClassNames.added)}>
                          +{entry.added}
                        </span>
                      ) : null}
                      {entry.removed > 0 ? (
                        <span className={cn("shrink-0 font-medium", vcsTextClassNames.deleted)}>
                          -{entry.removed}
                        </span>
                      ) : null}
                    </span>
                  )

                  if (entry.changes.length === 0) {
                    return <span key={entry.path}>{trigger}</span>
                  }

                  return (
                    <HoverCard key={entry.path}>
                      <HoverCardTrigger
                        delay={0}
                        closeDelay={80}
                        render={<span className="inline-flex" />}
                      >
                        {trigger}
                      </HoverCardTrigger>
                      <HoverCardContent
                        side="top"
                        align="start"
                        sideOffset={8}
                        alignOffset={0}
                        className="w-[min(44rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] p-0 shadow-xl shadow-black/12 ring-foreground/12 data-open:animate-none data-closed:animate-none duration-0"
                      >
                        <motion.div
                          initial={
                            shouldReduceMotion
                              ? undefined
                              : { scale: 0.992 }
                          }
                          animate={
                            shouldReduceMotion
                              ? undefined
                              : { scale: 1 }
                          }
                          transition={{
                            duration: shouldReduceMotion ? 0 : 0.14,
                            ease: [0.23, 1, 0.32, 1],
                          }}
                          style={{ transformOrigin: "var(--transform-origin)" }}
                          className="max-h-[28rem] space-y-2 overflow-y-auto will-change-transform"
                        >
                          {entry.changes.map((change, index) => (
                            <FileChangeDiffCard
                              key={`${change.path}:${change.kind}:${index}`}
                              change={change}
                              maxHeightClassName="max-h-[24rem]"
                            />
                          ))}
                        </motion.div>
                      </HoverCardContent>
                    </HoverCard>
                  )
                })}
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
