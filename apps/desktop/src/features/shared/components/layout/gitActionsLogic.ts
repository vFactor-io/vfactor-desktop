import type {
  GitBranchesResponse,
  GitRunStackedActionResult,
  GitStackedAction,
} from "@/desktop/client"

export type GitActionIconName = "commit" | "push" | "pr" | "info"

export interface GitActionMenuItem {
  id: "commit" | "push" | "pr"
  label: string
  disabled: boolean
  icon: GitActionIconName
  action?: GitStackedAction
  openDialog?: boolean
  opensPr?: boolean
}

export interface GitQuickAction {
  label: string
  disabled: boolean
  kind: "run_action" | "run_pull" | "open_pr" | "show_hint"
  action?: GitStackedAction
  hint?: string
}

export function buildMenuItems(
  branchData: GitBranchesResponse | null,
  hasChanges: boolean,
  isBusy: boolean
): GitActionMenuItem[] {
  if (!branchData) {
    return []
  }

  const hasBranch = !branchData.isDetached
  const hasOpenPr = branchData.openPullRequest?.state === "open"
  const isBehind = branchData.behindCount > 0
  const canPushWithoutUpstream = branchData.hasOriginRemote && !branchData.hasUpstream
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
  const canOpenPr = !isBusy && hasOpenPr

  return [
    {
      id: "commit",
      label: "Commit",
      disabled: !canCommit,
      icon: "commit",
      action: "commit",
      openDialog: true,
    },
    {
      id: "push",
      label: "Push",
      disabled: !canPush,
      icon: "push",
      action: "commit_push",
    },
    hasOpenPr
      ? {
          id: "pr",
          label: "View PR",
          disabled: !canOpenPr,
          icon: "pr",
          opensPr: true,
        }
      : {
          id: "pr",
          label: "Create PR",
          disabled: !canCreatePr,
          icon: "pr",
          action: "commit_push_pr",
        },
  ]
}

export function resolveQuickAction(
  branchData: GitBranchesResponse | null,
  hasChanges: boolean,
  isBusy: boolean
): GitQuickAction {
  if (isBusy) {
    return {
      label: "Commit",
      disabled: true,
      kind: "show_hint",
      hint: "A git action is already in progress.",
    }
  }

  if (!branchData) {
    return {
      label: "Commit",
      disabled: true,
      kind: "show_hint",
      hint: "Git status is unavailable.",
    }
  }

  const hasBranch = !branchData.isDetached
  const hasOpenPr = branchData.openPullRequest?.state === "open"
  const isAhead = branchData.aheadCount > 0
  const isBehind = branchData.behindCount > 0
  const isDiverged = isAhead && isBehind

  if (!hasBranch) {
    return {
      label: "Commit",
      disabled: true,
      kind: "show_hint",
      hint: "Create and checkout a branch before pushing or opening a PR.",
    }
  }

  if (hasChanges) {
    if (!branchData.hasUpstream && !branchData.hasOriginRemote) {
      return { label: "Commit", disabled: false, kind: "run_action", action: "commit" }
    }
    if (hasOpenPr || branchData.isDefaultBranch) {
      return {
        label: "Commit & push",
        disabled: false,
        kind: "run_action",
        action: "commit_push",
      }
    }
    return {
      label: "Commit, push & PR",
      disabled: false,
      kind: "run_action",
      action: "commit_push_pr",
    }
  }

  if (!branchData.hasUpstream) {
    if (!branchData.hasOriginRemote) {
      if (hasOpenPr && !isAhead) {
        return { label: "View PR", disabled: false, kind: "open_pr" }
      }
      return {
        label: "Push",
        disabled: true,
        kind: "show_hint",
        hint: 'Add an "origin" remote before pushing or creating a PR.',
      }
    }

    if (!isAhead) {
      if (hasOpenPr) {
        return { label: "View PR", disabled: false, kind: "open_pr" }
      }
      return {
        label: "Push",
        disabled: true,
        kind: "show_hint",
        hint: "No local commits to push.",
      }
    }

    if (hasOpenPr || branchData.isDefaultBranch) {
      return { label: "Push", disabled: false, kind: "run_action", action: "commit_push" }
    }

    return {
      label: "Push & create PR",
      disabled: false,
      kind: "run_action",
      action: "commit_push_pr",
    }
  }

  if (isDiverged) {
    return {
      label: "Sync branch",
      disabled: true,
      kind: "show_hint",
      hint: "This branch has diverged from upstream. Rebase or merge before continuing.",
    }
  }

  if (isBehind) {
    return {
      label: "Pull",
      disabled: false,
      kind: "run_pull",
    }
  }

  if (isAhead) {
    if (hasOpenPr || branchData.isDefaultBranch) {
      return { label: "Push", disabled: false, kind: "run_action", action: "commit_push" }
    }

    return {
      label: "Push & create PR",
      disabled: false,
      kind: "run_action",
      action: "commit_push_pr",
    }
  }

  if (hasOpenPr && branchData.hasUpstream) {
    return { label: "View PR", disabled: false, kind: "open_pr" }
  }

  return {
    label: "Commit",
    disabled: true,
    kind: "show_hint",
    hint: "This branch is already up to date.",
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
