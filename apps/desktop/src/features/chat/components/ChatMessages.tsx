import {
  createContext,
  useEffect,
  useLayoutEffect,
  useCallback,
  useContext,
  memo,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  LegendList,
  type LegendListRef,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "@legendapp/list/react"
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
  Message as MessageComponent,
  MessageContent,
} from "./ai-elements/message"
import { ArrowDown, Check, Copy, File } from "@/components/icons"
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
import { getChatScrollStateFromMetrics, type ChatScrollState } from "./chatScrollState"

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

interface LatestTurnFooterBlock {
  type: "latestTurnFooter"
  key: string
  activityState: "connecting" | "streaming"
  startTime: number | null
  completedDurationMs?: number
}

interface OrphanChildSessionsBlock {
  type: "orphanChildSessions"
  key: string
  childSessions: ChildSessionData[]
}

type DisplayBlock =
  | TimelineBlock
  | LatestTurnDropdownBlock
  | LatestTurnFooterBlock
  | OrphanChildSessionsBlock

interface CompletedFooterState {
  durationMs: number
  changedFilesSummary: TimelineFileChangeSummary | null
}

type CompletedFooterStateByMessageId = Map<string, CompletedFooterState>

interface PreparedDisplayBlock {
  block: DisplayBlock
  key: string
  paddingTop: number
  approvalState: RuntimeApprovalDisplayState | null
  groupApprovalStateByMessageId?: Map<string, RuntimeApprovalDisplayState>
  completedFooter: CompletedFooterState | null
  isLatestTurnFooterMessage: boolean
  isLatestTurnStreamingTextMessage: boolean
  isStreamingMessage: boolean
  shouldRenderCompletedFooter: boolean
}

interface StablePreparedDisplayBlocksState {
  byKey: Map<string, PreparedDisplayBlock>
  result: PreparedDisplayBlock[]
}

const SAME_ROLE_BLOCK_GAP_PX = 12
const ROLE_CHANGE_BLOCK_GAP_PX = 28
const DEFAULT_ROW_ESTIMATE_PX = 104
const EMPTY_APPROVAL_STATE_BY_MESSAGE_ID = new Map<string, RuntimeApprovalDisplayState>()
const SCROLL_TO_BOTTOM_BUTTON_DELAY_MS = 150

interface TimelineRowSharedState {
  childSessions?: Map<string, ChildSessionData>
  worktreePath?: string | null
  onOpenImagePreview?: (preview: ChatImagePreviewRequest) => void
}

const TimelineRowSharedStateContext = createContext<TimelineRowSharedState>({
  childSessions: undefined,
  worktreePath: null,
  onOpenImagePreview: undefined,
})

function getMessageText(message: MessageWithParts): string {
  return getMessageTextContent(message.parts)
}

function hasRenderableMessageContent(message: MessageWithParts): boolean {
  if (message.info.itemType === "reasoning" && message.info.title?.trim()) {
    return true
  }

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

function areFileChangeEntriesEqual(
  currentEntries: TimelineFileChangeSummary["entries"][number]["changes"],
  nextEntries: TimelineFileChangeSummary["entries"][number]["changes"]
): boolean {
  if (currentEntries === nextEntries) {
    return true
  }

  if (currentEntries.length !== nextEntries.length) {
    return false
  }

  return currentEntries.every((entry, index) => {
    const nextEntry = nextEntries[index]
    return (
      nextEntry != null &&
      entry.path === nextEntry.path &&
      entry.kind === nextEntry.kind &&
      entry.diff === nextEntry.diff
    )
  })
}

function areFileChangeSummariesEqual(
  currentSummary: TimelineFileChangeSummary | null,
  nextSummary: TimelineFileChangeSummary | null
): boolean {
  if (currentSummary === nextSummary) {
    return true
  }

  if (currentSummary == null || nextSummary == null) {
    return false
  }

  if (
    currentSummary.fileCount !== nextSummary.fileCount ||
    currentSummary.label !== nextSummary.label ||
    currentSummary.added !== nextSummary.added ||
    currentSummary.removed !== nextSummary.removed ||
    currentSummary.entries.length !== nextSummary.entries.length
  ) {
    return false
  }

  return currentSummary.entries.every((entry, index) => {
    const nextEntry = nextSummary.entries[index]
    return (
      nextEntry != null &&
      entry.path === nextEntry.path &&
      entry.label === nextEntry.label &&
      entry.added === nextEntry.added &&
      entry.removed === nextEntry.removed &&
      areFileChangeEntriesEqual(entry.changes, nextEntry.changes)
    )
  })
}

function areCompletedFootersEqual(
  currentFooter: CompletedFooterState | null,
  nextFooter: CompletedFooterState | null
): boolean {
  if (currentFooter === nextFooter) {
    return true
  }

  if (currentFooter == null || nextFooter == null) {
    return false
  }

  return (
    currentFooter.durationMs === nextFooter.durationMs &&
    areFileChangeSummariesEqual(
      currentFooter.changedFilesSummary,
      nextFooter.changedFilesSummary
    )
  )
}

function areChildSessionDataListsEqual(
  currentSessions: ChildSessionData[],
  nextSessions: ChildSessionData[]
): boolean {
  if (currentSessions === nextSessions) {
    return true
  }

  if (currentSessions.length !== nextSessions.length) {
    return false
  }

  return currentSessions.every((currentSession, index) => {
    const nextSession = nextSessions[index]

    return (
      nextSession != null &&
      currentSession.session === nextSession.session &&
      currentSession.toolParts === nextSession.toolParts &&
      currentSession.isActive === nextSession.isActive
    )
  })
}

function isPreparedDisplayBlockUnchanged(
  currentBlock: PreparedDisplayBlock,
  nextBlock: PreparedDisplayBlock
): boolean {
  if (
    currentBlock.key !== nextBlock.key ||
    currentBlock.paddingTop !== nextBlock.paddingTop ||
    currentBlock.block.type !== nextBlock.block.type ||
    currentBlock.approvalState !== nextBlock.approvalState ||
    currentBlock.groupApprovalStateByMessageId !== nextBlock.groupApprovalStateByMessageId ||
    currentBlock.isLatestTurnFooterMessage !== nextBlock.isLatestTurnFooterMessage ||
    currentBlock.isLatestTurnStreamingTextMessage !== nextBlock.isLatestTurnStreamingTextMessage ||
    currentBlock.isStreamingMessage !== nextBlock.isStreamingMessage ||
    currentBlock.shouldRenderCompletedFooter !== nextBlock.shouldRenderCompletedFooter ||
    !areCompletedFootersEqual(currentBlock.completedFooter, nextBlock.completedFooter)
  ) {
    return false
  }

  if (currentBlock.block.type === "turnStepsDropdown") {
    return (
      nextBlock.block.type === "turnStepsDropdown" &&
      areMessageListsEqualById(currentBlock.block.messages, nextBlock.block.messages)
    )
  }

  if (currentBlock.block.type === "latestTurnFooter") {
    return (
      nextBlock.block.type === "latestTurnFooter" &&
      currentBlock.block.activityState === nextBlock.block.activityState &&
      currentBlock.block.startTime === nextBlock.block.startTime &&
      currentBlock.block.completedDurationMs === nextBlock.block.completedDurationMs
    )
  }

  if (currentBlock.block.type === "orphanChildSessions") {
    return (
      nextBlock.block.type === "orphanChildSessions" &&
      areChildSessionDataListsEqual(
        currentBlock.block.childSessions,
        nextBlock.block.childSessions
      )
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

function keyExtractor(item: PreparedDisplayBlock): string {
  return item.key
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
  const timelineDisplayBlocks = useMemo(
    () => buildDisplayBlocks(timelineBlocks, collapsedMessagesByFooterId)
      .filter((block) => block.type !== "message" || hasRenderableMessageContent(block.message)),
    [collapsedMessagesByFooterId, timelineBlocks]
  )
  const displayBlocks = useMemo(() => {
    const nextBlocks: DisplayBlock[] = [...timelineDisplayBlocks]

    if (orphanChildSessions.length > 0) {
      nextBlocks.push({
        type: "orphanChildSessions",
        key: "orphan-child-sessions",
        childSessions: orphanChildSessions,
      })
    }

    if (shouldRenderLatestTurnFooter) {
      nextBlocks.push({
        type: "latestTurnFooter",
        key: "latest-turn-footer",
        activityState: status === "connecting" ? "connecting" : "streaming",
        startTime: status === "streaming" ? workStartedAt : null,
        ...(latestTurnDurationMs != null ? { completedDurationMs: latestTurnDurationMs } : {}),
      })
    }

    return nextBlocks
  }, [
    latestTurnDurationMs,
    orphanChildSessions,
    shouldRenderLatestTurnFooter,
    status,
    timelineDisplayBlocks,
    workStartedAt,
  ])
  const stableApprovalStateByMessageId =
    approvalStateByMessageId.size === 0
      ? EMPTY_APPROVAL_STATE_BY_MESSAGE_ID
      : approvalStateByMessageId
  const preparedDisplayBlocks = useMemo(
    () =>
      displayBlocks.map((block, index) => {
        const message = block.type === "message" ? block.message : null
        const isLatestTurnFooterMessage =
          message != null && message.info.id === latestTurnFooterMessageId
        const isLatestTurnStreamingTextMessage =
          message != null && message.info.id === latestTurnStreamingTextMessageId
        const completedFooter =
          message == null ? null : resolvedCompletedFooterByMessageId.get(message.info.id) ?? null

        return {
          block,
          key: block.key,
          paddingTop: getDisplayBlockPaddingTop(
            index > 0 ? displayBlocks[index - 1] ?? null : null,
            block
          ),
          approvalState:
            message == null ? null : stableApprovalStateByMessageId.get(message.info.id) ?? null,
          groupApprovalStateByMessageId:
            block.type === "turnStepsDropdown" ? stableApprovalStateByMessageId : undefined,
          completedFooter,
          isLatestTurnFooterMessage,
          isLatestTurnStreamingTextMessage,
          isStreamingMessage: status === "streaming" && isLatestTurnStreamingTextMessage,
          shouldRenderCompletedFooter:
            completedFooter != null && !(status === "streaming" && isLatestTurnFooterMessage),
        }
      }),
    [
      displayBlocks,
      latestTurnFooterMessageId,
      latestTurnStreamingTextMessageId,
      resolvedCompletedFooterByMessageId,
      stableApprovalStateByMessageId,
      status,
    ]
  )
  const stablePreparedDisplayBlocks = useStablePreparedDisplayBlocks(preparedDisplayBlocks)
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
    <div
      className="relative flex h-full min-h-0 w-full flex-1 overflow-hidden"
      role="log"
    >
      <MessagesTimelineList
        key={threadKey}
        threadKey={threadKey}
        preparedDisplayBlocks={stablePreparedDisplayBlocks}
        childSessions={childSessionData}
        status={status}
        messages={messages}
        worktreePath={selectedWorktree?.path ?? null}
        onOpenImagePreview={handleOpenImagePreview}
      />
      <ChatImagePreviewModal
        image={previewImage}
        open={previewImage != null}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewImage(null)
          }
        }}
      />
    </div>
  )
}

function ConversationEdgeFades({
  isAtTop,
  isAtBottom,
}: {
  isAtTop: boolean
  isAtBottom: boolean
}) {
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

function ChatScrollToBottomButton({
  visible,
  onPress,
}: {
  visible: boolean
  onPress: () => void
}) {
  if (!visible) {
    return null
  }

  return (
    <button
      type="button"
      onClick={onPress}
      className={cn(
        "absolute bottom-4 left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border/70 bg-card/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur-sm transition-colors",
        "hover:border-border hover:bg-card hover:text-foreground"
      )}
    >
      <ArrowDown className="size-3.5" />
      <span>Scroll to bottom</span>
    </button>
  )
}

function TimelineDisplayBlockRow({
  preparedBlock,
}: {
  preparedBlock: PreparedDisplayBlock
}) {
  const { childSessions, worktreePath, onOpenImagePreview } = useContext(
    TimelineRowSharedStateContext
  )

  return (
    <MemoizedDisplayBlockRow
      preparedBlock={preparedBlock}
      childSessions={childSessions}
      worktreePath={worktreePath}
      onOpenImagePreview={onOpenImagePreview}
    />
  )
}

function MessagesTimelineList({
  threadKey,
  preparedDisplayBlocks,
  childSessions,
  status,
  messages,
  worktreePath,
  onOpenImagePreview,
}: {
  threadKey: string
  preparedDisplayBlocks: PreparedDisplayBlock[]
  childSessions?: Map<string, ChildSessionData>
  status: "idle" | "connecting" | "streaming" | "error"
  messages: MessageWithParts[]
  worktreePath?: string | null
  onOpenImagePreview?: (preview: ChatImagePreviewRequest) => void
}) {
  const listRef = useRef<LegendListRef | null>(null)
  const isAtEndRef = useRef(true)
  const showScrollButtonTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previousLastMessageIdRef = useRef<string | null>(
    messages[messages.length - 1]?.info.id ?? null
  )
  const previousStatusRef = useRef<typeof status>(status)
  const previousRowCountRef = useRef(preparedDisplayBlocks.length)
  const [isAtTop, setIsAtTop] = useState(true)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)

  const cancelShowScrollButton = useCallback(() => {
    if (showScrollButtonTimeoutRef.current != null) {
      clearTimeout(showScrollButtonTimeoutRef.current)
      showScrollButtonTimeoutRef.current = null
    }
  }, [])

  const hideScrollToBottomButton = useCallback(() => {
    cancelShowScrollButton()
    setShowScrollToBottom(false)
  }, [cancelShowScrollButton])

  const applyScrollState = useCallback((nextScrollState: ChatScrollState) => {
    isAtEndRef.current = nextScrollState.isAtBottom
    setIsAtBottom((current) =>
      current === nextScrollState.isAtBottom ? current : nextScrollState.isAtBottom
    )
    setIsAtTop((current) =>
      current === nextScrollState.isAtTop ? current : nextScrollState.isAtTop
    )

    if (!nextScrollState.isScrollable || nextScrollState.isAtBottom) {
      hideScrollToBottomButton()
      return
    }

    if (showScrollButtonTimeoutRef.current != null) {
      return
    }

    showScrollButtonTimeoutRef.current = setTimeout(() => {
      showScrollButtonTimeoutRef.current = null
      setShowScrollToBottom(true)
    }, SCROLL_TO_BOTTOM_BUTTON_DELAY_MS)
  }, [hideScrollToBottomButton])

  const updateListEndStateFromEvent = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
      const nextScrollState = getChatScrollStateFromMetrics({
        scrollOffset: contentOffset.y,
        contentSize: contentSize.height,
        viewportSize: layoutMeasurement.height,
      })
      applyScrollState(nextScrollState)
    },
    [applyScrollState]
  )

  const updateListEndStateFromRef = useCallback(() => {
    const state = listRef.current?.getState?.()
    if (!state) {
      return
    }

    applyScrollState(
      getChatScrollStateFromMetrics({
        scrollOffset: state.scroll,
        contentSize: state.contentLength,
        viewportSize: state.scrollLength,
      })
    )
  }, [applyScrollState])

  const scrollToEnd = useCallback((animated = false) => {
    isAtEndRef.current = true
    setIsAtBottom(true)
    hideScrollToBottomButton()
    void listRef.current?.scrollToEnd?.({ animated })
  }, [hideScrollToBottomButton])

  const sharedState = useMemo<TimelineRowSharedState>(
    () => ({
      childSessions,
      worktreePath,
      onOpenImagePreview,
    }),
    [childSessions, onOpenImagePreview, worktreePath]
  )

  const renderItem = useCallback(
    ({ item }: { item: PreparedDisplayBlock }) => (
      <div className="mx-auto w-full max-w-[784px] px-6">
        <TimelineDisplayBlockRow preparedBlock={item} />
      </div>
    ),
    []
  )

  useLayoutEffect(() => {
    isAtEndRef.current = true
    setIsAtTop(true)
    setIsAtBottom(true)
    hideScrollToBottomButton()

    const frameId = requestAnimationFrame(() => {
      void listRef.current?.scrollToEnd?.({ animated: false })
      updateListEndStateFromRef()
    })

    return () => {
      cancelAnimationFrame(frameId)
    }
  }, [hideScrollToBottomButton, threadKey, updateListEndStateFromRef])

  useLayoutEffect(() => {
    const previousRowCount = previousRowCountRef.current
    previousRowCountRef.current = preparedDisplayBlocks.length

    if (previousRowCount === 0 && preparedDisplayBlocks.length > 0) {
      scrollToEnd(false)
    }
  }, [preparedDisplayBlocks.length, scrollToEnd])

  useEffect(() => {
    const lastMessage = messages[messages.length - 1] ?? null
    const lastMessageId = lastMessage?.info.id ?? null
    const previousLastMessageId = previousLastMessageIdRef.current
    const previousStatus = previousStatusRef.current
    const hasNewMessage = !!lastMessageId && lastMessageId !== previousLastMessageId
    const userJustSentMessage = hasNewMessage && lastMessage?.info.role === "user"
    const agentJustStartedResponding = status === "streaming" && previousStatus !== "streaming"

    if (userJustSentMessage || (agentJustStartedResponding && isAtEndRef.current)) {
      scrollToEnd(false)
    }

    previousLastMessageIdRef.current = lastMessageId
    previousStatusRef.current = status
  }, [messages, scrollToEnd, status])

  useEffect(() => {
    return () => {
      cancelShowScrollButton()
    }
  }, [cancelShowScrollButton])

  return (
    <div className="h-full w-full">
      <TimelineRowSharedStateContext.Provider value={sharedState}>
        <LegendList<PreparedDisplayBlock>
          ref={listRef}
          data={preparedDisplayBlocks}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          estimatedItemSize={DEFAULT_ROW_ESTIMATE_PX}
          style={{
            flex: 1,
            height: "100%",
            minHeight: 0,
            overscrollBehaviorY: "contain",
          }}
          initialScrollAtEnd
          maintainScrollAtEnd
          maintainScrollAtEndThreshold={0.1}
          maintainVisibleContentPosition
          onScroll={updateListEndStateFromEvent}
          className="app-scrollbar"
          ListHeaderComponent={<div className="h-4" />}
          ListFooterComponent={<div className="h-10" />}
        />
      </TimelineRowSharedStateContext.Provider>
      <ConversationEdgeFades isAtTop={isAtTop} isAtBottom={isAtBottom} />
      <ChatScrollToBottomButton
        visible={showScrollToBottom}
        onPress={() => scrollToEnd(true)}
      />
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
  worktreePath,
  onOpenImagePreview,
}: {
  preparedBlock: PreparedDisplayBlock
  childSessions?: Map<string, ChildSessionData>
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
          approvalStateByMessageId={
            preparedBlock.groupApprovalStateByMessageId ?? EMPTY_APPROVAL_STATE_BY_MESSAGE_ID
          }
          worktreePath={worktreePath}
          onOpenImagePreview={onOpenImagePreview}
        />
      ) : block.type === "orphanChildSessions" ? (
        <div className="space-y-3">
          {block.childSessions.map((childSession) => (
            <InlineSubagentActivity key={childSession.session.id} childSession={childSession} />
          ))}
        </div>
      ) : block.type === "latestTurnFooter" ? (
        <AssistantTurnFooter
          activityState={block.activityState}
          startTime={block.startTime}
          completedDurationMs={block.completedDurationMs}
        />
      ) : (
        <>
          <ChatTimelineItem
            message={block.message}
            childSessions={childSessions}
            approvalState={preparedBlock.approvalState}
            isStreaming={preparedBlock.isStreamingMessage}
            worktreePath={worktreePath}
            onOpenImagePreview={onOpenImagePreview}
          />
          {preparedBlock.shouldRenderCompletedFooter && preparedBlock.completedFooter != null ? (
            <AssistantTurnFooter
              startTime={null}
              completedDurationMs={preparedBlock.completedFooter.durationMs}
              copyText={getMessageText(block.message)}
              changedFilesSummary={preparedBlock.completedFooter.changedFilesSummary}
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
    previousProps.worktreePath === nextProps.worktreePath &&
    previousProps.onOpenImagePreview === nextProps.onOpenImagePreview
)

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
