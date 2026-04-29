import { describe, expect, test } from "bun:test"
import type {
  GitPullRequestCommit,
  GitPullRequestComment,
  GitPullRequestReview,
  GitPullRequestReviewComment,
} from "@/desktop/client"
import {
  attachThreadsToReviews,
  buildPullRequestTimeline,
  buildReviewCommentThreads,
  countTimelineThreads,
} from "./pullRequestTimeline"

function reviewComment(
  overrides: Partial<GitPullRequestReviewComment> & { id: string; threadId: string }
): GitPullRequestReviewComment {
  return {
    authorLogin: "alice",
    isResolved: false,
    isOutdated: false,
    body: "...",
    path: null,
    ...overrides,
  }
}

function review(
  overrides: Partial<GitPullRequestReview> & { id: string }
): GitPullRequestReview {
  return {
    authorLogin: "bob",
    state: "COMMENTED",
    submittedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  }
}

function issueComment(
  overrides: Partial<GitPullRequestComment> & { id: string }
): GitPullRequestComment {
  return {
    authorLogin: "carol",
    body: "looks good",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  }
}

function commit(
  overrides: Partial<GitPullRequestCommit> & { oid: string }
): GitPullRequestCommit {
  return {
    abbreviatedOid: overrides.oid.slice(0, 7),
    messageHeadline: "Update sidebar",
    committedDate: "2024-01-01T00:00:00Z",
    ...overrides,
  }
}

describe("buildReviewCommentThreads", () => {
  test("groups review comments by threadId and orders replies oldest → newest", () => {
    const threads = buildReviewCommentThreads([
      reviewComment({
        id: "c2",
        threadId: "t1",
        replyToId: "c1",
        createdAt: "2024-01-01T01:00:00Z",
      }),
      reviewComment({
        id: "c1",
        threadId: "t1",
        createdAt: "2024-01-01T00:00:00Z",
        path: "src/foo.ts",
      }),
      reviewComment({
        id: "c3",
        threadId: "t1",
        replyToId: "c2",
        createdAt: "2024-01-01T02:00:00Z",
      }),
    ])

    expect(threads).toHaveLength(1)
    expect(threads[0].id).toBe("t1")
    expect(threads[0].rootComment.id).toBe("c1")
    expect(threads[0].replies.map((reply) => reply.id)).toEqual(["c2", "c3"])
    expect(threads[0].path).toBe("src/foo.ts")
  })

  test("handles a single-message thread with no replies", () => {
    const threads = buildReviewCommentThreads([
      reviewComment({ id: "c1", threadId: "t1" }),
    ])

    expect(threads).toHaveLength(1)
    expect(threads[0].replies).toEqual([])
  })

  test("falls back to oldest comment when no clear root exists", () => {
    const threads = buildReviewCommentThreads([
      reviewComment({
        id: "c1",
        threadId: "t1",
        replyToId: "missing",
        createdAt: "2024-01-01T00:00:00Z",
      }),
      reviewComment({
        id: "c2",
        threadId: "t1",
        replyToId: "missing",
        createdAt: "2024-01-01T01:00:00Z",
      }),
    ])

    expect(threads[0].rootComment.id).toBe("c1")
    expect(threads[0].replies.map((r) => r.id)).toEqual(["c2"])
  })

  test("propagates resolved/outdated state from root onto thread", () => {
    const threads = buildReviewCommentThreads([
      reviewComment({
        id: "c1",
        threadId: "t1",
        isResolved: true,
        isOutdated: true,
      }),
    ])

    expect(threads[0].isResolved).toBe(true)
    expect(threads[0].isOutdated).toBe(true)
  })
})

describe("attachThreadsToReviews", () => {
  test("attaches threads with matching pullRequestReviewId", () => {
    const reviews = [review({ id: "r1" }), review({ id: "r2" })]
    const threads = buildReviewCommentThreads([
      reviewComment({ id: "c1", threadId: "t1", pullRequestReviewId: "r1" }),
      reviewComment({ id: "c2", threadId: "t2", pullRequestReviewId: "r2" }),
    ])

    const { threadsByReviewId, orphanThreads } = attachThreadsToReviews(reviews, threads)

    expect(threadsByReviewId.get("r1")?.map((t) => t.id)).toEqual(["t1"])
    expect(threadsByReviewId.get("r2")?.map((t) => t.id)).toEqual(["t2"])
    expect(orphanThreads).toEqual([])
  })

  test("returns threads without a matching review as orphans", () => {
    const reviews = [review({ id: "r1" })]
    const threads = buildReviewCommentThreads([
      reviewComment({ id: "c1", threadId: "t1", pullRequestReviewId: "deleted" }),
      reviewComment({ id: "c2", threadId: "t2", pullRequestReviewId: null }),
    ])

    const { threadsByReviewId, orphanThreads } = attachThreadsToReviews(reviews, threads)

    expect(threadsByReviewId.size).toBe(0)
    expect(orphanThreads.map((t) => t.id).sort()).toEqual(["t1", "t2"])
  })
})

describe("buildPullRequestTimeline", () => {
  test("merges reviews + comments + orphan threads in ascending order by default", () => {
    const items = buildPullRequestTimeline(
      [],
      [review({ id: "r1", submittedAt: "2024-01-02T00:00:00Z" })],
      [issueComment({ id: "ic1", createdAt: "2024-01-01T00:00:00Z" })],
      [
        reviewComment({
          id: "rc1",
          threadId: "t1",
          createdAt: "2024-01-03T00:00:00Z",
          pullRequestReviewId: null,
        }),
      ]
    )

    expect(items.map((item) => `${item.kind}:${item.id}`)).toEqual([
      "comment:ic1",
      "review:r1",
      "thread:t1",
    ])
  })

  test("sorts descending when order=desc", () => {
    const items = buildPullRequestTimeline(
      [],
      [review({ id: "r1", submittedAt: "2024-01-02T00:00:00Z" })],
      [issueComment({ id: "ic1", createdAt: "2024-01-01T00:00:00Z" })],
      [],
      "desc"
    )

    expect(items.map((item) => item.id)).toEqual(["r1", "ic1"])
  })

  test("nests review threads under their parent review", () => {
    const items = buildPullRequestTimeline(
      [],
      [review({ id: "r1", submittedAt: "2024-01-02T00:00:00Z" })],
      [],
      [
        reviewComment({
          id: "rc1",
          threadId: "t1",
          pullRequestReviewId: "r1",
          createdAt: "2024-01-02T00:01:00Z",
        }),
        reviewComment({
          id: "rc2",
          threadId: "t1",
          replyToId: "rc1",
          pullRequestReviewId: "r1",
          createdAt: "2024-01-02T00:02:00Z",
        }),
        reviewComment({
          id: "rc3",
          threadId: "t2",
          pullRequestReviewId: "r1",
          createdAt: "2024-01-02T00:03:00Z",
        }),
      ]
    )

    expect(items).toHaveLength(1)
    const [first] = items
    if (first.kind !== "review") {
      throw new Error("expected review item")
    }
    expect(first.threads).toHaveLength(2)
    expect(first.threads[0].id).toBe("t1")
    expect(first.threads[0].replies.map((r) => r.id)).toEqual(["rc2"])
    expect(first.threads[1].id).toBe("t2")
  })

  test("review with no threads still appears as a timeline event", () => {
    const items = buildPullRequestTimeline(
      [],
      [review({ id: "r1" })],
      [],
      []
    )
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe("review")
  })

  test("handles empty inputs", () => {
    expect(buildPullRequestTimeline([], [], [], [])).toEqual([])
  })

  test("merges commits into the timeline by committed date", () => {
    const items = buildPullRequestTimeline(
      [commit({ oid: "abc123456789", committedDate: "2024-01-01T12:00:00Z" })],
      [review({ id: "r1", submittedAt: "2024-01-02T00:00:00Z" })],
      [issueComment({ id: "ic1", createdAt: "2024-01-01T00:00:00Z" })],
      []
    )

    expect(items.map((item) => `${item.kind}:${item.id}`)).toEqual([
      "comment:ic1",
      "commit:abc123456789",
      "review:r1",
    ])
  })
})

describe("countTimelineThreads", () => {
  test("counts threads attached to reviews and orphans together", () => {
    const items = buildPullRequestTimeline(
      [],
      [review({ id: "r1" })],
      [],
      [
        reviewComment({ id: "rc1", threadId: "t1", pullRequestReviewId: "r1" }),
        reviewComment({ id: "rc2", threadId: "t2", pullRequestReviewId: null }),
      ]
    )

    expect(countTimelineThreads(items)).toBe(2)
  })
})
