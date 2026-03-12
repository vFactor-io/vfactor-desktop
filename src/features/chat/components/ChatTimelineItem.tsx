import { useMemo, useState, type ReactNode } from "react"
import {
  CaretDown,
  CaretRight,
} from "@/components/icons"
import { cn } from "@/lib/utils"
import type { MessageWithParts, RuntimeMessagePart, RuntimeToolPart } from "../types"
import {
  Message as MessageComponent,
  MessageContent,
  MessageResponse,
  MessageUserContent,
} from "./ai-elements/message"
import type { ChildSessionData } from "./agent-activity/AgentActivitySubagent"

interface ChatTimelineItemProps {
  message: MessageWithParts
  isStreaming: boolean
  childSessions?: Map<string, ChildSessionData>
}

function getMessageText(parts: RuntimeMessagePart[]): string {
  return parts
    .filter((part): part is Extract<RuntimeMessagePart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("")
}

function getToolPart(parts: RuntimeMessagePart[]): RuntimeToolPart | null {
  return parts.find((part): part is RuntimeToolPart => part.type === "tool") ?? null
}

function getFileChangeEntries(value: unknown): Array<{ path: string; kind: string; diff?: string }> {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return []
    }

    const path = "path" in entry && typeof entry.path === "string" ? entry.path : null
    const kind =
      "kind" in entry &&
      entry.kind &&
      typeof entry.kind === "object" &&
      "type" in entry.kind &&
      typeof entry.kind.type === "string"
        ? entry.kind.type
        : "change"
    const diff = "diff" in entry && typeof entry.diff === "string" ? entry.diff : undefined

    return path ? [{ path, kind, diff }] : []
  })
}

function TimelineTextBlock({
  eyebrow,
  text,
  isStreaming,
  tone = "default",
}: {
  eyebrow?: string
  text: string
  isStreaming: boolean
  tone?: "default" | "muted" | "accent"
}) {
  if (tone === "default") {
    return (
      <MessageComponent from="assistant">
        <MessageContent>
          <MessageResponse
            isStreaming={isStreaming}
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
            isStreaming={isStreaming}
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
    <code className="rounded-[0.75rem] bg-muted/80 px-2 py-0.5 font-mono text-[0.95em] text-foreground/92">
      {value}
    </code>
  )
}

function renderInlinePath(value: string) {
  return <span className="font-mono text-[var(--color-chat-file-accent)]">{value}</span>
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
  const actions = Array.isArray(input.commandActions) ? input.commandActions : []
  const action = actions[0]
  const commandLabel = getCommandLabel(input.command ?? toolPart.state.title)

  if (action && typeof action === "object" && "type" in action && typeof action.type === "string") {
    if (action.type === "listFiles") {
      return <span>Explored 1 list</span>
    }

    if (action.type === "read") {
      const target =
        "name" in action && typeof action.name === "string"
          ? action.name
          : "path" in action && typeof action.path === "string"
            ? getBaseName(action.path)
            : commandLabel

      return (
        <span>
          Read {renderInlineCode(target)}
        </span>
      )
    }

    if (action.type === "search") {
      const target =
        "pattern" in action && typeof action.pattern === "string"
          ? action.pattern
          : "query" in action && typeof action.query === "string"
            ? action.query
            : commandLabel

      return (
        <span>
          Searched for {renderInlineCode(target)}
        </span>
      )
    }
  }

  if (toolPart.state.status === "running" || toolPart.state.status === "pending") {
    return (
      <span>
        Background terminal running {renderInlineCode(commandLabel)}
      </span>
    )
  }

  if (toolPart.state.status === "error") {
    return (
      <span>
        Background terminal failed with {renderInlineCode(commandLabel)}
      </span>
    )
  }

  return (
    <span>
      Background terminal finished with {renderInlineCode(commandLabel)}
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

  if (fileChanges.length === 0) {
    return <span>Prepared workspace edits</span>
  }

  const totals = fileChanges.reduce(
    (result, change) => {
      const stats = countDiffLines(change.diff)
      return {
        added: result.added + stats.added,
        removed: result.removed + stats.removed,
      }
    },
    { added: 0, removed: 0 }
  )
  const primaryPath = getBaseName(fileChanges[0]?.path ?? "file")

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span>{fileChanges.length === 1 ? "Edited" : `Edited ${fileChanges.length} files including`}</span>
      {renderInlinePath(primaryPath)}
      {totals.added > 0 ? <span className="text-emerald-500">+{totals.added}</span> : null}
      {totals.removed > 0 ? <span className="text-red-500">-{totals.removed}</span> : null}
    </span>
  )
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
    const cwd =
      input && typeof input === "object" && "cwd" in input ? (input as { cwd?: unknown }).cwd : null

    if (!input.command && !cwd && !commandOutput && !error) {
      return null
    }

    return (
      <div className="space-y-3">
        <DetailBlock label="Command" value={input.command} />
        <DetailBlock label="Directory" value={cwd} />
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
  summary,
  details,
}: {
  summary: ReactNode
  details?: ReactNode
}) {
  const canExpand = Boolean(details)
  const [isOpen, setIsOpen] = useState(false)

  return (
    <MessageComponent from="assistant">
      <MessageContent>
        <div className="group w-full py-0 text-[14px] leading-5 text-muted-foreground">
          {canExpand ? (
            <button
              type="button"
              onClick={() => setIsOpen((value) => !value)}
              className="inline-flex max-w-full items-center gap-1.5 align-top text-left"
            >
              <div className="min-w-0">{summary}</div>
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
            <div className="min-w-0">{summary}</div>
          )}
          {canExpand && isOpen ? (
            <div className="mt-2 border-l border-border/60 pl-4">
              {details}
            </div>
          ) : null}
        </div>
      </MessageContent>
    </MessageComponent>
  )
}

function ToolTimelineRow({
  message,
  toolPart,
  childSessions,
}: {
  message: MessageWithParts
  toolPart: RuntimeToolPart
  childSessions?: Map<string, ChildSessionData>
}) {
  const details = useMemo(
    () => renderToolDetails(message, toolPart, childSessions),
    [childSessions, message, toolPart]
  )

  if (message.info.itemType === "commandExecution") {
    return (
      <InlineActivityRow summary={renderCommandSummary(toolPart)} details={details} />
    )
  }

  if (message.info.itemType === "fileChange") {
    return (
      <InlineActivityRow summary={renderFileChangeSummary(toolPart)} details={details} />
    )
  }

  return (
    <InlineActivityRow summary={renderGenericToolSummary(message, toolPart)} details={details} />
  )
}

export function InlineSubagentActivity({
  childSession,
}: {
  childSession: ChildSessionData
}) {
  const description = childSession.session.title?.trim() || "Subagent work"

  return (
    <InlineActivityRow summary={<span>Subagent {description}</span>} />
  )
}

export function ChatTimelineItem({
  message,
  isStreaming,
  childSessions,
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
    return <ToolTimelineRow message={message} toolPart={toolPart} childSessions={childSessions} />
  }

  if (!text.trim() && !isStreaming) {
    return null
  }

  const itemType = message.info.itemType
  const phase = message.info.phase

  if (itemType === "reasoning") {
    return <TimelineTextBlock text={text} isStreaming={isStreaming} />
  }

  if (itemType === "plan") {
    return (
      <TimelineTextBlock eyebrow="Plan" text={text} isStreaming={isStreaming} tone="accent" />
    )
  }

  if (itemType === "enteredReviewMode" || itemType === "exitedReviewMode") {
    return (
      <TimelineTextBlock
        eyebrow={itemType === "enteredReviewMode" ? "Review Mode" : "Review Closed"}
        text={text}
        isStreaming={isStreaming}
        tone="accent"
      />
    )
  }

  if (phase === "commentary") {
    return <TimelineTextBlock text={text} isStreaming={isStreaming} />
  }

  return <TimelineTextBlock text={text} isStreaming={isStreaming} />
}
