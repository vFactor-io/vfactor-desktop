import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useStickToBottomContext } from "use-stick-to-bottom"
import {
  Bash,
  CaretDown,
  CaretRight,
  Compass,
  Eye,
  Globe,
  Image,
  MagnifyingGlass,
  PencilSimple,
  Robot,
  Zap,
  type Icon,
} from "@/components/icons"
import { cn } from "@/lib/utils"
import type {
  MessageWithParts,
  RuntimeApprovalDisplayState,
  RuntimeMessagePart,
  RuntimeToolPart,
} from "../types"
import {
  Message as MessageComponent,
  MessageContent,
  MessageResponse,
  MessageUserContent,
} from "./ai-elements/message"
import type { ChildSessionData } from "./agent-activity/AgentActivitySubagent"
import { getFileChangeEntries, getToolPart } from "./timelineActivity"

interface ChatTimelineItemProps {
  message: MessageWithParts
  childSessions?: Map<string, ChildSessionData>
  approvalState?: RuntimeApprovalDisplayState | null
}

function getMessageText(parts: RuntimeMessagePart[]): string {
  return parts
    .filter((part): part is Extract<RuntimeMessagePart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("")
}

function TimelineTextBlock({
  eyebrow,
  text,
  tone = "default",
}: {
  eyebrow?: string
  text: string
  tone?: "default" | "muted" | "accent"
}) {
  if (tone === "default") {
    return (
      <MessageComponent from="assistant">
        <MessageContent>
          <MessageResponse
            className="leading-relaxed [&>p]:mb-4 last:[&>p]:mb-0"
          >
            {text}
          </MessageResponse>
        </MessageContent>
      </MessageComponent>
    )
  }

  const toneClass =
    tone === "muted" ? "border-border/60 bg-muted/35 text-foreground/78" : "border-primary/20 bg-primary/5"

  return (
    <MessageComponent from="assistant">
      <MessageContent>
        <div className={cn("w-full rounded-[22px] border px-4 py-3", toneClass)}>
          {eyebrow ? (
            <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              {eyebrow}
            </div>
          ) : null}
          <MessageResponse
            className="leading-relaxed [&>p]:mb-4 last:[&>p]:mb-0"
          >
            {text}
          </MessageResponse>
        </div>
      </MessageContent>
    </MessageComponent>
  )
}

function getBaseName(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean)
  return segments[segments.length - 1] ?? path
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

function getCommandLabel(command: unknown): string {
  if (typeof command !== "string" || !command.trim()) {
    return "command"
  }

  const quoted = command.match(/'([^']+)'/)
  const raw = quoted?.[1] ?? command
  const normalized = raw.replace(/^\/bin\/\w+\s+-lc\s+/, "").trim()
  return normalized || raw
}

function renderInlineCode(value: string) {
  return (
    <code className="inline-flex items-center rounded-[0.75rem] bg-muted/80 px-2 py-0.5 align-middle font-mono text-[0.95em] leading-tight text-foreground/92">
      {value}
    </code>
  )
}

function renderInlinePath(value: string) {
  return <span className="font-mono text-[var(--color-chat-file-accent)]">{value}</span>
}

function countDiffLinesFromPatch(diff: string | undefined): { added: number; removed: number } {
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
    { added: 0, removed: 0 },
  )
}

function renderDiffStats({ added, removed }: { added: number; removed: number }) {
  if (added === 0 && removed === 0) {
    return null
  }

  return (
    <span className="ml-1.5 text-[0.9em]">
      {added > 0 ? <span className="font-medium text-emerald-500">+{added}</span> : null}
      {added > 0 && removed > 0 ? " " : null}
      {removed > 0 ? <span className="font-medium text-red-500">-{removed}</span> : null}
    </span>
  )
}


function prettyValue(value: unknown): string {
  if (typeof value === "string") {
    return value
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function renderCommandSummary(toolPart: RuntimeToolPart) {
  const input = toolPart.state.input
  const commandLabel = getCommandLabel(input.command ?? toolPart.state.title)

  return (
    <span>
      Bash {renderInlineCode(commandLabel)}
    </span>
  )
}

function renderFileChangeSummary(toolPart: RuntimeToolPart) {
  const output = toolPart.state.output
  const source =
    output && typeof output === "object" && "changes" in output
      ? (output as { changes?: unknown[] }).changes
      : undefined
  const fileChanges = getFileChangeEntries(source)

  if (toolPart.state.status === "pending") {
    if (fileChanges.length === 0) {
      return <span>Waiting for approval to apply workspace edits</span>
    }
  }

  if (fileChanges.length === 0) {
    return <span>Prepared workspace edits</span>
  }

  if (fileChanges.length === 1) {
    const change = fileChanges[0]
    const fileName = change.path.split(/[\\/]/).filter(Boolean).at(-1) ?? change.path
    const diff = countDiffLinesFromPatch(change.diff)
    return <span>Edited {renderInlinePath(fileName)}{renderDiffStats(diff)}</span>
  }

  return <span>Edited {fileChanges.map((change, i) => {
    const fileName = change.path.split(/[\\/]/).filter(Boolean).at(-1) ?? change.path
    const diff = countDiffLinesFromPatch(change.diff)
    return <span key={change.path}>{i > 0 ? ", " : ""}{renderInlinePath(fileName)}{renderDiffStats(diff)}</span>
  })}</span>
}

function getGenericToolIcon(itemType?: string): Icon {
  switch (itemType) {
    case "webSearch":
      return Globe
    case "imageGeneration":
    case "imageView":
      return Image
    case "collabAgentToolCall":
      return Robot
    case "contextCompaction":
      return Zap
    case "mcpToolCall":
    case "dynamicToolCall":
      return Compass
    default:
      return Zap
  }
}

function renderGenericToolSummary(message: MessageWithParts, toolPart: RuntimeToolPart) {
  const { itemType } = message.info
  const input = toolPart.state.input

  switch (itemType) {
    case "webSearch":
      return (
        <span>
          Searched web for {renderInlineCode(String(input.query ?? toolPart.state.title ?? "query"))}
        </span>
      )
    case "mcpToolCall":
      return <span>Called {renderInlineCode(toolPart.state.title ?? toolPart.tool)}</span>
    case "dynamicToolCall":
      return <span>Used {renderInlineCode(toolPart.state.title ?? toolPart.tool)}</span>
    case "collabAgentToolCall":
      return <span>Started subagent work</span>
    case "imageGeneration":
      return <span>Generated an image</span>
    case "imageView":
      return (
        <span>
          Viewed {renderInlineCode(getBaseName(String(input.path ?? toolPart.state.title ?? "image")))}
        </span>
      )
    case "contextCompaction":
      return <span>Compacted context</span>
    default:
      return <span>{toolPart.state.title ?? toolPart.tool}</span>
  }
}

function DetailBlock({
  label,
  value,
}: {
  label: string
  value: unknown
}) {
  if (value == null || value === "") {
    return null
  }

  return (
    <div>
      <div className="mb-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-2xl bg-muted/45 px-3 py-3 font-mono text-[12px] leading-5 text-foreground/84">
        {prettyValue(value)}
      </pre>
    </div>
  )
}

function renderToolDetails(
  message: MessageWithParts,
  toolPart: RuntimeToolPart,
  childSessions?: Map<string, ChildSessionData>
): ReactNode {
  const { itemType } = message.info
  const { input, output, error } = toolPart.state

  if (itemType === "commandExecution") {
    const commandOutput =
      output && typeof output === "object" && "aggregatedOutput" in output
        ? (output as { aggregatedOutput?: unknown }).aggregatedOutput
        : null

    if (!input.command && !commandOutput && !error) {
      return null
    }

    return (
      <div className="space-y-3">
        <DetailBlock label="Input" value={input.command} />
        <DetailBlock label="Output" value={commandOutput} />
        <DetailBlock label="Error" value={error} />
      </div>
    )
  }

  if (itemType === "fileChange") {
    const source =
      output && typeof output === "object" && "changes" in output
        ? (output as { changes?: unknown[] }).changes
        : undefined
    const fileChanges = getFileChangeEntries(source)
    const outputText =
      output && typeof output === "object" && "outputText" in output
        ? (output as { outputText?: unknown }).outputText
        : null

    if (fileChanges.length === 0 && !outputText) {
      return null
    }

    return (
      <div className="space-y-3">
        {fileChanges.length > 0 ? (
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              Files
            </div>
            {fileChanges.map((change) => (
              <div key={`${change.kind}:${change.path}`} className="rounded-2xl bg-muted/35 px-3 py-3">
                <div className="flex flex-wrap items-center gap-2 text-[13px] leading-5 text-foreground/88">
                  <span className="text-muted-foreground">{change.kind}</span>
                  {renderInlinePath(change.path)}
                </div>
                {change.diff ? (
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-foreground/78">
                    {change.diff}
                  </pre>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        <DetailBlock label="Tool Output" value={outputText} />
      </div>
    )
  }

  if (itemType === "collabAgentToolCall") {
    const receiverIds = Array.isArray(input.receiverThreadIds)
      ? input.receiverThreadIds.filter((value): value is string => typeof value === "string")
      : []
    const linkedChildSessions =
      childSessions && receiverIds.length > 0
        ? receiverIds
            .map((receiverId) => childSessions.get(receiverId))
            .filter((value): value is ChildSessionData => Boolean(value))
        : []

    if (linkedChildSessions.length === 0 && !input.prompt && !output) {
      return null
    }

    return (
      <div className="space-y-3">
        <DetailBlock label="Prompt" value={input.prompt} />
        {linkedChildSessions.length > 0 ? (
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              Subagents
            </div>
            {linkedChildSessions.map((childSession) => (
              <div key={childSession.session.id} className="rounded-2xl bg-muted/35 px-3 py-2 text-[13px] text-foreground/84">
                {childSession.session.title ?? childSession.session.id}
              </div>
            ))}
          </div>
        ) : null}
        <DetailBlock label="Result" value={output} />
      </div>
    )
  }

  if (!Object.keys(input).length && !output && !error) {
    return null
  }

  return (
    <div className="space-y-3">
      <DetailBlock label="Input" value={input} />
      <DetailBlock label="Output" value={output} />
      <DetailBlock label="Error" value={error} />
    </div>
  )
}

function InlineActivityRow({
  icon: IconComponent,
  summary,
  details,
  withinGroup = false,
  approvalState = null,
}: {
  icon?: Icon
  summary: ReactNode
  details?: ReactNode
  withinGroup?: boolean
  approvalState?: RuntimeApprovalDisplayState | null
}) {
  const canExpand = Boolean(details)
  const [isOpen, setIsOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const releaseAnchorTimeoutRef = useRef<number | null>(null)
  const stickToBottom = useStickToBottomContext()

  const releaseAnchorLock = useCallback(() => {
    if (releaseAnchorTimeoutRef.current != null) {
      window.clearTimeout(releaseAnchorTimeoutRef.current)
      releaseAnchorTimeoutRef.current = null
    }

    stickToBottom.targetScrollTop = null
  }, [stickToBottom])

  useEffect(
    () => () => {
      releaseAnchorLock()
    },
    [releaseAnchorLock]
  )

  const handleToggle = useCallback(() => {
    const button = buttonRef.current
    const scrollElement = stickToBottom.scrollRef.current

    if (!button || !scrollElement) {
      setIsOpen((v) => !v)
      return
    }

    releaseAnchorLock()

    const topBefore = button.getBoundingClientRect().top

    // For this toggle only, override the bottom target so the clicked button
    // stays anchored in the same viewport position while the content resizes.
    stickToBottom.targetScrollTop = (_targetScrollTop, { scrollElement }) => {
      const drift = button.getBoundingClientRect().top - topBefore
      return scrollElement.scrollTop + drift
    }

    setIsOpen((v) => !v)

    // Let the resize observer and any instant scroll settle, then make one
    // final correction with the real scroll container before releasing the
    // temporary anchor override.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const drift = button.getBoundingClientRect().top - topBefore

        if (Math.abs(drift) > 1) {
          const maxScrollTop = scrollElement.scrollHeight - scrollElement.clientHeight
          const nextScrollTop = Math.max(0, Math.min(scrollElement.scrollTop + drift, maxScrollTop))

          scrollElement.scrollTop = nextScrollTop
          stickToBottom.state.lastScrollTop = nextScrollTop
          stickToBottom.state.ignoreScrollToTop = nextScrollTop
        }

        releaseAnchorTimeoutRef.current = window.setTimeout(() => {
          releaseAnchorTimeoutRef.current = null
          releaseAnchorLock()
        }, 0)
      })
    })

  }, [releaseAnchorLock, stickToBottom])

  const approvalTone =
    approvalState === "pending"
      ? {
          text: "text-[var(--color-chat-approval-emphasis)]",
          icon: "text-[var(--color-chat-approval-emphasis)]",
        }
      : approvalState === "approved"
        ? {
            text: "text-emerald-600 dark:text-emerald-400",
            icon: "text-emerald-600 dark:text-emerald-400",
          }
        : approvalState === "denied"
          ? {
              text: "text-red-600 dark:text-red-400",
              icon: "text-red-600 dark:text-red-400",
            }
          : null

  const content = (
    <div
      className={cn(
        "group relative w-full py-0 text-sm leading-5",
        approvalTone ? approvalTone.text : "text-muted-foreground"
      )}
    >
      {canExpand ? (
        <button
          ref={buttonRef}
          type="button"
          onClick={handleToggle}
          className="relative z-10 inline-flex max-w-full items-center gap-1.5 align-top text-left"
        >
          {IconComponent ? (
            <IconComponent
              size={14}
              className={cn(
                "shrink-0",
                approvalTone ? approvalTone.icon : "text-muted-foreground/70"
              )}
            />
          ) : null}
          <span className="min-w-0">{summary}</span>
          <span
            className={cn(
              "shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100",
              isOpen && "opacity-100"
            )}
          >
            {isOpen ? <CaretDown className="size-4" /> : <CaretRight className="size-4" />}
          </span>
        </button>
      ) : (
        <span className="inline-flex max-w-full items-center gap-1.5">
          {IconComponent ? (
            <IconComponent
              size={14}
              className={cn(
                "shrink-0",
                approvalTone ? approvalTone.icon : "text-muted-foreground/70"
              )}
            />
          ) : null}
          <span className="min-w-0">{summary}</span>
        </span>
      )}
      {canExpand && isOpen ? (
        <div className="mt-2 w-full border-l border-border/60 pl-4">
          {details}
        </div>
      ) : null}
    </div>
  )

  if (withinGroup) {
    return content
  }

  return (
    <MessageComponent from="assistant">
      <MessageContent>{content}</MessageContent>
    </MessageComponent>
  )
}

export function ToolTimelineRow({
  message,
  toolPart,
  childSessions,
  withinGroup = false,
  approvalState = null,
}: {
  message: MessageWithParts
  toolPart: RuntimeToolPart
  childSessions?: Map<string, ChildSessionData>
  withinGroup?: boolean
  approvalState?: RuntimeApprovalDisplayState | null
}) {
  const details = useMemo(
    () => renderToolDetails(message, toolPart, childSessions),
    [childSessions, message, toolPart]
  )

  if (message.info.itemType === "commandExecution") {
    return (
      <InlineActivityRow
        icon={Bash}
        summary={renderCommandSummary(toolPart)}
        details={details}
        withinGroup={withinGroup}
        approvalState={approvalState}
      />
    )
  }

  if (message.info.itemType === "fileChange") {
    return (
      <InlineActivityRow
        icon={PencilSimple}
        summary={renderFileChangeSummary(toolPart)}
        withinGroup={withinGroup}
        approvalState={approvalState}
      />
    )
  }

  return (
    <InlineActivityRow
      icon={getGenericToolIcon(message.info.itemType)}
      summary={renderGenericToolSummary(message, toolPart)}
      details={details}
      withinGroup={withinGroup}
      approvalState={approvalState}
    />
  )
}

export function InlineSubagentActivity({
  childSession,
}: {
  childSession: ChildSessionData
}) {
  const description = childSession.session.title?.trim() || "Subagent work"

  return (
    <InlineActivityRow icon={Robot} summary={<span>Subagent {description}</span>} />
  )
}

export function ChatTimelineItem({
  message,
  childSessions,
  approvalState = null,
}: ChatTimelineItemProps) {
  const text = getMessageText(message.parts)
  const toolPart = getToolPart(message.parts)

  if (message.info.role === "user") {
    if (!text.trim()) {
      return null
    }

    return (
      <MessageComponent from="user">
        <MessageContent>
          <MessageUserContent>{text}</MessageUserContent>
        </MessageContent>
      </MessageComponent>
    )
  }

  if (toolPart) {
    return (
      <ToolTimelineRow
        message={message}
        toolPart={toolPart}
        childSessions={childSessions}
        approvalState={approvalState}
      />
    )
  }

  if (!text.trim()) {
    return null
  }

  const itemType = message.info.itemType
  const phase = message.info.phase

  if (itemType === "reasoning") {
    return (
      <TimelineTextBlock
        text={text}
      />
    )
  }

  if (itemType === "plan") {
    return (
      <TimelineTextBlock
        eyebrow="Plan"
        text={text}
        tone="accent"
      />
    )
  }

  if (itemType === "enteredReviewMode" || itemType === "exitedReviewMode") {
    return (
      <TimelineTextBlock
        eyebrow={itemType === "enteredReviewMode" ? "Review Mode" : "Review Closed"}
        text={text}
        tone="accent"
      />
    )
  }

  if (itemType === "approval") {
    return (
      <TimelineTextBlock
        eyebrow="Approval"
        text={text}
        tone="muted"
      />
    )
  }

  if (phase === "commentary") {
    return (
      <TimelineTextBlock
        text={text}
      />
    )
  }

  return (
    <TimelineTextBlock
      text={text}
    />
  )
}
