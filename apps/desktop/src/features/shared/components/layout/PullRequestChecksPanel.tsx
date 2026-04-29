import {
  CaretRight,
  CheckCircle,
  CircleNotch,
  GitCommit,
  Clock,
  InformationCircle,
  X,
} from "@/components/icons"
import {
  desktop,
  type GitPullRequest as DesktopGitPullRequest,
  type GitPullRequestCheck,
  type GitPullRequestCommit,
  type GitPullRequestComment,
  type GitPullRequestReviewComment,
  type GitPullRequestReview,
} from "@/desktop/client"
import { PatchDiff } from "@pierre/diffs/react"
import { MessageResponse } from "@/features/chat/components/ai-elements/message"
import {
  feedbackIconClassName,
  feedbackSurfaceClassName,
  useAppearance,
  type PierreThemeName,
} from "@/features/shared/appearance"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/features/shared/components/ui/collapsible"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/features/shared/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from "react"
import { sortPullRequestChecks, summarizePullRequestChecks } from "./pullRequestChecks"
import {
  buildReviewPatch,
  getReviewDiffLineRange,
  getReviewDiffSelectedLines,
  type ReviewDiffLineRange,
} from "./pullRequestReviewDiff"
import {
  buildPullRequestTimeline,
  type PullRequestTimelineItem,
  type ReviewCommentThread,
} from "./pullRequestTimeline"
import { RightSidebarEmptyState } from "./RightSidebarEmptyState"

interface PullRequestChecksPanelProps {
  pullRequest: DesktopGitPullRequest | null
  checks: GitPullRequestCheck[]
  commits: GitPullRequestCommit[]
  comments: GitPullRequestComment[]
  reviews: GitPullRequestReview[]
  reviewComments: GitPullRequestReviewComment[]
  isLoading: boolean
  loadError: string | null
}

type ReviewBadge = {
  label: string
  toneClassName: string
}

type ParsedGitHubBody = {
  title: string | null
  segments: GitHubBodySegment[]
  badges: ReviewBadge[]
}

type GitHubBodySegment =
  | {
      kind: "markdown"
      body: string
    }
  | {
      kind: "details"
      summary: string
      body: string
      defaultOpen: boolean
    }

function ExternalLink({ href, onClick, children, ...props }: ComponentProps<"a">) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (event.defaultPrevented || !href) {
      return
    }

    event.preventDefault()
    void desktop.shell.openExternal(href)
  }

  return (
    <a href={href} onClick={handleClick} {...props}>
      {children}
    </a>
  )
}

function ActivityAvatar({
  avatarUrl,
  alt,
  fallback,
}: {
  avatarUrl: string | null | undefined
  alt: string
  fallback: ReactNode
}) {
  const [hasImageError, setHasImageError] = useState(false)

  useEffect(() => {
    setHasImageError(false)
  }, [avatarUrl])

  return (
    <div className="mt-0.5 size-5 shrink-0 overflow-hidden rounded-full border border-sidebar-border/60 bg-card">
      {avatarUrl && !hasImageError ? (
        <img
          src={avatarUrl}
          alt={alt}
          className="size-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setHasImageError(true)}
        />
      ) : (
        fallback
      )}
    </div>
  )
}

function getCheckTone(status: GitPullRequestCheck["status"]): string {
  switch (status) {
    case "pending":
      return feedbackIconClassName("warning")
    case "failed":
      return feedbackIconClassName("destructive")
    case "passed":
      return feedbackIconClassName("success")
    case "cancelled":
      return "text-muted-foreground"
    case "skipped":
      return "text-muted-foreground"
    default:
      return "text-muted-foreground"
  }
}

function getCheckStatusLabel(status: GitPullRequestCheck["status"]): string {
  switch (status) {
    case "pending":
      return "Pending"
    case "failed":
      return "Failed"
    case "passed":
      return "Passed"
    case "cancelled":
      return "Cancelled"
    case "skipped":
      return "Skipped"
    default:
      return "Unknown"
  }
}

function truncateMiddle(value: string, startChars = 12, endChars = 11) {
  if (value.length <= startChars + endChars + 3) {
    return value
  }

  return `${value.slice(0, startChars)}...${value.slice(-endChars)}`
}

function ReviewPathLabel({ path }: { path: string }) {
  const truncatedPath = truncateMiddle(path)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="block max-w-[11.5rem] truncate text-xs font-medium text-muted-foreground">
          {truncatedPath}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="max-w-[32rem] break-all text-sm leading-5">
        {path}
      </TooltipContent>
    </Tooltip>
  )
}

function CheckStatusIcon({ status }: { status: GitPullRequestCheck["status"] }) {
  const className = cn("size-4 shrink-0", getCheckTone(status))

  switch (status) {
    case "pending":
      return <CircleNotch size={15} className={cn(className, "animate-spin")} />
    case "failed":
      return <X size={15} className={className} />
    case "passed":
      return <CheckCircle size={15} className={className} />
    case "cancelled":
      return <Clock size={15} className={className} />
    case "skipped":
      return <InformationCircle size={15} className={className} />
    default:
      return <InformationCircle size={15} className={className} />
  }
}

function getReviewTone(state: GitPullRequestReview["state"]): string {
  switch (state) {
    case "APPROVED":
      return feedbackIconClassName("success")
    case "CHANGES_REQUESTED":
      return feedbackIconClassName("destructive")
    case "COMMENTED":
      return feedbackIconClassName("info")
    case "PENDING":
      return feedbackIconClassName("warning")
    case "DISMISSED":
      return "text-muted-foreground"
    default:
      return "text-muted-foreground"
  }
}

function getReviewStatusLabel(state: GitPullRequestReview["state"]): string {
  switch (state) {
    case "APPROVED":
      return "Approved"
    case "CHANGES_REQUESTED":
      return "Changes requested"
    case "COMMENTED":
      return "Commented"
    case "PENDING":
      return "Pending"
    case "DISMISSED":
      return "Dismissed"
    default:
      return "Review"
  }
}

function ReviewStatusIcon({ state }: { state: GitPullRequestReview["state"] }) {
  const className = cn("size-4 shrink-0", getReviewTone(state))

  switch (state) {
    case "APPROVED":
      return <CheckCircle size={15} className={className} />
    case "CHANGES_REQUESTED":
      return <X size={15} className={className} />
    case "COMMENTED":
      return <InformationCircle size={15} className={className} />
    case "PENDING":
      return <CircleNotch size={15} className={cn(className, "animate-spin")} />
    case "DISMISSED":
      return <Clock size={15} className={className} />
    default:
      return <InformationCircle size={15} className={className} />
  }
}

function formatReviewTimestamp(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return date.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

function formatRelativeTimestamp(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  const diffMs = Date.now() - date.getTime()
  if (diffMs < 0) {
    return "just now"
  }

  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 45) {
    return "just now"
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m ago`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}h ago`
  }
  const days = Math.floor(hours / 24)
  if (days < 7) {
    return `${days}d ago`
  }
  if (days < 30) {
    return `${Math.floor(days / 7)}w ago`
  }
  return date.toLocaleDateString([], { dateStyle: "medium" })
}

function normalizeBadgeLabel(value: string): string {
  const normalized = value.replace(/\bbadge\b/gi, "").replace(/\s+/g, " ").trim()
  return normalized || value.trim()
}

function getBadgeToneClassName(label: string, url: string): string {
  const normalizedLabel = label.toUpperCase()
  const normalizedUrl = url.toLowerCase()

  if (normalizedLabel.includes("P0") || normalizedUrl.includes("badge/p0-")) {
    return feedbackSurfaceClassName("destructive")
  }

  if (normalizedLabel.includes("P1") || normalizedUrl.includes("badge/p1-")) {
    return feedbackSurfaceClassName("warning")
  }

  if (normalizedLabel.includes("P2") || normalizedUrl.includes("badge/p2-")) {
    return feedbackSurfaceClassName("warning")
  }

  if (normalizedLabel.includes("P3") || normalizedUrl.includes("badge/p3-")) {
    return feedbackSurfaceClassName("info")
  }

  return "border-border bg-muted/60 text-foreground/80"
}

function normalizeGitHubMarkdown(value: string): string | null {
  const normalized = value
    .replace(/<picture\b[\s\S]*?<\/picture>/gi, "")
    .replace(/<img\b[^>]*>/gi, "")
    .split("\n")
    .map((line) => line.replace(/<[^>]+>/g, "").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\*\*\s+/gm, "**")
    .replace(/\s+\*\*$/gm, "**")
    .replace(/[ \t]{2,}/g, " ")
    .trim()

  return normalized || null
}

function parseGitHubDetailsSegments(value: string): GitHubBodySegment[] {
  const segments: GitHubBodySegment[] = []
  const detailsPattern = /<details\b([^>]*)>([\s\S]*?)<\/details>/gi
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = detailsPattern.exec(value)) !== null) {
    const before = normalizeGitHubMarkdown(value.slice(lastIndex, match.index))
    if (before) {
      segments.push({ kind: "markdown", body: before })
    }

    const attributes = match[1] ?? ""
    const content = match[2] ?? ""
    const summaryMatch = content.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i)
    const summary = normalizeGitHubMarkdown(summaryMatch?.[1] ?? "Details") ?? "Details"
    const detailsBody = normalizeGitHubMarkdown(
      summaryMatch
        ? content.slice(0, summaryMatch.index) + content.slice((summaryMatch.index ?? 0) + summaryMatch[0].length)
        : content
    )

    if (detailsBody) {
      segments.push({
        kind: "details",
        summary,
        body: detailsBody,
        defaultOpen: /(?:^|\s)open(?:\s|=|$)/i.test(attributes),
      })
    }

    lastIndex = match.index + match[0].length
  }

  const after = normalizeGitHubMarkdown(value.slice(lastIndex))
  if (after) {
    segments.push({ kind: "markdown", body: after })
  }

  return segments
}

function parseGitHubBody(
  value: string | null | undefined
): ParsedGitHubBody {
  const trimmed = value?.trim()
  if (!trimmed) {
    return { title: null, segments: [], badges: [] }
  }

  const badges: ReviewBadge[] = []
  const withoutMetadata = trimmed.replace(/^\[vc\]:.*$/gim, "")
  const withoutMarkdownImages = withoutMetadata.replace(
    /!\[([^\]]*)]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g,
    (_match, altText: string, imageUrl: string) => {
      const normalizedAltText = altText.trim()
      const isBadge =
        /\bbadge\b/i.test(normalizedAltText) ||
        /img\.shields\.io|badge\//i.test(imageUrl)

      if (isBadge) {
        const label = normalizeBadgeLabel(normalizedAltText || imageUrl.split("/").pop() || "Badge")
        badges.push({
          label,
          toneClassName: getBadgeToneClassName(label, imageUrl),
        })
        return ""
      }

      return normalizedAltText ? `\`${normalizedAltText}\`` : ""
    }
  )
  const withMarkdownLinks = withoutMarkdownImages.replace(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_match, href: string, text: string) => {
      const label = text.replace(/<[^>]+>/g, "").trim()
      return label ? `[${label}](${href})` : href
    }
  )
  let segments = parseGitHubDetailsSegments(withMarkdownLinks)
  if (segments.length === 0) {
    return { title: null, segments: [], badges }
  }

  const firstSegment = segments[0]
  const titleMatch =
    firstSegment.kind === "markdown"
      ? firstSegment.body.match(/^\*\*([^\n]+?)\*\*(?:\n\s*\n)?([\s\S]*)?$/)
      : null
  if (titleMatch) {
    const title = titleMatch[1]?.trim() || null
    const remainingBody = titleMatch[2]?.trim() || null
    segments = remainingBody
      ? [{ kind: "markdown", body: remainingBody }, ...segments.slice(1)]
      : segments.slice(1)
    return {
      title,
      segments,
      badges,
    }
  }

  return { title: null, segments, badges }
}

const markdownBodyClassName = cn(
  "[&>*]:text-inherit",
  "[&_h1]:!text-sm [&_h1]:font-semibold [&_h1]:!leading-5 [&_h1]:mt-0 [&_h1]:mb-1.5",
  "[&_h2]:!text-sm [&_h2]:font-semibold [&_h2]:!leading-5 [&_h2]:mt-0 [&_h2]:mb-1.5",
  "[&_h3]:!text-xs [&_h3]:font-semibold [&_h3]:!leading-5 [&_h3]:mt-0 [&_h3]:mb-1",
  "[&_h4]:!text-xs [&_h4]:font-medium [&_h4]:!leading-5 [&_h4]:mt-0 [&_h4]:mb-1",
  "[&_p]:my-0 [&_p+p]:mt-1.5",
  "[&_ul]:my-1 [&_ul]:pl-4 [&_ol]:my-1 [&_ol]:pl-4",
  "[&_li]:text-xs [&_li]:leading-5 [&_li+li]:mt-0.5",
  "[&_blockquote]:my-1.5 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3",
  "[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-left",
  "[&_th]:border-b [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:font-medium",
  "[&_td]:border-b [&_td]:border-border/60 [&_td]:px-2 [&_td]:py-1 align-top",
  "[&_pre]:my-1.5 [&_pre]:text-[11px] [&_pre]:leading-4",
  "[&_code]:text-[11px]",
  "[&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-2"
)

function MarkdownSegment({ body }: { body: string }) {
  return <MessageResponse className={markdownBodyClassName}>{body}</MessageResponse>
}

function DetailsSegment({ segment }: { segment: Extract<GitHubBodySegment, { kind: "details" }> }) {
  return (
    <details
      className="group"
      open={segment.defaultOpen ? true : undefined}
    >
      <summary className="flex cursor-pointer select-none items-center gap-1.5 text-xs font-medium text-foreground marker:content-none [&::-webkit-details-marker]:hidden">
        <CaretRight
          size={12}
          className="shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
        />
        <span className="min-w-0 truncate">{segment.summary}</span>
      </summary>
      <div className="mt-1.5 pl-4 text-muted-foreground">
        <MarkdownSegment body={segment.body} />
      </div>
    </details>
  )
}

function MarkdownBody({ body }: { body: string | null | undefined }) {
  const { title, segments, badges } = parseGitHubBody(body)
  if (!title && segments.length === 0 && badges.length === 0) {
    return null
  }

  return (
    <div className="text-xs leading-5 text-muted-foreground">
      {title || badges.length > 0 ? (
        <div className="mb-2 flex items-center gap-2">
          {badges.length > 0 ? (
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              {badges.map((badge) => (
                <span
                  key={`${badge.label}:${badge.toneClassName}`}
                  className={cn(
                    "inline-flex items-center rounded-sm border px-1 py-0.5 text-[9px] font-semibold leading-none tracking-[0.03em]",
                    badge.toneClassName
                  )}
                >
                  {badge.label}
                </span>
              ))}
            </div>
          ) : null}
          {title ? (
            <div className="min-w-0 text-sm font-semibold leading-5 text-foreground">
              {title}
            </div>
          ) : null}
        </div>
      ) : null}
      {segments.length > 0 ? (
        <div className="space-y-2">
          {segments.map((segment, index) =>
            segment.kind === "markdown" ? (
              <MarkdownSegment key={`${segment.kind}:${index}`} body={segment.body} />
            ) : (
              <DetailsSegment key={`${segment.kind}:${index}`} segment={segment} />
            )
          )}
        </div>
      ) : null}
    </div>
  )
}

function ReviewDiffHunk({
  path,
  diffHunk,
  lineRange,
  theme,
}: {
  path: string | null | undefined
  diffHunk: string | null | undefined
  lineRange: ReviewDiffLineRange | null
  theme: PierreThemeName
}) {
  const patch = buildReviewPatch(path, diffHunk, lineRange)
  const selectedLines = getReviewDiffSelectedLines(lineRange)
  if (!patch) {
    return null
  }

  return (
    <div className="overflow-hidden rounded-md border border-sidebar-border/60 bg-background/70">
      <PatchDiff
        patch={patch}
        disableWorkerPool
        selectedLines={selectedLines}
        options={{
          theme,
          themeType: theme === "pierre-dark" ? "dark" : "light",
          diffStyle: "unified",
          diffIndicators: "classic",
          hunkSeparators: "line-info-basic",
          overflow: "wrap",
          disableFileHeader: true,
          disableBackground: false,
          lineDiffType: "word",
          unsafeCSS: `
            [data-code] {
              padding-top: 0 !important;
              padding-bottom: 0 !important;
            }
          `,
        }}
        className="text-xs"
      />
    </div>
  )
}

function getReviewActionVerb(state: GitPullRequestReview["state"]): string {
  switch (state) {
    case "APPROVED":
      return "approved"
    case "CHANGES_REQUESTED":
      return "requested changes"
    case "COMMENTED":
      return "reviewed"
    case "PENDING":
      return "started a review"
    case "DISMISSED":
      return "dismissed a review"
    default:
      return "reviewed"
  }
}

function ReviewStateBadge({ state }: { state: GitPullRequestReview["state"] }) {
  if (state === "UNKNOWN") {
    return null
  }

  const label = getReviewStatusLabel(state)
  let toneClassName: string
  switch (state) {
    case "APPROVED":
      toneClassName = feedbackSurfaceClassName("success")
      break
    case "CHANGES_REQUESTED":
      toneClassName = feedbackSurfaceClassName("destructive")
      break
    case "PENDING":
      toneClassName = feedbackSurfaceClassName("warning")
      break
    case "COMMENTED":
      toneClassName = feedbackSurfaceClassName("info")
      break
    default:
      toneClassName = "border border-border bg-muted/60 text-foreground/80"
      break
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-medium leading-none tracking-[0.02em]",
        toneClassName
      )}
    >
      {label}
    </span>
  )
}

function EventTimestamp({ value }: { value: string | null | undefined }) {
  const relative = formatRelativeTimestamp(value)
  const absolute = formatReviewTimestamp(value)
  if (!relative) {
    return null
  }

  if (absolute) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-muted-foreground/80">{relative}</span>
        </TooltipTrigger>
        <TooltipContent side="top" align="end" className="text-xs">
          {absolute}
        </TooltipContent>
      </Tooltip>
    )
  }

  return <span className="text-muted-foreground/80">{relative}</span>
}

function TimelineRail({ children }: { children: ReactNode }) {
  return (
    <ol className="relative space-y-3">
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-2 left-3 top-2 w-px bg-sidebar-border/50"
      />
      {children}
    </ol>
  )
}

function TimelineItemFrame({
  avatar,
  header,
  children,
  isLast,
}: {
  avatar: ReactNode
  header: ReactNode
  children?: ReactNode
  isLast?: boolean
}) {
  return (
    <li className={cn("relative pl-9", !isLast && "pb-1")}>
      <div className="absolute left-0 top-0 z-10 ring-2 ring-[color:var(--right-sidebar-content-bg,var(--background))]">
        {avatar}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex min-h-5 items-center gap-1.5 pt-0.5 text-xs text-muted-foreground">
          {header}
        </div>
        {children}
      </div>
    </li>
  )
}

function ChecksBlock({
  pullRequest,
  checks,
}: {
  pullRequest: DesktopGitPullRequest
  checks: GitPullRequestCheck[]
}) {
  const sorted = useMemo(() => sortPullRequestChecks(checks), [checks])
  const summary = summarizePullRequestChecks(pullRequest, checks)
  const [isOpen, setIsOpen] = useState(summary.tone === "failed" || summary.tone === "waiting")

  // Re-sync expansion if the tone changes (e.g. checks start failing later).
  useEffect(() => {
    if (summary.tone === "failed" || summary.tone === "waiting") {
      setIsOpen(true)
    }
  }, [summary.tone])

  if (sorted.length === 0 && summary.totalCount === 0) {
    return null
  }

  let summaryIcon: ReactNode
  let summaryToneClass: string
  switch (summary.tone) {
    case "failed":
      summaryIcon = <X size={15} className={cn("size-4 shrink-0", feedbackIconClassName("destructive"))} />
      summaryToneClass = feedbackIconClassName("destructive")
      break
    case "waiting":
      summaryIcon = (
        <CircleNotch
          size={15}
          className={cn("size-4 shrink-0", feedbackIconClassName("warning"), "animate-spin")}
        />
      )
      summaryToneClass = feedbackIconClassName("warning")
      break
    case "passed":
      summaryIcon = <CheckCircle size={15} className={cn("size-4 shrink-0", feedbackIconClassName("success"))} />
      summaryToneClass = feedbackIconClassName("success")
      break
    default:
      summaryIcon = <Clock size={15} className="size-4 shrink-0 text-muted-foreground" />
      summaryToneClass = "text-muted-foreground"
      break
  }

  const detailParts: string[] = []
  if (summary.failedCount > 0) {
    detailParts.push(`${summary.failedCount} failing`)
  }
  if (summary.pendingCount > 0) {
    detailParts.push(`${summary.pendingCount} running`)
  }
  if (summary.passedCount > 0) {
    detailParts.push(`${summary.passedCount} passed`)
  }
  if (summary.skippedCount > 0) {
    detailParts.push(`${summary.skippedCount} skipped`)
  }
  if (summary.cancelledCount > 0) {
    detailParts.push(`${summary.cancelledCount} cancelled`)
  }
  const detailLine = detailParts.length > 0 ? detailParts.join(" · ") : null

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="overflow-hidden rounded-xl border border-sidebar-border/60 bg-background/55">
        <CollapsibleTrigger
          className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-sidebar-accent/40"
          disabled={sorted.length === 0}
        >
          {summaryIcon}
          <div className="min-w-0 flex-1">
            <div className={cn("text-sm font-medium", summaryToneClass)}>{summary.label}</div>
            {detailLine ? (
              <div className="text-xs text-muted-foreground">{detailLine}</div>
            ) : null}
          </div>
          {sorted.length > 0 ? (
            <CaretRight
              size={12}
              className={cn(
                "shrink-0 text-muted-foreground transition-transform",
                isOpen && "rotate-90"
              )}
            />
          ) : null}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-sidebar-border/40 px-3 py-2">
            <ul className="space-y-1.5">
              {sorted.map((check) => (
                <li key={check.id} className="flex items-center justify-between gap-3 text-xs">
                  <div className="flex min-w-0 items-center gap-2">
                    <CheckStatusIcon status={check.status} />
                    {check.detailsUrl ? (
                      <ExternalLink
                        href={check.detailsUrl}
                        className="truncate text-foreground hover:underline"
                      >
                        {check.name}
                      </ExternalLink>
                    ) : (
                      <span className="truncate text-foreground">{check.name}</span>
                    )}
                  </div>
                  <span className={cn("shrink-0 text-[11px]", getCheckTone(check.status))}>
                    {getCheckStatusLabel(check.status)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

function ThreadHeader({ thread }: { thread: ReviewCommentThread }) {
  const lineRange = getReviewDiffLineRange(
    thread.rootComment.startLine,
    thread.rootComment.line
  )
  const linePart = lineRange
    ? lineRange.startLine && lineRange.startLine !== lineRange.endLine
      ? `L${lineRange.startLine}-L${lineRange.endLine}`
      : `L${lineRange.endLine ?? ""}`
    : null
  const replyCount = thread.replies.length

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {thread.path ? <ReviewPathLabel path={thread.path} /> : null}
      {linePart ? (
        <span className="text-[11px] text-muted-foreground/80">{linePart}</span>
      ) : null}
      {replyCount > 0 ? (
        <span className="text-[11px] text-muted-foreground/80">
          {replyCount === 1 ? "1 reply" : `${replyCount} replies`}
        </span>
      ) : null}
      {thread.isResolved ? (
        <span
          className={cn(
            "rounded-full px-1.5 py-px text-[10px] font-medium",
            feedbackSurfaceClassName("success")
          )}
        >
          Resolved
        </span>
      ) : null}
      {thread.isOutdated ? (
        <span className="rounded-full border border-border bg-muted/60 px-1.5 py-px text-[10px] font-medium text-muted-foreground">
          Outdated
        </span>
      ) : null}
    </div>
  )
}

function ThreadComment({
  comment,
  isReply,
}: {
  comment: GitPullRequestReviewComment
  isReply?: boolean
}) {
  return (
    <div className={cn("flex min-w-0 gap-2", isReply && "pl-3")}>
      <div className="shrink-0">
        <ActivityAvatar
          avatarUrl={comment.authorAvatarUrl}
          alt={`${comment.authorLogin} avatar`}
          fallback={
            <InformationCircle
              size={15}
              className={cn("size-4 shrink-0", feedbackIconClassName("info"))}
            />
          }
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5 text-xs">
          <span className="truncate font-medium text-foreground">{comment.authorLogin}</span>
          <span className="text-muted-foreground/60">·</span>
          <EventTimestamp value={comment.publishedAt ?? comment.createdAt} />
        </div>
        <div className="mt-0.5">
          <MarkdownBody body={comment.body} />
        </div>
      </div>
    </div>
  )
}

function ReviewThreadCard({
  thread,
  diffTheme,
  isOpen,
  onOpenChange,
}: {
  thread: ReviewCommentThread
  diffTheme: PierreThemeName
  isOpen: boolean
  onOpenChange: (next: boolean) => void
}) {
  const lineRange = getReviewDiffLineRange(
    thread.rootComment.startLine,
    thread.rootComment.line
  )
  const subdued = thread.isResolved || thread.isOutdated

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-sidebar-border/50 bg-background/40",
        subdued && "opacity-80"
      )}
    >
      <Collapsible open={isOpen} onOpenChange={onOpenChange}>
        <CollapsibleTrigger className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-sidebar-accent/30">
          <CaretRight
            size={11}
            className={cn(
              "shrink-0 text-muted-foreground transition-transform",
              isOpen && "rotate-90"
            )}
          />
          <div className="min-w-0 flex-1">
            <ThreadHeader thread={thread} />
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-2.5 border-t border-sidebar-border/40 p-2.5">
            <ReviewDiffHunk
              path={thread.rootComment.path}
              diffHunk={thread.rootComment.diffHunk}
              lineRange={lineRange}
              theme={diffTheme}
            />
            <div className="space-y-2.5">
              <ThreadComment comment={thread.rootComment} />
              {thread.replies.length > 0 ? (
                <div className="space-y-2.5 border-l border-sidebar-border/50 pl-3">
                  {thread.replies.map((reply) => (
                    <ThreadComment key={reply.id} comment={reply} isReply />
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

function CommitTimelineEvent({
  commit,
  isLast,
}: {
  commit: GitPullRequestCommit
  isLast: boolean
}) {
  const authorLabel = commit.authorLogin ?? commit.authorName ?? "Someone"
  const timestamp = commit.committedDate ?? commit.authoredDate

  const message = commit.url ? (
    <ExternalLink
      href={commit.url}
      className="truncate font-medium text-foreground hover:underline"
    >
      {commit.messageHeadline}
    </ExternalLink>
  ) : (
    <span className="truncate font-medium text-foreground">{commit.messageHeadline}</span>
  )

  const sha = commit.url ? (
    <ExternalLink
      href={commit.url}
      className="rounded-md border border-sidebar-border/70 bg-background/70 px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground transition-colors hover:border-sidebar-border hover:text-foreground"
    >
      {commit.abbreviatedOid}
    </ExternalLink>
  ) : (
    <span className="rounded-md border border-sidebar-border/70 bg-background/70 px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground">
      {commit.abbreviatedOid}
    </span>
  )

  return (
    <TimelineItemFrame
      isLast={isLast}
      avatar={
        <div className="flex size-5 items-center justify-center rounded-full border border-sidebar-border/70 bg-background text-muted-foreground">
          <GitCommit size={13} className="size-3.5" />
        </div>
      }
      header={
        <>
          <span className="truncate font-medium text-foreground">{authorLabel}</span>
          <span>pushed a commit</span>
          <span className="text-muted-foreground/60">·</span>
          <EventTimestamp value={timestamp} />
        </>
      }
    >
      <div className="flex items-center gap-2 rounded-lg border border-sidebar-border/60 bg-background/45 px-2.5 py-1.5 text-xs">
        <GitCommit size={13} className="size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">{message}</div>
        {sha}
      </div>
    </TimelineItemFrame>
  )
}

function ReviewTimelineEvent({
  review,
  threads,
  diffTheme,
  threadOpenMap,
  onToggleThread,
  isLast,
}: {
  review: GitPullRequestReview
  threads: ReviewCommentThread[]
  diffTheme: PierreThemeName
  threadOpenMap: Record<string, boolean>
  onToggleThread: (threadId: string, defaultOpen: boolean) => void
  isLast: boolean
}) {
  const verb = getReviewActionVerb(review.state)
  const hasBody = Boolean(review.body?.trim())
  const hasContent = hasBody || threads.length > 0

  return (
    <TimelineItemFrame
      isLast={isLast}
      avatar={
        <ActivityAvatar
          avatarUrl={review.authorAvatarUrl}
          alt={`${review.authorLogin} avatar`}
          fallback={<ReviewStatusIcon state={review.state} />}
        />
      }
      header={
        <>
          <span className="truncate font-medium text-foreground">{review.authorLogin}</span>
          <span>{verb}</span>
          <ReviewStateBadge state={review.state} />
          <span className="text-muted-foreground/60">·</span>
          <EventTimestamp value={review.submittedAt} />
        </>
      }
    >
      {hasContent ? (
        <div className="space-y-2 rounded-xl border border-sidebar-border/60 bg-background/55 px-3 py-2.5">
          {hasBody ? <MarkdownBody body={review.body} /> : null}
          {threads.length > 0 ? (
            <div className={cn("space-y-1.5", hasBody && "pt-1")}>
              {threads.map((thread) => {
                const defaultOpen = !(thread.isResolved || thread.isOutdated)
                const isOpen = threadOpenMap[thread.id] ?? defaultOpen
                return (
                  <ReviewThreadCard
                    key={thread.id}
                    thread={thread}
                    diffTheme={diffTheme}
                    isOpen={isOpen}
                    onOpenChange={() => onToggleThread(thread.id, defaultOpen)}
                  />
                )
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </TimelineItemFrame>
  )
}

function CommentTimelineEvent({
  comment,
  isLast,
}: {
  comment: GitPullRequestComment
  isLast: boolean
}) {
  const hasBody = Boolean(comment.body?.trim())

  return (
    <TimelineItemFrame
      isLast={isLast}
      avatar={
        <ActivityAvatar
          avatarUrl={comment.authorAvatarUrl}
          alt={`${comment.authorLogin} avatar`}
          fallback={
            <InformationCircle
              size={15}
              className={cn("size-4 shrink-0", feedbackIconClassName("info"))}
            />
          }
        />
      }
      header={
        <>
          <span className="truncate font-medium text-foreground">{comment.authorLogin}</span>
          <span>commented</span>
          <span className="text-muted-foreground/60">·</span>
          <EventTimestamp value={comment.createdAt} />
        </>
      }
    >
      {hasBody ? (
        <div className="rounded-xl border border-sidebar-border/60 bg-background/55 px-3 py-2.5">
          <MarkdownBody body={comment.body} />
        </div>
      ) : null}
    </TimelineItemFrame>
  )
}

function OrphanThreadTimelineEvent({
  thread,
  diffTheme,
  isOpen,
  onToggle,
  isLast,
}: {
  thread: ReviewCommentThread
  diffTheme: PierreThemeName
  isOpen: boolean
  onToggle: () => void
  isLast: boolean
}) {
  return (
    <TimelineItemFrame
      isLast={isLast}
      avatar={
        <ActivityAvatar
          avatarUrl={thread.rootComment.authorAvatarUrl}
          alt={`${thread.rootComment.authorLogin} avatar`}
          fallback={
            <InformationCircle
              size={15}
              className={cn("size-4 shrink-0", feedbackIconClassName("info"))}
            />
          }
        />
      }
      header={
        <>
          <span className="truncate font-medium text-foreground">
            {thread.rootComment.authorLogin}
          </span>
          <span>commented on</span>
          {thread.path ? <ReviewPathLabel path={thread.path} /> : <span>a file</span>}
          <span className="text-muted-foreground/60">·</span>
          <EventTimestamp
            value={thread.rootComment.publishedAt ?? thread.rootComment.createdAt}
          />
        </>
      }
    >
      <ReviewThreadCard
        thread={thread}
        diffTheme={diffTheme}
        isOpen={isOpen}
        onOpenChange={onToggle}
      />
    </TimelineItemFrame>
  )
}

function PullRequestTimeline({
  items,
  diffTheme,
}: {
  items: PullRequestTimelineItem[]
  diffTheme: PierreThemeName
}) {
  const [threadOpenMap, setThreadOpenMap] = useState<Record<string, boolean>>({})

  const toggleThread = (threadId: string, defaultOpen: boolean) => {
    setThreadOpenMap((current) => {
      const previous = current[threadId] ?? defaultOpen
      return { ...current, [threadId]: !previous }
    })
  }

  return (
    <TimelineRail>
      {items.map((item, index) => {
        const isLast = index === items.length - 1
        if (item.kind === "commit") {
          return (
            <CommitTimelineEvent
              key={`commit:${item.id}`}
              commit={item.commit}
              isLast={isLast}
            />
          )
        }
        if (item.kind === "review") {
          return (
            <ReviewTimelineEvent
              key={`review:${item.id}`}
              review={item.review}
              threads={item.threads}
              diffTheme={diffTheme}
              threadOpenMap={threadOpenMap}
              onToggleThread={toggleThread}
              isLast={isLast}
            />
          )
        }
        if (item.kind === "comment") {
          return (
            <CommentTimelineEvent
              key={`comment:${item.id}`}
              comment={item.comment}
              isLast={isLast}
            />
          )
        }
        const defaultOpen = !(item.thread.isResolved || item.thread.isOutdated)
        const isOpen = threadOpenMap[item.thread.id] ?? defaultOpen
        return (
          <OrphanThreadTimelineEvent
            key={`thread:${item.id}`}
            thread={item.thread}
            diffTheme={diffTheme}
            isOpen={isOpen}
            onToggle={() => toggleThread(item.thread.id, defaultOpen)}
            isLast={isLast}
          />
        )
      })}
    </TimelineRail>
  )
}

export function PullRequestChecksPanel({
  pullRequest,
  checks,
  commits,
  comments,
  reviews,
  reviewComments,
  loadError,
}: PullRequestChecksPanelProps) {
  const [isDescriptionOpen, setIsDescriptionOpen] = useState(false)
  const { pierreDiffTheme: diffTheme } = useAppearance()
  const normalizedChecks = Array.isArray(checks) ? checks : []
  const normalizedCommits = Array.isArray(commits) ? commits : []
  const normalizedComments = Array.isArray(comments) ? comments : []
  const normalizedReviews = Array.isArray(reviews) ? reviews : []
  const normalizedReviewComments = Array.isArray(reviewComments) ? reviewComments : []
  const isOpenPullRequest = pullRequest?.state === "open"

  const timelineItems = useMemo(
    () =>
      buildPullRequestTimeline(
        normalizedCommits,
        normalizedReviews,
        normalizedComments,
        normalizedReviewComments,
        "asc"
      ),
    [normalizedCommits, normalizedReviews, normalizedComments, normalizedReviewComments]
  )

  const checksSummary = summarizePullRequestChecks(pullRequest, normalizedChecks)
  const shouldShowWaitingForChecks =
    normalizedChecks.length === 0 && checksSummary.tone === "waiting"

  if (!isOpenPullRequest || !pullRequest) {
    return (
      <RightSidebarEmptyState
        icon={CheckCircle}
        title="No open pull request"
        description="Open a pull request on this branch to view checks here."
      />
    )
  }

  const hasAnyActivity =
    normalizedChecks.length > 0 ||
    timelineItems.length > 0 ||
    Boolean(loadError) ||
    shouldShowWaitingForChecks

  return (
    <div className="flex h-full min-h-0 flex-col px-3 py-3">
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4">
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">{pullRequest.title}</h2>
          {pullRequest.description ? (
            <Collapsible open={isDescriptionOpen} onOpenChange={setIsDescriptionOpen}>
              <CollapsibleTrigger className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
                <CaretRight
                  size={12}
                  className={cn("shrink-0 transition-transform", isDescriptionOpen && "rotate-90")}
                />
                <span>Description</span>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-1">
                <div className="text-xs text-muted-foreground">
                  <MessageResponse
                    className={cn(
                      "leading-5 [&>*]:text-inherit",
                      "[&_h1]:!text-sm [&_h1]:font-semibold [&_h1]:!leading-5 [&_h1]:mt-0 [&_h1]:mb-1.5",
                      "[&_h2]:!text-sm [&_h2]:font-semibold [&_h2]:!leading-5 [&_h2]:mt-0 [&_h2]:mb-1.5",
                      "[&_h3]:!text-xs [&_h3]:font-semibold [&_h3]:!leading-5 [&_h3]:mt-0 [&_h3]:mb-1",
                      "[&_h4]:!text-xs [&_h4]:font-medium [&_h4]:!leading-5 [&_h4]:mt-0 [&_h4]:mb-1",
                      "[&_h5]:!text-xs [&_h5]:font-medium [&_h5]:!leading-5 [&_h5]:mt-0 [&_h5]:mb-1",
                      "[&_h6]:!text-xs [&_h6]:font-medium [&_h6]:!leading-5 [&_h6]:mt-0 [&_h6]:mb-1",
                      "[&_p]:text-xs [&_p]:leading-5 [&_p]:my-0 [&_p+p]:mt-1.5",
                      "[&_ul]:my-1 [&_ul]:pl-4 [&_ol]:my-1 [&_ol]:pl-4",
                      "[&_li]:text-xs [&_li]:leading-5 [&_li+li]:mt-0.5",
                      "[&_blockquote]:my-1.5 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3",
                      "[&_pre]:my-1.5 [&_pre]:text-[11px] [&_pre]:leading-4",
                      "[&_code]:text-[11px]"
                    )}
                  >
                    {pullRequest.description}
                  </MessageResponse>
                </div>
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </div>

        {loadError ? (
          <div
            className={cn(
              feedbackSurfaceClassName("destructive"),
              "rounded-lg px-3 py-2 text-sm"
            )}
          >
            {loadError}
          </div>
        ) : null}

        <ChecksBlock pullRequest={pullRequest} checks={normalizedChecks} />

        {timelineItems.length > 0 ? (
          <div className="flex flex-col gap-2">
            <div className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground/72">
              Conversation
            </div>
            <PullRequestTimeline items={timelineItems} diffTheme={diffTheme} />
          </div>
        ) : null}

        {!hasAnyActivity && !loadError ? (
          <RightSidebarEmptyState
            icon={CheckCircle}
            className="py-10"
            title="No checks, reviews, or comments yet"
            description="This pull request has not published any checks or discussion activity yet."
          />
        ) : null}
      </div>
    </div>
  )
}
