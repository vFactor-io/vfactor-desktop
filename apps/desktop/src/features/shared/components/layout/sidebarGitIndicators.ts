import type { GitBranchesResponse } from "@/desktop/client"

export interface SidebarBranchIndicator {
  colorClass: string
  tooltip: string
}

export interface SidebarPullRequestIndicator {
  colorClass: string
  tooltip: string
  url: string
}

function formatCommitCount(count: number): string {
  return count === 1 ? "1 commit" : `${count} commits`
}

function formatChangeCount(count: number): string {
  return count === 1 ? "1 uncommitted change" : `${count} uncommitted changes`
}

export function resolveSidebarBranchIndicator(
  branchData: GitBranchesResponse | null
): SidebarBranchIndicator | null {
  if (!branchData || !branchData.isGitAvailable || !branchData.isRepo) {
    return null
  }

  const branchLabel = branchData.currentBranch
  const upstreamLabel = branchData.upstreamBranch ?? "upstream"
  const changedFiles = branchData.workingTreeSummary.changedFiles
  const isAhead = branchData.aheadCount > 0
  const isBehind = branchData.behindCount > 0

  if (branchData.isDetached) {
    return {
      colorClass: "text-[color:var(--color-vcs-diverged)]",
      tooltip: "Detached HEAD",
    }
  }

  if (isAhead && isBehind) {
    return {
      colorClass: "text-[color:var(--color-vcs-diverged)]",
      tooltip: `${branchLabel} has diverged from ${upstreamLabel} (${formatCommitCount(
        branchData.aheadCount
      )} ahead, ${formatCommitCount(branchData.behindCount)} behind).`,
    }
  }

  if (changedFiles > 0) {
    return {
      colorClass: "text-[color:var(--color-vcs-modified)]",
      tooltip: `${branchLabel} has ${formatChangeCount(changedFiles)}.`,
    }
  }

  if (isBehind) {
    return {
      colorClass: "text-[color:var(--color-vcs-behind)]",
      tooltip: `${branchLabel} is ${formatCommitCount(branchData.behindCount)} behind ${upstreamLabel}.`,
    }
  }

  if (isAhead) {
    return {
      colorClass: "text-[color:var(--color-vcs-ahead)]",
      tooltip: branchData.hasUpstream
        ? `${branchLabel} is ${formatCommitCount(branchData.aheadCount)} ahead of ${upstreamLabel}.`
        : `${branchLabel} is ${formatCommitCount(branchData.aheadCount)} ahead with no upstream configured yet.`,
    }
  }

  if (!branchData.hasUpstream) {
    return {
      colorClass: "text-sidebar-foreground/40",
      tooltip: `${branchLabel} has no upstream configured.`,
    }
  }

  return {
    colorClass: "text-sidebar-foreground/40",
    tooltip: branchData.isDefaultBranch
      ? `${branchLabel} is up to date (default branch).`
      : `${branchLabel} is up to date.`,
  }
}

export function resolveSidebarPullRequestIndicator(
  branchData: GitBranchesResponse | null
): SidebarPullRequestIndicator | null {
  if (!branchData?.isGitAvailable || !branchData.isRepo) {
    return null
  }

  const pullRequest = branchData?.openPullRequest
  if (!pullRequest) {
    return null
  }

  if (pullRequest.state === "open") {
    return {
      colorClass: "text-[color:var(--color-vcs-pr-open)]",
      tooltip: `PR #${pullRequest.number} open: ${pullRequest.title}`,
      url: pullRequest.url,
    }
  }

  if (pullRequest.state === "closed") {
    return {
      colorClass: "text-[color:var(--color-vcs-pr-closed)]",
      tooltip: `PR #${pullRequest.number} closed: ${pullRequest.title}`,
      url: pullRequest.url,
    }
  }

  return {
    colorClass: "text-[color:var(--color-vcs-merged)]",
    tooltip: `PR #${pullRequest.number} merged: ${pullRequest.title}`,
    url: pullRequest.url,
  }
}
