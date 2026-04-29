import {
  CaretRight,
  CheckCircle,
  CircleNotch,
  Clock,
  InformationCircle,
  X,
} from "@/components/icons"
import type {
  GitPullRequest as DesktopGitPullRequest,
  GitPullRequestCheck,
  GitPullRequestComment,
  GitPullRequestReviewComment,
  GitPullRequestReview,
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
import { useEffect, useState, type ReactNode } from "react"
import { sortPullRequestChecks, summarizePullRequestChecks } from "./pullRequestChecks"
import {
  buildReviewPatch,
  getReviewDiffLineRange,
  getReviewDiffSelectedLines,
  type ReviewDiffLineRange,
} from "./pullRequestReviewDiff"
import { RightSidebarEmptyState } from "./RightSidebarEmptyState"

interface PullRequestChecksPanelProps {
  pullRequest: DesktopGitPullRequest | null
  checks: GitPullRequestCheck[]
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
  body: string | null
  badges: ReviewBadge[]
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

function sortPullRequestReviews(reviews: GitPullRequestReview[]): GitPullRequestReview[] {
  return [...reviews].sort((left, right) => {
    const leftTimestamp = left.submittedAt ? Date.parse(left.submittedAt) : 0
    const rightTimestamp = right.submittedAt ? Date.parse(right.submittedAt) : 0
    return rightTimestamp - leftTimestamp
  })
}

function sortPullRequestComments(comments: GitPullRequestComment[]): GitPullRequestComment[] {
  return [...comments].sort((left, right) => {
    const leftTimestamp = left.createdAt ? Date.parse(left.createdAt) : 0
    const rightTimestamp = right.createdAt ? Date.parse(right.createdAt) : 0
    return rightTimestamp - leftTimestamp
  })
}

function sortPullRequestReviewComments(
  comments: GitPullRequestReviewComment[]
): GitPullRequestReviewComment[] {
  return [...comments].sort((left, right) => {
    const leftTimestamp = left.publishedAt ?? left.createdAt ?? null
    const rightTimestamp = right.publishedAt ?? right.createdAt ?? null
    const leftValue = leftTimestamp ? Date.parse(leftTimestamp) : 0
    const rightValue = rightTimestamp ? Date.parse(rightTimestamp) : 0
    return rightValue - leftValue
  })
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

function parseGitHubBody(
  value: string | null | undefined
): ParsedGitHubBody {
  const trimmed = value?.trim()
  if (!trimmed) {
    return { title: null, body: null, badges: [] }
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
  const withoutHtml = withMarkdownLinks
    .replace(/<picture\b[\s\S]*?<\/picture>/gi, "")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<\/?(details|summary)\b[^>]*>/gi, "")

  const normalized = withoutHtml
    .split("\n")
    .map((line) => line.replace(/<[^>]+>/g, "").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\*\*\s+/gm, "**")
    .replace(/\s+\*\*$/gm, "**")
    .replace(/[ \t]{2,}/g, " ")
    .trim()

  const normalizedBody = normalized || null
  if (!normalizedBody) {
    return { title: null, body: null, badges }
  }

  const titleMatch = normalizedBody.match(/^\*\*([^\n]+?)\*\*(?:\n\s*\n)?([\s\S]*)?$/)
  if (titleMatch) {
    const title = titleMatch[1]?.trim() || null
    const remainingBody = titleMatch[2]?.trim() || null
    return {
      title,
      body: remainingBody,
      badges,
    }
  }

  return { title: null, body: normalizedBody, badges }
}

function MarkdownBody({ body }: { body: string | null | undefined }) {
  const { title, body: normalizedBody, badges } = parseGitHubBody(body)
  if (!title && !normalizedBody && badges.length === 0) {
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
      {normalizedBody ? (
        <MessageResponse
          className={cn(
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
          )}
        >
          {normalizedBody}
        </MessageResponse>
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

export function PullRequestChecksPanel({
  pullRequest,
  checks,
  comments,
  reviews,
  reviewComments,
  isLoading,
  loadError,
}: PullRequestChecksPanelProps) {
  const [isDescriptionOpen, setIsDescriptionOpen] = useState(false)
  const [openCollapsedReviews, setOpenCollapsedReviews] = useState<Record<string, boolean>>({})
  const [openCollapsedReviewComments, setOpenCollapsedReviewComments] = useState<
    Record<string, boolean>
  >({})
  const { pierreDiffTheme: diffTheme } = useAppearance()
  const normalizedChecks = Array.isArray(checks) ? checks : []
  const normalizedComments = Array.isArray(comments) ? comments : []
  const normalizedReviews = Array.isArray(reviews) ? reviews : []
  const normalizedReviewComments = Array.isArray(reviewComments) ? reviewComments : []
  const isOpenPullRequest = pullRequest?.state === "open"
  const sortedChecks = sortPullRequestChecks(normalizedChecks)
  const sortedComments = sortPullRequestComments(normalizedComments)
  const sortedReviews = sortPullRequestReviews(normalizedReviews)
  const sortedReviewComments = sortPullRequestReviewComments(normalizedReviewComments)
  const checksSummary = summarizePullRequestChecks(pullRequest, normalizedChecks)
  const shouldShowWaitingForChecks =
    sortedChecks.length === 0 && (isLoading || checksSummary.tone === "waiting")

  if (!isOpenPullRequest || !pullRequest) {
    return (
      <RightSidebarEmptyState
        icon={CheckCircle}
        title="No open pull request"
        description="Open a pull request on this branch to view checks here."
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col px-3 py-3">
      <div className="mx-auto flex w-full max-w-[760px] flex-col">
        <div className="space-y-4">
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
            <div className={cn(feedbackSurfaceClassName("destructive"), "rounded-lg px-3 py-2 text-sm")}>{loadError}</div>
          ) : null}
        </div>

        {shouldShowWaitingForChecks ? (
          <div className="flex flex-1 items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <CircleNotch
              size={15}
              className={cn("size-4 shrink-0", feedbackIconClassName("warning"), "animate-spin")}
            />
            <span>Waiting for checks to report back...</span>
          </div>
        ) : null}

        {!shouldShowWaitingForChecks &&
        sortedChecks.length === 0 &&
        sortedReviews.length === 0 &&
        sortedComments.length === 0 &&
        sortedReviewComments.length === 0 &&
        !loadError ? (
          <RightSidebarEmptyState
            icon={CheckCircle}
            className="py-10"
            title="No checks, reviews, or comments yet"
            description="This pull request has not published any checks or discussion activity yet."
          />
        ) : null}

        {sortedChecks.length > 0 ? (
          <div className="space-y-2 pt-4">
            <div className="pb-1 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground/72">
              Checks
            </div>
            {sortedChecks.map((check) => (
              <div key={check.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <CheckStatusIcon status={check.status} />
                  <span className="truncate text-foreground">{check.name}</span>
                </div>
                <span className={cn("shrink-0", getCheckTone(check.status))}>
                  {getCheckStatusLabel(check.status)}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {sortedReviews.length > 0 ? (
          <div className="space-y-2 pt-4">
            <div className="pb-1 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground/72">
              Reviews
            </div>
            {sortedReviews.map((review) => {
              const submittedAtLabel = formatReviewTimestamp(review.submittedAt)
              const isReviewOpen = openCollapsedReviews[review.id] ?? false
              const header = (
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2">
                    <ActivityAvatar
                      avatarUrl={review.authorAvatarUrl}
                      alt={`${review.authorLogin} avatar`}
                      fallback={<ReviewStatusIcon state={review.state} />}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">
                        {review.authorLogin}
                      </div>
                    </div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    {submittedAtLabel ? <div>{submittedAtLabel}</div> : null}
                  </div>
                </div>
              )

              return (
                <div
                  key={review.id}
                  className="space-y-2 rounded-xl border border-sidebar-border/60 bg-background/55 px-3 py-2.5"
                >
                  <Collapsible
                    open={isReviewOpen}
                    onOpenChange={(nextOpen) => {
                      setOpenCollapsedReviews((current) => ({
                        ...current,
                        [review.id]: nextOpen,
                      }))
                    }}
                  >
                    <CollapsibleTrigger className="w-full text-left">
                      <div className="flex items-start gap-2">
                        <CaretRight
                          size={12}
                          className={cn(
                            "mt-1 shrink-0 text-muted-foreground transition-transform",
                            isReviewOpen && "rotate-90"
                          )}
                        />
                        <div className="min-w-0 flex-1">{header}</div>
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-2">
                      <MarkdownBody body={review.body} />
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              )
            })}
          </div>
        ) : null}

        {sortedReviewComments.length > 0 ? (
          <div className="space-y-2 pt-4">
            <div className="pb-1 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground/72">
              Review comments
            </div>
            {sortedReviewComments.map((comment) => {
              const publishedAtLabel = formatReviewTimestamp(
                comment.publishedAt ?? comment.createdAt
              )
              const pathLabel = comment.path ?? null
              const lineRange = getReviewDiffLineRange(comment.startLine, comment.line)
              const isResolved = comment.isResolved
              const isOutdated = comment.isOutdated
              const shouldCollapse = isResolved || isOutdated
              const isCollapsedOpen = openCollapsedReviewComments[comment.id] ?? !shouldCollapse
              const header = (
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <ActivityAvatar
                      avatarUrl={comment.authorAvatarUrl}
                      alt={`${comment.authorLogin} avatar`}
                      fallback={
                        <InformationCircle size={15} className={cn("size-4 shrink-0", feedbackIconClassName("info"))} />
                      }
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {pathLabel ? (
                          <ReviewPathLabel path={pathLabel} />
                        ) : null}
                        {isResolved ? <span className={cn("text-xs", feedbackIconClassName("success"))}>Resolved</span> : null}
                        {isOutdated ? <span className="text-xs text-muted-foreground">Outdated</span> : null}
                      </div>
                    </div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    {publishedAtLabel ? <div>{publishedAtLabel}</div> : null}
                  </div>
                </div>
              )

              return (
                <div
                  key={comment.id}
                  className="space-y-2 rounded-xl border border-sidebar-border/60 bg-background/55 px-3 py-2.5"
                >
                  <Collapsible
                    open={isCollapsedOpen}
                    onOpenChange={(nextOpen) => {
                      setOpenCollapsedReviewComments((current) => ({
                        ...current,
                        [comment.id]: nextOpen,
                      }))
                    }}
                  >
                    <CollapsibleTrigger className="w-full text-left">
                      <div className="flex items-start gap-2">
                        <CaretRight
                          size={12}
                          className={cn(
                            "mt-1 shrink-0 text-muted-foreground transition-transform",
                            isCollapsedOpen && "rotate-90"
                          )}
                        />
                        <div className="min-w-0 flex-1">{header}</div>
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-2">
                      <MarkdownBody body={comment.body} />
                      <div className="pt-2">
                        <ReviewDiffHunk
                          path={comment.path}
                          diffHunk={comment.diffHunk}
                          lineRange={lineRange}
                          theme={diffTheme}
                        />
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              )
            })}
          </div>
        ) : null}

        {sortedComments.length > 0 ? (
          <div className="space-y-2 pt-4">
            <div className="pb-1 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground/72">
              Comments
            </div>
            {sortedComments.map((comment) => {
              const createdAtLabel = formatReviewTimestamp(comment.createdAt)

              return (
                <div
                  key={comment.id}
                  className="space-y-2 rounded-xl border border-sidebar-border/60 bg-background/55 px-3 py-2.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2">
                      <ActivityAvatar
                        avatarUrl={comment.authorAvatarUrl}
                        alt={`${comment.authorLogin} avatar`}
                        fallback={
                          <InformationCircle size={15} className={cn("size-4 shrink-0", feedbackIconClassName("info"))} />
                        }
                      />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">
                          {comment.authorLogin}
                        </div>
                      </div>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      {createdAtLabel ? <div>{createdAtLabel}</div> : null}
                    </div>
                  </div>
                  <MarkdownBody body={comment.body} />
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
    </div>
  )
}
