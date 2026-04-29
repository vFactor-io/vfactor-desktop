import type {
  GitBranchesResponse,
  GitRunStackedActionResult,
  GitStackedAction,
} from "@/desktop/client"
import { getResolveActionLabel, getResolveHint, getResolveTone } from "./gitResolve"
import { isActionablePullRequestChecksError } from "./pullRequestChecks"

export type GitActionIconName =
  | "archive"
  | "chat"
  | "commit"
  | "info"
  | "pr"
  | "pull"
  | "push"

export interface GitActionResolutionOptions {
  preferredRemoteName?: string | null
  canArchiveWorktree?: boolean
}

export interface GitActionMenuItem {
  id: "archive" | "commit" | "pr" | "push" | "resolve"
  label: string
  disabled: boolean
  icon: GitActionIconName
  kind: "open_archive" | "open_pr" | "resolve_pr" | "run_action"
  action?: GitStackedAction
  openDialog?: boolean
}

export interface GitQuickAction {
  label: string
  disabled: boolean
  icon: GitActionIconName
  kind:
    | "merge_pr"
    | "open_archive"
    | "open_checks"
    | "open_pr"
    | "resolve_pr"
    | "run_action"
    | "run_pull"
    | "show_hint"
  tone: "danger" | "default" | "warning"
  action?: GitStackedAction
  hint?: string
}

function hasConfiguredRemote(
  branchData: GitBranchesResponse,
  preferredRemoteName?: string | null
): boolean {
  const normalizedRemoteName = preferredRemoteName?.trim()
  if (normalizedRemoteName) {
    return branchData.remoteNames.includes(normalizedRemoteName)
  }

  if (branchData.hasOriginRemote) {
    return true
  }

  return branchData.remoteNames.length > 0
}

function isArchiveAvailable(
  branchData: GitBranchesResponse,
  canArchiveWorktree: boolean
): boolean {
  return canArchiveWorktree && branchData.openPullRequest?.state === "merged"
}

function getChecksPendingHint(branchData: GitBranchesResponse): string {
  const pendingCount = branchData.openPullRequest?.pendingChecksCount ?? 0
  const countLabel =
    pendingCount > 0
      ? pendingCount === 1
        ? "1 required check is still running."
        : `${pendingCount} required checks are still running.`
      : "Required checks are still running for this pull request."

  return `GitHub says checks are still pending.\n${countLabel}\nClicking this opens the Checks tab here so you can watch them finish.`
}

function canResolvePullRequest(branchData: GitBranchesResponse): boolean {
  return branchData.openPullRequest?.state === "open" && Boolean(branchData.openPullRequest.resolveReason)
}

export function buildMenuItems(
  branchData: GitBranchesResponse | null,
  hasChanges: boolean,
  isBusy: boolean,
  options: GitActionResolutionOptions = {}
): GitActionMenuItem[] {
  if (!branchData) {
    return []
  }

  const pullRequest = branchData.openPullRequest
  const hasOpenPr = pullRequest?.state === "open"
  const hasPullRequest = pullRequest != null
  const isBehind = branchData.behindCount > 0
  const hasBranch = !branchData.isDetached
  const canPushWithoutUpstream =
    hasConfiguredRemote(branchData, options.preferredRemoteName) && !branchData.hasUpstream
  const canCommit = !isBusy && hasChanges
  const canPush =
    !isBusy &&
    hasBranch &&
    !hasChanges &&
    !isBehind &&
    branchData.aheadCount > 0 &&
    (branchData.hasUpstream || canPushWithoutUpstream)
  const canCreatePr =
    !isBusy &&
    hasBranch &&
    !hasChanges &&
    !hasOpenPr &&
    branchData.aheadCount > 0 &&
    !isBehind &&
    (branchData.hasUpstream || canPushWithoutUpstream)

  const menuItems: GitActionMenuItem[] = [
    {
      id: "commit",
      label: "Commit",
      disabled: !canCommit,
      icon: "commit",
      kind: "run_action",
      action: "commit",
      openDialog: true,
    },
    {
      id: "push",
      label: "Push",
      disabled: !canPush,
      icon: "push",
      kind: "run_action",
      action: "commit_push",
    },
    hasPullRequest
      ? {
          id: "pr",
          label: "View PR",
          disabled: isBusy,
          icon: "pr",
          kind: "open_pr",
        }
      : {
          id: "pr",
          label: "Create PR",
          disabled: !canCreatePr,
          icon: "pr",
          kind: "run_action",
          action: "commit_push_pr",
        },
  ]

  if (canResolvePullRequest(branchData)) {
    const resolveReason = branchData.openPullRequest!.resolveReason!
    menuItems.push({
      id: "resolve",
      label: getResolveActionLabel(resolveReason),
      disabled: isBusy,
      icon: "chat",
      kind: "resolve_pr",
    })
  }

  if (isArchiveAvailable(branchData, options.canArchiveWorktree === true)) {
    menuItems.push({
      id: "archive",
      label: "Archive",
      disabled: isBusy,
      icon: "archive",
      kind: "open_archive",
    })
  }

  return menuItems
}

export function resolveQuickAction(
  branchData: GitBranchesResponse | null,
  hasChanges: boolean,
  isBusy: boolean,
  options: GitActionResolutionOptions = {}
): GitQuickAction {
  if (isBusy) {
    return {
      label: "Commit",
      disabled: true,
      icon: "commit",
      kind: "show_hint",
      hint: "A git action is already in progress.",
      tone: "default",
    }
  }

  if (!branchData) {
    return {
      label: "Commit",
      disabled: true,
      icon: "commit",
      kind: "show_hint",
      hint: "Git status is unavailable.",
      tone: "default",
    }
  }

  const pullRequest = branchData.openPullRequest
  const hasOpenPr = pullRequest?.state === "open"
  const hasMergedPr = pullRequest?.state === "merged"
  const hasBranch = !branchData.isDetached
  const isAhead = branchData.aheadCount > 0
  const isBehind = branchData.behindCount > 0
  const isDiverged = isAhead && isBehind
  const hasConfiguredPreferredRemote = hasConfiguredRemote(branchData, options.preferredRemoteName)

  if (!hasBranch) {
    return {
      label: "Commit",
      disabled: true,
      icon: "commit",
      kind: "show_hint",
      hint: "Create and checkout a branch before pushing or opening a PR.",
      tone: "default",
    }
  }

  if (hasChanges) {
    if (!branchData.hasUpstream && !hasConfiguredPreferredRemote) {
      return {
        label: "Commit",
        disabled: false,
        icon: "commit",
        kind: "run_action",
        action: "commit",
        tone: "default",
      }
    }

    if (hasOpenPr || branchData.isDefaultBranch) {
      return {
        label: "Commit & push",
        disabled: false,
        icon: "push",
        kind: "run_action",
        action: "commit_push",
        tone: "default",
      }
    }

    return {
      label: "Commit, push & PR",
      disabled: false,
      icon: "pr",
      kind: "run_action",
      action: "commit_push_pr",
      tone: "default",
    }
  }

  if (isDiverged) {
    return {
      label: "Sync branch",
      disabled: true,
      icon: "info",
      kind: "show_hint",
      hint: "This branch has diverged from upstream. Rebase or merge before continuing.",
      tone: "default",
    }
  }

  if (isBehind) {
    return {
      label: "Pull",
      disabled: false,
      icon: "pull",
      kind: "run_pull",
      tone: "default",
    }
  }

  if (isAhead) {
    if (!branchData.hasUpstream && !hasConfiguredPreferredRemote) {
      return {
        label: "Push",
        disabled: true,
        icon: "push",
        kind: "show_hint",
        hint: options.preferredRemoteName?.trim()
          ? `Configure the "${options.preferredRemoteName.trim()}" remote before pushing or creating a PR.`
          : "Add a remote before pushing or creating a PR.",
        tone: "default",
      }
    }

    if (hasOpenPr || branchData.isDefaultBranch) {
      return {
        label: "Push",
        disabled: false,
        icon: "push",
        kind: "run_action",
        action: "commit_push",
        tone: "default",
      }
    }

    return {
      label: "Push & create PR",
      disabled: false,
      icon: "pr",
      kind: "run_action",
      action: "commit_push_pr",
      tone: "default",
    }
  }

  if (hasOpenPr) {
    if (pullRequest.checksStatus === "pending") {
      return {
        label: "Checks pending",
        disabled: false,
        icon: "pr",
        kind: "open_checks",
        hint: getChecksPendingHint(branchData),
        tone: "warning",
      }
    }

    if (isActionablePullRequestChecksError(pullRequest.checksError)) {
      return {
        label: "Checks unavailable",
        disabled: false,
        icon: "pr",
        kind: "open_pr",
        hint: pullRequest.checksError,
        tone: "warning",
      }
    }

    if (pullRequest.resolveReason) {
      return {
        label: getResolveActionLabel(pullRequest.resolveReason),
        disabled: false,
        icon: "chat",
        kind: "resolve_pr",
        hint: getResolveHint(pullRequest.resolveReason, {
          baseBranch: pullRequest.baseBranch,
          failedChecksCount: pullRequest.failedChecksCount,
          pendingChecksCount: pullRequest.pendingChecksCount,
        }),
        tone: getResolveTone(pullRequest.resolveReason),
      }
    }

    if (pullRequest.mergeStatus === "mergeable") {
      return {
        label: "Merge PR",
        disabled: false,
        icon: "pr",
        kind: "merge_pr",
        tone: "default",
      }
    }

    return {
      label: "View PR",
      disabled: false,
      icon: "pr",
      kind: "open_pr",
      tone: "default",
    }
  }

  if (hasMergedPr && isArchiveAvailable(branchData, options.canArchiveWorktree === true)) {
    return {
      label: "Archive",
      disabled: false,
      icon: "archive",
      kind: "open_archive",
      tone: "default",
    }
  }

  if (hasMergedPr) {
    return {
      label: "View PR",
      disabled: false,
      icon: "pr",
      kind: "open_pr",
      tone: "default",
    }
  }

  if (!branchData.hasUpstream) {
    if (!hasConfiguredPreferredRemote) {
      return {
        label: "Push",
        disabled: true,
        icon: "push",
        kind: "show_hint",
        hint: options.preferredRemoteName?.trim()
          ? `Configure the "${options.preferredRemoteName.trim()}" remote before pushing or creating a PR.`
          : "Add a remote before pushing or creating a PR.",
        tone: "default",
      }
    }

    return {
      label: "Push",
      disabled: true,
      icon: "push",
      kind: "show_hint",
      hint: "No local commits to push.",
      tone: "default",
    }
  }

  return {
    label: "Commit",
    disabled: true,
    icon: "commit",
    kind: "show_hint",
    hint: "This branch is already up to date.",
    tone: "default",
  }
}

export function requiresDefaultBranchConfirmation(
  action: GitStackedAction,
  isDefaultBranch: boolean
): boolean {
  if (!isDefaultBranch) {
    return false
  }

  return action === "commit_push" || action === "commit_push_pr"
}

export function summarizeGitResult(result: GitRunStackedActionResult): string {
  if (result.pr.status === "created" || result.pr.status === "opened_existing") {
    return result.pr.status === "created"
      ? `Created PR${result.pr.number ? ` #${result.pr.number}` : ""}`
      : `Opened PR${result.pr.number ? ` #${result.pr.number}` : ""}`
  }

  if (result.push.status === "pushed") {
    return `Pushed${result.push.upstreamBranch ? ` to ${result.push.upstreamBranch}` : ""}`
  }

  if (result.commit.status === "created") {
    const shortSha = result.commit.commitSha?.slice(0, 7)
    return shortSha ? `Committed ${shortSha}` : "Committed changes"
  }

  return "Done"
}
