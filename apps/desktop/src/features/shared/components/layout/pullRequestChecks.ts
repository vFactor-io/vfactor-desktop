import type { GitPullRequest, GitPullRequestCheck } from "@/desktop/client"

export function isActionablePullRequestChecksError(
  error: string | null | undefined
): error is string {
  const message = error?.trim()
  if (!message) {
    return false
  }

  return !(
    /no required checks reported/i.test(message) ||
    /no checks? (reported|found|published)/i.test(message) ||
    /no pull request check data/i.test(message)
  )
}

export interface PullRequestChecksSummary {
  pendingCount: number
  failedCount: number
  passedCount: number
  cancelledCount: number
  skippedCount: number
  totalCount: number
  tone: "waiting" | "failed" | "passed" | "idle"
  label: string
}

export function summarizePullRequestChecks(
  pullRequest: GitPullRequest | null | undefined,
  checks: GitPullRequestCheck[]
): PullRequestChecksSummary {
  let pendingCount = 0
  let failedCount = 0
  let passedCount = 0
  let cancelledCount = 0
  let skippedCount = 0

  for (const check of checks) {
    switch (check.status) {
      case "pending":
        pendingCount += 1
        break
      case "failed":
        failedCount += 1
        break
      case "passed":
        passedCount += 1
        break
      case "cancelled":
        cancelledCount += 1
        break
      case "skipped":
        skippedCount += 1
        break
      default:
        break
    }
  }

  if (checks.length === 0) {
    pendingCount = pullRequest?.pendingChecksCount ?? 0
    failedCount = pullRequest?.failedChecksCount ?? 0
    passedCount = pullRequest?.passedChecksCount ?? 0
  }

  const totalCount = pendingCount + failedCount + passedCount + cancelledCount + skippedCount

  if (pendingCount > 0) {
    return {
      pendingCount,
      failedCount,
      passedCount,
      cancelledCount,
      skippedCount,
      totalCount,
      tone: "waiting",
      label: "Waiting for checks",
    }
  }

  if (failedCount > 0) {
    return {
      pendingCount,
      failedCount,
      passedCount,
      cancelledCount,
      skippedCount,
      totalCount,
      tone: "failed",
      label: "Checks failed",
    }
  }

  if (passedCount > 0 && failedCount === 0 && pendingCount === 0) {
    return {
      pendingCount,
      failedCount,
      passedCount,
      cancelledCount,
      skippedCount,
      totalCount,
      tone: "passed",
      label: "All checks passed",
    }
  }

  return {
    pendingCount,
    failedCount,
    passedCount,
    cancelledCount,
    skippedCount,
    totalCount,
    tone: "idle",
    label: "No checks reported yet",
  }
}

export function getChecksTabBadgeCount(
  pullRequest: GitPullRequest | null | undefined,
  checks: GitPullRequestCheck[]
): number {
  const summary = summarizePullRequestChecks(pullRequest, checks)
  return summary.pendingCount + summary.failedCount
}

export function shouldAutoOpenChecksTab(
  previousChecksStatus: GitPullRequest["checksStatus"] | null | undefined,
  nextChecksStatus: GitPullRequest["checksStatus"] | null | undefined
): boolean {
  return previousChecksStatus !== "pending" && nextChecksStatus === "pending"
}

const CHECK_STATUS_ORDER: Record<GitPullRequestCheck["status"], number> = {
  pending: 0,
  failed: 1,
  passed: 2,
  skipped: 3,
  cancelled: 4,
}

export function sortPullRequestChecks(checks: GitPullRequestCheck[]): GitPullRequestCheck[] {
  return [...checks].sort((left, right) => {
    const orderDifference = CHECK_STATUS_ORDER[left.status] - CHECK_STATUS_ORDER[right.status]
    if (orderDifference !== 0) {
      return orderDifference
    }

    return left.name.localeCompare(right.name)
  })
}
