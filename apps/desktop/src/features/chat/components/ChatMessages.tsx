import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { Project } from "@/features/workspace/types"
import type { ChildSessionState, MessageWithParts, RuntimePromptState } from "../types"
import { NucleusLogo } from "@/components/NucleusLogo"
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
import { buildChatTimelineViewModel } from "./timelineViewModel"

interface ChatMessagesProps {
  threadKey: string
  messages: MessageWithParts[]
  status: "idle" | "streaming" | "error"
  activePromptState?: RuntimePromptState | null
  selectedProject?: Project | null
  childSessions?: Map<string, ChildSessionState>
  showInlineIntro?: boolean
}

function StaticConversation({
  children,
  resetKey,
}: {
  children: ReactNode
  resetKey: string
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0
    }
  }, [resetKey])

  return (
    <div
      ref={scrollRef}
      className="app-scrollbar h-full overflow-y-auto overscroll-none"
    >
      {children}
    </div>
  )
}

function getMessageText(message: MessageWithParts): string {
  return message.parts
    .filter((part): part is Extract<typeof message.parts[number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("")
}

function ChatEmptyState() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center">
      <div className="flex flex-col items-center gap-6">
        <NucleusLogo className="size-16 overflow-hidden" imageClassName="scale-125" />

        <h2
          className="text-center text-[1.5rem] leading-none tracking-[0.04em] text-foreground md:text-[1.875rem]"
          style={{ fontFamily: '"Geist Pixel", "Geist Mono", ui-monospace, monospace' }}
        >
          Build cool sh*t
        </h2>
      </div>
    </div>
  )
}


export function ChatMessages({
  threadKey,
  messages,
  status,
  activePromptState = null,
  selectedProject: _selectedProject,
  childSessions,
  showInlineIntro = false,
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
    latestTurnLastAssistantTextMessage,
    latestTurnLastAssistantTextMessageId,
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
    const previousStatus = previousStatusRef.current

    if (previousStatus !== "streaming" && status === "streaming") {
      setActiveWorkStartTime(Date.now())
      setLastCompletedWork(null)
    }

    if (previousStatus === "streaming" && status !== "streaming" && activeWorkStartTime != null) {
      const lastAssistantMessage = [...renderedMessages]
        .reverse()
        .find(
          (message) =>
            message.info.role === "assistant" &&
            message.parts.some((part) => part.type === "text" && part.text.trim())
        )

      if (lastAssistantMessage) {
        setLastCompletedWork({
          messageId: lastAssistantMessage.info.id,
          durationMs: Date.now() - activeWorkStartTime,
        })
      }

      setActiveWorkStartTime(null)
    }

    previousStatusRef.current = status
  }, [activeWorkStartTime, renderedMessages, status])
  const latestTurnDurationMs =
    latestTurnLastAssistantTextMessageId == null
      ? null
      : latestTurnLastAssistantTextMessageId === lastCompletedWork?.messageId
        ? lastCompletedWork.durationMs
        : (completedWorkDurationByMessageId.get(latestTurnLastAssistantTextMessageId) ?? null)
  const shouldRenderLatestTurnFooter = status === "streaming" && activeWorkStartTime != null
  const [preparedThreadKey, setPreparedThreadKey] = useState(threadKey)
  const isThreadPrepared = preparedThreadKey === threadKey

  if (!hasContent) {
    if (!showInlineIntro) {
      return (
        <StaticConversation resetKey={_selectedProject?.id ?? "empty-chat"}>
          <div className="min-h-full" />
        </StaticConversation>
      )
    }

    return (
      <StaticConversation resetKey={_selectedProject?.id ?? "empty-chat"}>
        <div className="flex min-h-full w-full items-center justify-center">
          <ChatEmptyState key={_selectedProject?.id ?? "empty-chat"} />
        </div>
      </StaticConversation>
    )
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
          {showInlineIntro ? <ChatEmptyState /> : null}
          {timelineBlocks.map((block, blockIndex) => {
            if (block.type !== "message") {
              return null
            }

            const previousBlock =
              blockIndex > 0 && timelineBlocks[blockIndex - 1]?.type === "message"
                ? timelineBlocks[blockIndex - 1]
                : null
            const previousRole = previousBlock?.type === "message" ? previousBlock.message.info.role : null
            const currentRole = block.message.info.role
            const rowSpacingClass =
              previousRole == null
                ? ""
                : previousRole === currentRole
                  ? "mt-3"
                  : "mt-7"
            const completedFooter = completedFooterByMessageId.get(block.message.info.id)
            const shouldRenderInlineCompletedFooter =
              completedFooter != null &&
              !(status === "streaming" && block.message.info.id === latestTurnLastAssistantTextMessageId)

            return (
              <div key={block.key} className={rowSpacingClass}>
                <ChatTimelineItem
                  message={block.message}
                  childSessions={childSessionData}
                  approvalState={approvalStateByMessageId.get(block.message.info.id) ?? null}
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
              copyText={status === "streaming" ? null : getMessageText(latestTurnLastAssistantTextMessage!)}
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
  changedFilesSummary?: {
    fileCount: number
    label: string
    added: number
    removed: number
  } | null
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

  return (
    <MessageComponent from="assistant">
      <MessageContent>
        <div className="mt-5 inline-flex items-center gap-2.5 text-xs tracking-[0.01em] text-muted-foreground/80 tabular-nums">
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
              <button
                type="button"
                onClick={() => {}}
                className="inline-flex max-w-[240px] items-center gap-2 px-1 py-0.5 text-[12px] leading-none text-foreground/88 transition-colors hover:text-foreground"
                aria-label={`Open changes for ${changedFilesSummary.label}`}
              >
                <File size={12} className="shrink-0 text-[var(--color-chat-file-accent)]" />
                <span className="truncate font-medium text-muted-foreground/88">
                  {changedFilesSummary.label}
                </span>
                {changedFilesSummary.added > 0 ? (
                  <span className="shrink-0 font-medium text-emerald-500">
                    +{changedFilesSummary.added}
                  </span>
                ) : null}
                {changedFilesSummary.removed > 0 ? (
                  <span className="shrink-0 font-medium text-red-500">
                    -{changedFilesSummary.removed}
                  </span>
                ) : null}
              </button>
            </>
          ) : null}
        </div>
      </MessageContent>
    </MessageComponent>
  )
}
