import { describe, expect, test } from "bun:test"

import type { GitBranchesResponse } from "@/desktop/client"
import { buildMenuItems, resolveQuickAction } from "./gitActionsLogic"

function createBranchData(
  overrides: Partial<GitBranchesResponse> = {}
): GitBranchesResponse {
  return {
    currentBranch: "feature/header",
    upstreamBranch: "origin/feature/header",
    branches: ["main", "feature/header"],
    remoteNames: ["origin"],
    workingTreeSummary: {
      changedFiles: 0,
      additions: 0,
      deletions: 0,
    },
    aheadCount: 0,
    behindCount: 0,
    hasOriginRemote: true,
    hasUpstream: true,
    defaultBranch: "main",
    isDefaultBranch: false,
    isDetached: false,
    openPullRequest: null,
    ...overrides,
  }
}

describe("resolveQuickAction", () => {
  test("shows pending checks as a disabled warning state", () => {
    const quickAction = resolveQuickAction(
      createBranchData({
        openPullRequest: {
          number: 42,
          title: "Header polish",
          url: "https://example.com/pr/42",
          state: "open",
          baseBranch: "main",
          headBranch: "feature/header",
          checksStatus: "pending",
          mergeStatus: "blocked",
          isMergeable: false,
          pendingChecksCount: 2,
        },
      }),
      false,
      false,
      { preferredRemoteName: "origin", canArchiveWorktree: true }
    )

    expect(quickAction.label).toBe("Checks pending")
    expect(quickAction.disabled).toBe(false)
    expect(quickAction.kind).toBe("open_checks")
    expect(quickAction.hint).toContain("opens the Checks tab")
    expect(quickAction.tone).toBe("warning")
  })

  test("shows Fix checks for failed checks", () => {
    const quickAction = resolveQuickAction(
      createBranchData({
        openPullRequest: {
          number: 42,
          title: "Header polish",
          url: "https://example.com/pr/42",
          state: "open",
          baseBranch: "main",
          headBranch: "feature/header",
          checksStatus: "failed",
          mergeStatus: "blocked",
          isMergeable: false,
          resolveReason: "failed_checks",
          failedChecksCount: 1,
        },
      }),
      false,
      false,
      { preferredRemoteName: "origin", canArchiveWorktree: true }
    )

    expect(quickAction.label).toBe("Fix checks")
    expect(quickAction.disabled).toBe(false)
    expect(quickAction.icon).toBe("chat")
    expect(quickAction.kind).toBe("resolve_pr")
    expect(quickAction.tone).toBe("danger")
  })

  test("keeps pending checks ahead of merge blockers", () => {
    const quickAction = resolveQuickAction(
      createBranchData({
        openPullRequest: {
          number: 42,
          title: "Header polish",
          url: "https://example.com/pr/42",
          state: "open",
          baseBranch: "main",
          headBranch: "feature/header",
          checksStatus: "pending",
          mergeStatus: "blocked",
          isMergeable: false,
          resolveReason: "behind",
          pendingChecksCount: 2,
        },
      }),
      false,
      false,
      { preferredRemoteName: "origin", canArchiveWorktree: true }
    )

    expect(quickAction.label).toBe("Checks pending")
    expect(quickAction.kind).toBe("open_checks")
    expect(quickAction.tone).toBe("warning")
  })

  test("keeps failed checks ahead of merge blockers", () => {
    const quickAction = resolveQuickAction(
      createBranchData({
        openPullRequest: {
          number: 42,
          title: "Header polish",
          url: "https://example.com/pr/42",
          state: "open",
          baseBranch: "main",
          headBranch: "feature/header",
          checksStatus: "failed",
          mergeStatus: "blocked",
          isMergeable: false,
          resolveReason: "failed_checks",
          failedChecksCount: 1,
        },
      }),
      false,
      false,
      { preferredRemoteName: "origin", canArchiveWorktree: true }
    )

    expect(quickAction.label).toBe("Fix checks")
    expect(quickAction.kind).toBe("resolve_pr")
    expect(quickAction.tone).toBe("danger")
  })

  test("shows Fix conflicts for merge conflicts", () => {
    const quickAction = resolveQuickAction(
      createBranchData({
        openPullRequest: {
          number: 42,
          title: "Header polish",
          url: "https://example.com/pr/42",
          state: "open",
          baseBranch: "main",
          headBranch: "feature/header",
          checksStatus: "passed",
          mergeStatus: "blocked",
          isMergeable: false,
          resolveReason: "conflicts",
        },
      }),
      false,
      false,
      { preferredRemoteName: "origin", canArchiveWorktree: true }
    )

    expect(quickAction.label).toBe("Fix conflicts")
    expect(quickAction.icon).toBe("chat")
    expect(quickAction.kind).toBe("resolve_pr")
    expect(quickAction.tone).toBe("danger")
  })

  test("shows Draft PR for draft pull requests", () => {
    const quickAction = resolveQuickAction(
      createBranchData({
        openPullRequest: {
          number: 42,
          title: "Header polish",
          url: "https://example.com/pr/42",
          state: "open",
          baseBranch: "main",
          headBranch: "feature/header",
          checksStatus: "passed",
          mergeStatus: "blocked",
          isMergeable: false,
          resolveReason: "draft",
        },
      }),
      false,
      false,
      { preferredRemoteName: "origin", canArchiveWorktree: true }
    )

    expect(quickAction.label).toBe("Draft PR")
    expect(quickAction.icon).toBe("chat")
    expect(quickAction.kind).toBe("resolve_pr")
    expect(quickAction.tone).toBe("warning")
  })

  test("shows Merge PR when checks are passing and the PR is mergeable", () => {
    const quickAction = resolveQuickAction(
      createBranchData({
        openPullRequest: {
          number: 42,
          title: "Header polish",
          url: "https://example.com/pr/42",
          state: "open",
          baseBranch: "main",
          headBranch: "feature/header",
          checksStatus: "passed",
          mergeStatus: "mergeable",
          isMergeable: true,
          passedChecksCount: 3,
        },
      }),
      false,
      false,
      { preferredRemoteName: "origin", canArchiveWorktree: true }
    )

    expect(quickAction.label).toBe("Merge PR")
    expect(quickAction.kind).toBe("merge_pr")
  })

  test("shows Update branch when GitHub requires the PR branch to catch up", () => {
    const quickAction = resolveQuickAction(
      createBranchData({
        openPullRequest: {
          number: 42,
          title: "Header polish",
          url: "https://example.com/pr/42",
          state: "open",
          baseBranch: "main",
          headBranch: "feature/header",
          checksStatus: "passed",
          mergeStatus: "blocked",
          isMergeable: false,
          resolveReason: "behind",
        },
      }),
      false,
      false,
      { preferredRemoteName: "origin", canArchiveWorktree: true }
    )

    expect(quickAction.label).toBe("Update branch")
    expect(quickAction.kind).toBe("resolve_pr")
    expect(quickAction.tone).toBe("warning")
  })

  test("shows Resolve blocker when GitHub reports a protected merge blocker", () => {
    const quickAction = resolveQuickAction(
      createBranchData({
        openPullRequest: {
          number: 42,
          title: "Header polish",
          url: "https://example.com/pr/42",
          state: "open",
          baseBranch: "main",
          headBranch: "feature/header",
          checksStatus: "passed",
          mergeStatus: "blocked",
          isMergeable: false,
          resolveReason: "blocked",
        },
      }),
      false,
      false,
      { preferredRemoteName: "origin", canArchiveWorktree: true }
    )

    expect(quickAction.label).toBe("Resolve blocker")
    expect(quickAction.kind).toBe("resolve_pr")
    expect(quickAction.tone).toBe("warning")
  })

  test("shows Checks unavailable when PR checks could not be loaded", () => {
    const quickAction = resolveQuickAction(
      createBranchData({
        openPullRequest: {
          number: 42,
          title: "Header polish",
          url: "https://example.com/pr/42",
          state: "open",
          baseBranch: "main",
          headBranch: "feature/header",
          checksStatus: "none",
          mergeStatus: "mergeable",
          isMergeable: true,
          checksError: "Unable to load pull request checks from GitHub.",
        },
      }),
      false,
      false,
      { preferredRemoteName: "origin", canArchiveWorktree: true }
    )

    expect(quickAction.label).toBe("Checks unavailable")
    expect(quickAction.kind).toBe("open_pr")
    expect(quickAction.tone).toBe("warning")
  })

  test("keeps pending checks ahead of a transient checks error", () => {
    const quickAction = resolveQuickAction(
      createBranchData({
        openPullRequest: {
          number: 42,
          title: "Header polish",
          url: "https://example.com/pr/42",
          state: "open",
          baseBranch: "main",
          headBranch: "feature/header",
          checksStatus: "pending",
          mergeStatus: "blocked",
          isMergeable: false,
          checksError: "Unable to load pull request checks from GitHub.",
          pendingChecksCount: 1,
        },
      }),
      false,
      false,
      { preferredRemoteName: "origin", canArchiveWorktree: true }
    )

    expect(quickAction.label).toBe("Checks pending")
    expect(quickAction.kind).toBe("open_checks")
  })

  test("falls through to merge state when a PR has no checks", () => {
    const quickAction = resolveQuickAction(
      createBranchData({
        openPullRequest: {
          number: 42,
          title: "Header polish",
          url: "https://example.com/pr/42",
          state: "open",
          baseBranch: "main",
          headBranch: "feature/header",
          checksStatus: "none",
          mergeStatus: "mergeable",
          isMergeable: true,
        },
      }),
      false,
      false,
      { preferredRemoteName: "origin", canArchiveWorktree: true }
    )

    expect(quickAction.label).toBe("Merge PR")
    expect(quickAction.kind).toBe("merge_pr")
  })

  test("falls through to merge state for benign no-checks messages", () => {
    const quickAction = resolveQuickAction(
      createBranchData({
        openPullRequest: {
          number: 42,
          title: "Header polish",
          url: "https://example.com/pr/42",
          state: "open",
          baseBranch: "main",
          headBranch: "feature/header",
          checksStatus: "none",
          mergeStatus: "mergeable",
          isMergeable: true,
          checksError: "GitHub returned no pull request check data.",
        },
      }),
      false,
      false,
      { preferredRemoteName: "origin", canArchiveWorktree: true }
    )

    expect(quickAction.label).toBe("Merge PR")
    expect(quickAction.kind).toBe("merge_pr")
  })

  test("shows Archive for merged PRs on managed worktrees", () => {
    const quickAction = resolveQuickAction(
      createBranchData({
        openPullRequest: {
          number: 42,
          title: "Header polish",
          url: "https://example.com/pr/42",
          state: "merged",
          baseBranch: "main",
          headBranch: "feature/header",
          checksStatus: "none",
          mergeStatus: "merged",
          isMergeable: false,
        },
      }),
      false,
      false,
      { preferredRemoteName: "origin", canArchiveWorktree: true }
    )

    expect(quickAction.label).toBe("Archive")
    expect(quickAction.kind).toBe("open_archive")
  })

  test("does not show Archive for merged PRs on the root workspace", () => {
    const quickAction = resolveQuickAction(
      createBranchData({
        openPullRequest: {
          number: 42,
          title: "Header polish",
          url: "https://example.com/pr/42",
          state: "merged",
          baseBranch: "main",
          headBranch: "feature/header",
          checksStatus: "none",
          mergeStatus: "merged",
          isMergeable: false,
        },
      }),
      false,
      false,
      { preferredRemoteName: "origin", canArchiveWorktree: false }
    )

    expect(quickAction.label).toBe("View PR")
    expect(quickAction.kind).toBe("open_pr")
  })

  test("returns commit/push behavior when new local changes exist after a PR opens", () => {
    const quickAction = resolveQuickAction(
      createBranchData({
        openPullRequest: {
          number: 42,
          title: "Header polish",
          url: "https://example.com/pr/42",
          state: "open",
          baseBranch: "main",
          headBranch: "feature/header",
          checksStatus: "passed",
          mergeStatus: "mergeable",
          isMergeable: true,
        },
      }),
      true,
      false,
      { preferredRemoteName: "origin", canArchiveWorktree: true }
    )

    expect(quickAction.label).toBe("Commit & push")
    expect(quickAction.kind).toBe("run_action")
  })

  test("returns commit/push behavior when new local changes exist after merge", () => {
    const quickAction = resolveQuickAction(
      createBranchData({
        openPullRequest: {
          number: 42,
          title: "Header polish",
          url: "https://example.com/pr/42",
          state: "merged",
          baseBranch: "main",
          headBranch: "feature/header",
          checksStatus: "none",
          mergeStatus: "merged",
          isMergeable: false,
        },
      }),
      true,
      false,
      { preferredRemoteName: "origin", canArchiveWorktree: true }
    )

    expect(quickAction.label).toBe("Commit, push & PR")
    expect(quickAction.kind).toBe("run_action")
  })

  test("keeps existing push and create PR behavior when no PR exists", () => {
    const quickAction = resolveQuickAction(
      createBranchData({
        aheadCount: 1,
      }),
      false,
      false,
      { preferredRemoteName: "origin", canArchiveWorktree: true }
    )

    expect(quickAction.label).toBe("Push & create PR")
    expect(quickAction.kind).toBe("run_action")
  })
})

describe("buildMenuItems", () => {
  test("keeps Archive in the menu when a merged PR exists but local changes take priority", () => {
    const menuItems = buildMenuItems(
      createBranchData({
        openPullRequest: {
          number: 42,
          title: "Header polish",
          url: "https://example.com/pr/42",
          state: "merged",
          baseBranch: "main",
          headBranch: "feature/header",
          checksStatus: "none",
          mergeStatus: "merged",
          isMergeable: false,
        },
      }),
      true,
      false,
      { preferredRemoteName: "origin", canArchiveWorktree: true }
    )

    expect(menuItems.some((item) => item.id === "archive" && item.kind === "open_archive")).toBe(
      true
    )
  })

  test("keeps Resolve in the menu when local changes take priority over a blocked PR", () => {
    const menuItems = buildMenuItems(
      createBranchData({
        openPullRequest: {
          number: 42,
          title: "Header polish",
          url: "https://example.com/pr/42",
          state: "open",
          baseBranch: "main",
          headBranch: "feature/header",
          checksStatus: "passed",
          mergeStatus: "blocked",
          isMergeable: false,
          resolveReason: "behind",
        },
      }),
      true,
      false,
      { preferredRemoteName: "origin", canArchiveWorktree: true }
    )

    expect(menuItems.some((item) => item.id === "resolve" && item.label === "Update branch")).toBe(true)
    expect(menuItems.some((item) => item.id === "pr" && item.kind === "open_pr")).toBe(true)
  })
})
