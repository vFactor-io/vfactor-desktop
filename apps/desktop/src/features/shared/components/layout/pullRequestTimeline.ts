import type {
  GitPullRequestCommit,
  GitPullRequestComment,
  GitPullRequestReview,
  GitPullRequestReviewComment,
} from "@/desktop/client"

/**
 * A grouped review-comment thread. Comments inside a single GitHub review
 * thread share a `threadId`, and replies link back to their parent via
 * `replyToId`. The root is the first comment chronologically (or the only
 * comment whose `replyToId` is null).
 */
export interface ReviewCommentThread {
  id: string
  rootComment: GitPullRequestReviewComment
  /** Replies sorted oldest → newest. Excludes the root. */
  replies: GitPullRequestReviewComment[]
  isResolved: boolean
  isOutdated: boolean
  path: string | null
  pullRequestReviewId: string | null
  /** Sort key for the thread; equals the root comment's published/createdAt. */
  sortTimestamp: number
}

export type PullRequestTimelineItem =
  | {
      kind: "commit"
      id: string
      sortTimestamp: number
      commit: GitPullRequestCommit
    }
  | {
      kind: "comment"
      id: string
      sortTimestamp: number
      comment: GitPullRequestComment
    }
  | {
      kind: "review"
      id: string
      sortTimestamp: number
      review: GitPullRequestReview
      threads: ReviewCommentThread[]
    }
  | {
      kind: "thread"
      id: string
      sortTimestamp: number
      thread: ReviewCommentThread
    }

export type TimelineOrder = "asc" | "desc"

function parseTimestamp(value: string | null | undefined): number {
  if (!value) {
    return 0
  }
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function reviewCommentTimestamp(comment: GitPullRequestReviewComment): number {
  return parseTimestamp(comment.publishedAt ?? comment.createdAt ?? null)
}

/**
 * Group review comments by their `threadId` and order replies via
 * `replyToId`. The thread's root is the comment with no `replyToId` (falling
 * back to the oldest comment in the group if no clear root is found).
 */
export function buildReviewCommentThreads(
  reviewComments: GitPullRequestReviewComment[]
): ReviewCommentThread[] {
  if (!Array.isArray(reviewComments) || reviewComments.length === 0) {
    return []
  }

  const groups = new Map<string, GitPullRequestReviewComment[]>()
  for (const comment of reviewComments) {
    const key = comment.threadId || comment.id
    const existing = groups.get(key)
    if (existing) {
      existing.push(comment)
    } else {
      groups.set(key, [comment])
    }
  }

  const threads: ReviewCommentThread[] = []
  for (const [threadId, comments] of groups) {
    const sorted = [...comments].sort(
      (left, right) => reviewCommentTimestamp(left) - reviewCommentTimestamp(right)
    )

    const root =
      sorted.find((comment) => !comment.replyToId) ?? sorted[0]
    if (!root) {
      continue
    }

    const replies = sorted.filter((comment) => comment.id !== root.id)

    threads.push({
      id: threadId,
      rootComment: root,
      replies,
      isResolved: root.isResolved,
      isOutdated: root.isOutdated,
      path: root.path ?? null,
      pullRequestReviewId: root.pullRequestReviewId ?? null,
      sortTimestamp: reviewCommentTimestamp(root),
    })
  }

  return threads
}

/**
 * Attach review-comment threads to their parent review via
 * `pullRequestReviewId`. Threads with no matching review (or no
 * `pullRequestReviewId`) are returned as orphans.
 */
export function attachThreadsToReviews(
  reviews: GitPullRequestReview[],
  threads: ReviewCommentThread[]
): {
  threadsByReviewId: Map<string, ReviewCommentThread[]>
  orphanThreads: ReviewCommentThread[]
} {
  const reviewIds = new Set(reviews.map((review) => review.id))
  const threadsByReviewId = new Map<string, ReviewCommentThread[]>()
  const orphanThreads: ReviewCommentThread[] = []

  for (const thread of threads) {
    const reviewId = thread.pullRequestReviewId
    if (reviewId && reviewIds.has(reviewId)) {
      const existing = threadsByReviewId.get(reviewId)
      if (existing) {
        existing.push(thread)
      } else {
        threadsByReviewId.set(reviewId, [thread])
      }
    } else {
      orphanThreads.push(thread)
    }
  }

  // Sort threads within each review by their root timestamp ascending so they
  // appear in the order the reviewer left them.
  for (const list of threadsByReviewId.values()) {
    list.sort((left, right) => left.sortTimestamp - right.sortTimestamp)
  }

  return { threadsByReviewId, orphanThreads }
}

/**
 * Build a single chronologically ordered timeline of issue comments, reviews
 * (with their nested threads), commits, and orphan review-comment threads.
 *
 * @param order "asc" → oldest first (GitHub PR style, default).
 *              "desc" → newest first.
 */
export function buildPullRequestTimeline(
  commits: GitPullRequestCommit[],
  reviews: GitPullRequestReview[],
  comments: GitPullRequestComment[],
  reviewComments: GitPullRequestReviewComment[],
  order: TimelineOrder = "asc"
): PullRequestTimelineItem[] {
  const safeCommits = Array.isArray(commits) ? commits : []
  const safeReviews = Array.isArray(reviews) ? reviews : []
  const safeComments = Array.isArray(comments) ? comments : []
  const safeReviewComments = Array.isArray(reviewComments) ? reviewComments : []

  const threads = buildReviewCommentThreads(safeReviewComments)
  const { threadsByReviewId, orphanThreads } = attachThreadsToReviews(
    safeReviews,
    threads
  )

  const items: PullRequestTimelineItem[] = []

  for (const commit of safeCommits) {
    items.push({
      kind: "commit",
      id: commit.oid,
      sortTimestamp: parseTimestamp(commit.committedDate ?? commit.authoredDate ?? null),
      commit,
    })
  }

  for (const review of safeReviews) {
    const attached = threadsByReviewId.get(review.id) ?? []
    items.push({
      kind: "review",
      id: review.id,
      sortTimestamp: parseTimestamp(review.submittedAt ?? null),
      review,
      threads: attached,
    })
  }

  for (const comment of safeComments) {
    items.push({
      kind: "comment",
      id: comment.id,
      sortTimestamp: parseTimestamp(comment.createdAt ?? null),
      comment,
    })
  }

  for (const thread of orphanThreads) {
    items.push({
      kind: "thread",
      id: thread.id,
      sortTimestamp: thread.sortTimestamp,
      thread,
    })
  }

  const direction = order === "desc" ? -1 : 1
  items.sort((left, right) => {
    const delta = left.sortTimestamp - right.sortTimestamp
    if (delta !== 0) {
      return delta * direction
    }
    return left.id.localeCompare(right.id) * direction
  })

  return items
}

export function countTimelineThreads(items: PullRequestTimelineItem[]): number {
  let total = 0
  for (const item of items) {
    if (item.kind === "review") {
      total += item.threads.length
    } else if (item.kind === "thread") {
      total += 1
    }
  }
  return total
}
