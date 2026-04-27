import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { vcsTextClassNames } from "@/features/shared/appearance"
import {
  Bash,
  CaretDown,
  CaretRight,
  Check,
  Compass,
  Copy,
  Eye,
  Globe,
  Image,
  InformationCircle,
  MagnifyingGlass,
  PencilSimple,
  Refresh,
  Robot,
  ShieldWarning,
  Zap,
  type Icon,
} from "@/components/icons"
import { cn } from "@/lib/utils"
import { desktop } from "@/desktop/client"
import type {
  MessageWithParts,
  RuntimeAttachmentPart,
  RuntimeNotice,
  RuntimeApprovalDisplayState,
  RuntimeMessagePart,
  RuntimeToolPart,
} from "../types"
import { getMessageAttachmentParts, getMessageTextContent } from "../domain/runtimeMessages"
import {
  Message as MessageComponent,
  MessageContent,
  MessageResponse,
  MessageUserContent,
} from "./ai-elements/message"
import type { ChildSessionData } from "./agent-activity/AgentActivitySubagent"
import { getFileChangeEntries, getToolPart } from "./timelineActivity"
import { UploadChip } from "./UploadChip"
import {
  useViewportAnchorToggle,
} from "./useViewportAnchorToggle"
import {
  FileChangeDiffCard,
  buildFileChangePatch,
  countDiffLinesFromPatch,
  renderDiffStats,
} from "./FileChangeDiffCard"

export interface ChatImagePreviewRequest {
  absolutePath: string
  label: string
  mediaType?: string
}

interface ChatTimelineItemProps {
  message: MessageWithParts
  childSessions?: Map<string, ChildSessionData>
  approvalState?: RuntimeApprovalDisplayState | null
  isStreaming?: boolean
  withinGroup?: boolean
  worktreePath?: string | null
  onOpenImagePreview?: (preview: ChatImagePreviewRequest) => void
}

function getMessageText(parts: RuntimeMessagePart[]): string {
  return getMessageTextContent(parts)
}

function UserMessageCopyButton({ text }: { text: string }) {
  const [isCopied, setIsCopied] = useState(false)

  useEffect(() => {
    if (!isCopied) {
      return
    }

    const timeoutId = window.setTimeout(() => setIsCopied(false), 1800)
    return () => window.clearTimeout(timeoutId)
  }, [isCopied])

  if (!text.trim()) {
    return null
  }

  return (
    <button
      type="button"
      onClick={async () => {
        if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
          return
        }

        try {
          await navigator.clipboard.writeText(text)
          setIsCopied(true)
        } catch (error) {
          console.warn("[chat] Failed to copy user message to clipboard:", error)
          setIsCopied(false)
        }
      }}
      className={cn(
        "relative inline-flex h-5 w-5 items-center justify-center self-end overflow-hidden rounded-sm p-0.5 text-muted-foreground/78 opacity-0",
        "transition-[background-color,color,opacity,transform] duration-150 ease-out hover:bg-muted/55 hover:text-foreground active:scale-[0.96]",
        "group-hover:opacity-100 focus-visible:opacity-100",
        isCopied && "text-foreground opacity-100"
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
  )
}

function TimelineTextBlock({
  eyebrow,
  text,
  tone = "default",
  isStreaming = false,
  withinGroup = false,
}: {
  eyebrow?: string
  text: string
  tone?: "default" | "muted" | "accent" | "reasoning"
  isStreaming?: boolean
  withinGroup?: boolean
}) {
  if (withinGroup) {
    const toneClass =
      tone === "muted" || tone === "reasoning"
        ? "text-muted-foreground"
        : tone === "accent"
          ? "text-secondary-foreground/80"
          : "text-foreground"

    return (
      <div className={cn("w-full py-1", toneClass)}>
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
    )
  }

  if (tone === "default" || tone === "reasoning") {
    return (
      <MessageComponent from="assistant">
        <MessageContent>
          <MessageResponse
            isStreaming={isStreaming}
            className={cn(
              "leading-relaxed [&>p]:mb-4 last:[&>p]:mb-0",
              tone === "reasoning" && "text-muted-foreground"
            )}
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
        <div className={cn("w-full rounded-2xl border px-4 py-3", toneClass)}>
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

function TimelineNoticeBlock({
  text,
  notice,
  withinGroup = false,
}: {
  text: string
  notice?: RuntimeNotice
  withinGroup?: boolean
}) {
  const title = getRuntimeNoticeTitle(notice)
  const metadata = getRuntimeNoticeMetadata(notice)
  const IconComponent = getRuntimeNoticeIcon(notice)
  const toneClass = getRuntimeNoticeToneClass(notice)
  const content = (
    <div
      className={cn(
        "inline-flex max-w-full items-start gap-2 rounded-md border px-2.5 py-2 text-[13px] leading-5",
        toneClass
      )}
    >
      <IconComponent className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title ? <div className="font-medium text-foreground/85">{title}</div> : null}
        <div className="text-muted-foreground">{text}</div>
        {metadata.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground/75">
            {metadata.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        ) : null}
      </div>
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

function getRuntimeNoticeIcon(notice: RuntimeNotice | undefined): Icon {
  if (!notice) {
    return InformationCircle
  }

  switch (notice.kind) {
    case "retrying":
      return Refresh
    case "failed":
    case "provider_unavailable":
    case "auth_required":
    case "network_error":
      return ShieldWarning
    case "recovered":
    case "degraded":
    case "rate_limited":
    default:
      return InformationCircle
  }
}

function getRuntimeNoticeToneClass(notice: RuntimeNotice | undefined): string {
  switch (notice?.severity) {
    case "error":
      return "border-destructive/25 bg-destructive/5 text-destructive"
    case "warning":
      return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
    case "info":
    default:
      return "border-border/70 bg-muted/30 text-muted-foreground"
  }
}

function getRuntimeNoticeTitle(notice: RuntimeNotice | undefined): string | null {
  if (!notice) {
    return null
  }

  const target = notice.modelName ?? notice.modelId ?? notice.providerName ?? notice.providerId

  switch (notice.kind) {
    case "retrying":
      return target ? `Retrying ${target}` : "Retrying provider request"
    case "recovered":
      return target ? `${target} recovered` : "Provider recovered"
    case "failed":
      return target ? `${target} failed` : "Provider request failed"
    case "provider_unavailable":
      return target ? `${target} is unavailable` : "Provider unavailable"
    case "rate_limited":
      return target ? `${target} is rate limited` : "Provider rate limited"
    case "auth_required":
      return "Provider authentication required"
    case "network_error":
      return "Provider network issue"
    case "degraded":
      return target ? `${target} is degraded` : "Provider degraded"
    default:
      return "Runtime notice"
  }
}

function getRuntimeNoticeMetadata(notice: RuntimeNotice | undefined): string[] {
  if (!notice) {
    return []
  }

  const metadata: string[] = []

  if (notice.providerName && notice.modelName) {
    metadata.push(notice.providerName)
  }

  if (typeof notice.attempt === "number") {
    metadata.push(`Attempt ${notice.attempt}`)
  }

  if (typeof notice.retryAt === "number") {
    const retryInSeconds = Math.max(0, Math.ceil((notice.retryAt - Date.now()) / 1000))
    metadata.push(`Retrying in ${retryInSeconds}s`)
  }

  return metadata
}

function getBaseName(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean)
  return segments[segments.length - 1] ?? path
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)
}

function joinPathSegments(basePath: string, relativePath: string): string {
  const separator = basePath.includes("\\") ? "\\" : "/"
  const normalizedBase = basePath.replace(/[\\/]+$/, "")
  const normalizedRelative = relativePath.replace(/^[\\/]+/, "").replace(/[\\/]+/g, separator)

  if (!normalizedRelative) {
    return normalizedBase
  }

  return `${normalizedBase}${separator}${normalizedRelative}`
}

function resolvePreviewPath(path: string, worktreePath?: string | null): string | null {
  const trimmedPath = path.trim()

  if (!trimmedPath) {
    return null
  }

  if (isAbsolutePath(trimmedPath)) {
    return trimmedPath
  }

  if (!worktreePath) {
    return null
  }

  return joinPathSegments(worktreePath, trimmedPath)
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

function truncateInlineSummary(value: string, maxLength = 52): string {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

function renderInlineCode(value: string, title?: string, className?: string) {
  return (
    <code
      title={title}
      className={cn(
        "inline-flex min-w-0 max-w-full items-center overflow-hidden whitespace-nowrap rounded-lg bg-muted/80 px-2 py-0.5 align-middle font-mono text-[0.95em] leading-tight text-foreground/92",
        className
      )}
    >
      <span className="block min-w-0 truncate">{value}</span>
    </code>
  )
}

function renderInlinePath(value: string) {
  return <span className="font-mono text-[var(--color-chat-file-accent)]">{value}</span>
}

function getToolFileChanges(toolPart: RuntimeToolPart) {
  const { input, output } = toolPart.state
  const outputSource =
    output && typeof output === "object" && "changes" in output
      ? (output as { changes?: unknown[] }).changes
      : undefined
  const inputSource =
    input && typeof input === "object" && "changes" in input
      ? (input as { changes?: unknown[] }).changes
      : undefined

  return getFileChangeEntries(outputSource ?? inputSource)
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
  const displayCommandLabel = truncateInlineSummary(commandLabel)

  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
      <span className="shrink-0">Bash</span>
      {renderInlineCode(
        displayCommandLabel,
        commandLabel,
        "max-w-[180px] sm:max-w-[220px] md:max-w-[280px]"
      )}
    </span>
  )
}

function AttachmentImagePreview({
  attachment,
  className,
}: {
  attachment: RuntimeAttachmentPart
  className?: string
}) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    if (attachment.kind !== "image") {
      return
    }

    let isActive = true

    void desktop.fs
      .readFileAsDataUrl(attachment.absolutePath, {
        mimeType: attachment.mediaType,
      })
      .then((nextSrc) => {
        if (isActive) {
          setSrc(nextSrc)
        }
      })
      .catch((error) => {
        console.warn("[chat] Failed to load image attachment preview:", attachment.absolutePath, error)
      })

    return () => {
      isActive = false
    }
  }, [attachment.absolutePath, attachment.kind, attachment.mediaType])

  if (!src) {
    return (
      <div className={cn("h-full w-full rounded-sm bg-white/8", className)} />
    )
  }

  return (
    <img
      alt={attachment.label}
      src={src}
      className={cn("h-full w-full rounded-sm object-cover", className)}
    />
  )
}

function SentAttachmentChip({
  attachment,
  onOpenImagePreview,
}: {
  attachment: RuntimeAttachmentPart
  onOpenImagePreview?: (preview: ChatImagePreviewRequest) => void
}) {
  if (attachment.kind === "image" && onOpenImagePreview) {
    return (
      <UploadChip
        kind={attachment.kind}
        label={attachment.label}
        title={`${attachment.label}\n${attachment.relativePath}`}
        surface="user-message"
        onClick={() =>
          onOpenImagePreview({
            absolutePath: attachment.absolutePath,
            label: attachment.label,
            mediaType: attachment.mediaType,
          })
        }
      />
    )
  }

  return (
    <UploadChip
      kind={attachment.kind}
      label={attachment.label}
      title={`${attachment.label}\n${attachment.relativePath}`}
      surface="user-message"
    />
  )
}

function renderFileChangeSummary(
  toolPart: RuntimeToolPart,
  options?: { hideFileNames?: boolean }
) {
  const fileChanges = getToolFileChanges(toolPart)
  const hideFileNames = options?.hideFileNames ?? false

  if (toolPart.state.status === "pending") {
    if (fileChanges.length === 0) {
      return <span>Waiting for approval to apply workspace edits</span>
    }
  }

  if (fileChanges.length === 0) {
    return <span>Prepared workspace edits</span>
  }

  if (hideFileNames) {
    return <span>Edited</span>
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
    return <span key={`${change.path}:${i}`}>{i > 0 ? ", " : ""}{renderInlinePath(fileName)}{renderDiffStats(diff)}</span>
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
      return <span>Generated image</span>
    case "imageView": {
      const imageName = getBaseName(String(input.path ?? toolPart.state.title ?? "image"))
      return (
        <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
          <span className="shrink-0">Image</span>
          <span className="truncate">{imageName}</span>
        </span>
      )
    }
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

function FileChangeDetail({
  change,
}: {
  change: { path: string; kind: string; diff?: string }
}) {
  return <FileChangeDiffCard change={change} />
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
    const fileChanges = getToolFileChanges(toolPart)
    const hasRenderableDiff = fileChanges.some((change) => Boolean(buildFileChangePatch(change)))
    const outputText =
      output && typeof output === "object" && "outputText" in output
        ? (output as { outputText?: unknown }).outputText
        : null

    if (fileChanges.length === 0 && !outputText) {
      return null
    }

    return (
      <div className="space-y-2.5">
        {fileChanges.length > 0 ? (
          <div className="space-y-1.5">
            {fileChanges.map((change) => (
              <FileChangeDetail key={`${change.kind}:${change.path}`} change={change} />
            ))}
          </div>
        ) : null}
        {!hasRenderableDiff ? <DetailBlock label="Tool Output" value={outputText} /> : null}
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
  openSummary,
  details,
  withinGroup = false,
  approvalState = null,
  onPress,
}: {
  icon?: Icon
  summary: ReactNode
  openSummary?: ReactNode
  details?: ReactNode
  withinGroup?: boolean
  approvalState?: RuntimeApprovalDisplayState | null
  onPress?: () => void
}) {
  const canExpand = Boolean(details)
  const isClickable = canExpand || Boolean(onPress)
  const [isOpen, setIsOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const preserveViewportOnToggle = useViewportAnchorToggle()

  const approvalTone =
    approvalState === "pending"
      ? {
          text: "text-[var(--color-chat-approval-emphasis)]",
          icon: "text-[var(--color-chat-approval-emphasis)]",
        }
      : approvalState === "approved"
        ? {
            text: "text-[color:var(--color-success)]",
            icon: "text-[color:var(--color-success)]",
          }
        : approvalState === "denied"
          ? {
              text: "text-[color:var(--color-destructive)]",
              icon: "text-[color:var(--color-destructive)]",
            }
          : null

  const content = (
    <div
      className={cn(
        "group relative w-full py-0 text-sm leading-5",
        approvalTone ? approvalTone.text : "text-muted-foreground"
      )}
    >
      {isClickable ? (
        <button
          ref={buttonRef}
          type="button"
          onClick={() => {
            if (canExpand) {
              preserveViewportOnToggle(buttonRef.current, () => {
                setIsOpen((v) => !v)
              })
              return
            }

            onPress?.()
          }}
          className="relative z-10 inline-flex max-w-full items-center gap-1.5 align-top text-left hover:text-foreground/88"
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
          <span className="min-w-0 flex-1">{isOpen && openSummary ? openSummary : summary}</span>
          {canExpand ? (
            <span
              className={cn(
                "shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100",
                isOpen && "opacity-100"
              )}
            >
              {isOpen ? <CaretDown className="size-4" /> : <CaretRight className="size-4" />}
            </span>
          ) : null}
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
          <span className="min-w-0 flex-1">{summary}</span>
        </span>
      )}
      {canExpand && isOpen ? (
        <div className="mt-2 w-full">
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
  worktreePath,
  onOpenImagePreview,
}: {
  message: MessageWithParts
  toolPart: RuntimeToolPart
  childSessions?: Map<string, ChildSessionData>
  withinGroup?: boolean
  approvalState?: RuntimeApprovalDisplayState | null
  worktreePath?: string | null
  onOpenImagePreview?: (preview: ChatImagePreviewRequest) => void
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
        openSummary={renderFileChangeSummary(toolPart, { hideFileNames: true })}
        details={details}
        withinGroup={withinGroup}
        approvalState={approvalState}
      />
    )
  }

  if (message.info.itemType === "imageView") {
    const rawPath = String(toolPart.state.input.path ?? toolPart.state.title ?? "").trim()
    const resolvedPath = resolvePreviewPath(rawPath, worktreePath)

    return (
      <InlineActivityRow
        icon={Image}
        summary={renderGenericToolSummary(message, toolPart)}
        withinGroup={withinGroup}
        approvalState={approvalState}
        onPress={
          resolvedPath && onOpenImagePreview
            ? () =>
                onOpenImagePreview({
                  absolutePath: resolvedPath,
                  label: getBaseName(rawPath) || "Image",
                })
            : undefined
        }
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
  isStreaming = false,
  withinGroup = false,
  worktreePath,
  onOpenImagePreview,
}: ChatTimelineItemProps) {
  const text = getMessageText(message.parts)
  const attachments = getMessageAttachmentParts(message.parts)
  const toolPart = getToolPart(message.parts)

  if (message.info.role === "user") {
    if (!text.trim() && attachments.length === 0) {
      return null
    }

    return (
      <MessageComponent from="user" className="gap-1">
        <MessageContent className="gap-3">
          {text.trim() ? <MessageUserContent>{text}</MessageUserContent> : null}
          {attachments.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {attachments.map((attachment) => (
                <SentAttachmentChip
                  key={attachment.id}
                  attachment={attachment}
                  onOpenImagePreview={onOpenImagePreview}
                />
              ))}
            </div>
          ) : null}
        </MessageContent>
        <UserMessageCopyButton text={text} />
      </MessageComponent>
    )
  }

  if (toolPart) {
    return (
      <ToolTimelineRow
        message={message}
        toolPart={toolPart}
        childSessions={childSessions}
        withinGroup={withinGroup}
        approvalState={approvalState}
        worktreePath={worktreePath}
        onOpenImagePreview={onOpenImagePreview}
      />
    )
  }

  if (!text.trim()) {
    return null
  }

  const itemType = message.info.itemType
  const phase = message.info.phase

  if (itemType === "providerNotice") {
    return (
      <TimelineNoticeBlock
        text={text}
        notice={message.info.runtimeNotice}
        withinGroup={withinGroup}
      />
    )
  }

  if (itemType === "reasoning") {
    return (
      <TimelineTextBlock
        text={text}
        tone="reasoning"
        isStreaming={isStreaming}
        withinGroup={withinGroup}
      />
    )
  }

  if (itemType === "plan") {
    return (
      <TimelineTextBlock
        eyebrow="Plan"
        text={text}
        tone="accent"
        isStreaming={isStreaming}
        withinGroup={withinGroup}
      />
    )
  }

  if (itemType === "enteredReviewMode" || itemType === "exitedReviewMode") {
    return (
      <TimelineTextBlock
        eyebrow={itemType === "enteredReviewMode" ? "Review Mode" : "Review Closed"}
        text={text}
        tone="accent"
        isStreaming={isStreaming}
        withinGroup={withinGroup}
      />
    )
  }

  if (itemType === "approval") {
    return (
      <TimelineTextBlock
        eyebrow="Approval"
        text={text}
        tone="muted"
        isStreaming={isStreaming}
        withinGroup={withinGroup}
      />
    )
  }

  if (phase === "commentary") {
    return (
      <TimelineTextBlock
        text={text}
        isStreaming={isStreaming}
        withinGroup={withinGroup}
      />
    )
  }

  return (
    <TimelineTextBlock
      text={text}
      isStreaming={isStreaming}
      withinGroup={withinGroup}
    />
  )
}
