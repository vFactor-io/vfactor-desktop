import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { Project, ProjectWorktree } from "@/features/workspace/types"
import type { ChildSessionState, MessageWithParts, RuntimePromptState } from "../types"
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
import { ChatTimelineItem, InlineSubagentActivity } from "./ChatTimelineItem"
import { formatElapsedDuration, useElapsedDuration } from "./workDuration"
import { TurnStepsDropdown } from "./TurnStepsDropdown"
import {
  buildChatTimelineViewModel,
  type TimelineFileChangeSummary,
} from "./timelineViewModel"
import type { TimelineBlock } from "./timelineActivity"

interface ChatMessagesProps {
  threadKey: string
  messages: MessageWithParts[]
  status: "idle" | "streaming" | "error"
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

function getMessageText(message: MessageWithParts): string {
  return message.parts
    .filter((part): part is Extract<typeof message.parts[number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("")
}

function hasRenderableMessageContent(message: MessageWithParts): boolean {
  return message.parts.some((part) =>
    part.type === "tool" || (part.type === "text" && part.text.trim().length > 0)
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
  status: "idle" | "streaming" | "error"
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
  const previousStatusRef = useRef(status)

  useEffect(() => {
    setActiveWorkStartTime(status === "streaming" ? Date.now() : null)
    setLastCompletedWork(null)
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
  const shouldRenderLatestTurnFooter = status === "streaming" && activeWorkStartTime != null
  const collapsedMessagesByFooterId = useMemo(
    () => getTurnCollapsedMessagesByFooterId(renderedMessages, status),
    [renderedMessages, status]
  )
  const displayBlocks = useMemo(
    () => buildDisplayBlocks(timelineBlocks, collapsedMessagesByFooterId)
      .filter((block) => block.type !== "message" || hasRenderableMessageContent(block.message)),
    [collapsedMessagesByFooterId, timelineBlocks]
  )
  const [preparedThreadKey, setPreparedThreadKey] = useState(threadKey)
  const isThreadPrepared = preparedThreadKey === threadKey

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
          {displayBlocks.map((block, blockIndex) => {
            const previousBlock =
              blockIndex > 0 ? displayBlocks[blockIndex - 1] : null
            const previousRole = previousBlock ? getDisplayBlockRole(previousBlock) : null
            const currentRole = getDisplayBlockRole(block)
            const rowSpacingClass =
              previousRole == null
                ? ""
                : previousRole === currentRole
                  ? "mt-3"
                  : "mt-7"

            if (block.type === "turnStepsDropdown") {
              return (
                <div key={block.key} className={rowSpacingClass}>
                  <TurnStepsDropdown
                    messages={block.messages}
                    childSessions={childSessionData}
                    approvalStateByMessageId={approvalStateByMessageId}
                  />
                </div>
              )
            }

            const completedFooter = resolvedCompletedFooterByMessageId.get(block.message.info.id)
            const shouldRenderInlineCompletedFooter =
              completedFooter != null &&
              !(status === "streaming" && block.message.info.id === latestTurnFooterMessageId)

            return (
              <div key={block.key} className={rowSpacingClass}>
                <ChatTimelineItem
                  message={block.message}
                  childSessions={childSessionData}
                  approvalState={approvalStateByMessageId.get(block.message.info.id) ?? null}
                  isStreaming={
                    status === "streaming" &&
                    block.message.info.id === latestTurnStreamingTextMessageId
                  }
                />
                {shouldRenderInlineCompletedFooter ? (
                  <AssistantTurnFooter
                    isWorking={false}
                    startTime={null}
                    completedDurationMs={completedFooter.durationMs}
                    copyText={getMessageText(block.message)}
                    changedFilesSummary={completedFooter.changedFilesSummary}
                  />
                ) : null}
              </div>
            )
          })}
          {orphanChildSessions.length > 0 ? (
            <div className="space-y-3">
              {orphanChildSessions.map((childSession) => (
                <InlineSubagentActivity key={childSession.session.id} childSession={childSession} />
              ))}
            </div>
          ) : null}
          {shouldRenderLatestTurnFooter ? (
            <AssistantTurnFooter
              isWorking={status === "streaming"}
              startTime={activeWorkStartTime}
              completedDurationMs={latestTurnDurationMs ?? undefined}
              copyText={status === "streaming" ? null : getMessageText(latestTurnFooterMessage!)}
              changedFilesSummary={status === "streaming" ? null : latestTurnChangedFilesSummary}
            />
          ) : null}
        </>
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
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
  status: "idle" | "streaming" | "error"
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
  isWorking,
  startTime,
  completedDurationMs,
  copyText,
  changedFilesSummary,
}: {
  isWorking: boolean
  startTime: number | null
  completedDurationMs?: number
  copyText?: string | null
  changedFilesSummary?: TimelineFileChangeSummary | null
}) {
  const [isCopied, setIsCopied] = useState(false)
  const elapsed = useElapsedDuration(
    startTime,
    isWorking,
    startTime != null && completedDurationMs != null ? startTime + completedDurationMs : undefined
  )
  const workLabel = isWorking
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
          {isWorking ? <LoadingDots className="shrink-0" /> : null}
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
