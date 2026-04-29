import type { GitBranchesResponse, GitPullRequestResolveReason } from "@/desktop/contracts"

export const GIT_RESOLVE_REASONS = [
  "conflicts",
  "behind",
  "failed_checks",
  "blocked",
  "draft",
  "unknown",
] as const satisfies readonly GitPullRequestResolveReason[]

export type GitResolvePrompts = Record<GitPullRequestResolveReason, string>

export const GIT_RESOLVE_TEMPLATE_VARIABLES = [
  "projectName",
  "projectPath",
  "worktreeName",
  "worktreePath",
  "currentBranch",
  "baseBranch",
  "prNumber",
  "prTitle",
  "prUrl",
  "checksStatus",
  "mergeStatus",
  "resolveReason",
  "failedChecksCount",
  "pendingChecksCount",
  "passedChecksCount",
  "failingChecks",
  "gitStatusSummary",
] as const

const DEFAULT_GIT_RESOLVE_PROMPTS: GitResolvePrompts = {
  conflicts: [
    "This pull request is blocked by merge conflicts.",
    "Inspect the current project state, resolve the conflicts, and make whatever code changes are needed to get the PR back into a mergeable state.",
    "",
    "Project: {{projectName}}",
    "Project path: {{projectPath}}",
    "Worktree: {{worktreeName}}",
    "Worktree path: {{worktreePath}}",
    "Current branch: {{currentBranch}}",
    "Base branch: {{baseBranch}}",
    "PR: #{{prNumber}} {{prTitle}}",
    "PR URL: {{prUrl}}",
    "Checks status: {{checksStatus}}",
    "Merge status: {{mergeStatus}}",
    "Git status:",
    "{{gitStatusSummary}}",
  ].join("\n"),
  behind: [
    "This pull request is behind its base branch.",
    "Inspect the branch, update it safely, and fix any issues introduced by bringing it up to date so the PR can be merged.",
    "",
    "Project: {{projectName}}",
    "Project path: {{projectPath}}",
    "Worktree: {{worktreeName}}",
    "Worktree path: {{worktreePath}}",
    "Current branch: {{currentBranch}}",
    "Base branch: {{baseBranch}}",
    "PR: #{{prNumber}} {{prTitle}}",
    "PR URL: {{prUrl}}",
    "Checks status: {{checksStatus}}",
    "Merge status: {{mergeStatus}}",
    "Git status:",
    "{{gitStatusSummary}}",
  ].join("\n"),
  failed_checks: [
    "This pull request has failing required checks.",
    "Investigate the failures, make the needed fixes in the current project, and leave the branch ready to re-run cleanly.",
    "",
    "Project: {{projectName}}",
    "Project path: {{projectPath}}",
    "Worktree: {{worktreeName}}",
    "Worktree path: {{worktreePath}}",
    "Current branch: {{currentBranch}}",
    "Base branch: {{baseBranch}}",
    "PR: #{{prNumber}} {{prTitle}}",
    "PR URL: {{prUrl}}",
    "Checks status: {{checksStatus}}",
    "Merge status: {{mergeStatus}}",
    "Failed checks count: {{failedChecksCount}}",
    "Pending checks count: {{pendingChecksCount}}",
    "Passed checks count: {{passedChecksCount}}",
    "Failing checks: {{failingChecks}}",
    "Git status:",
    "{{gitStatusSummary}}",
  ].join("\n"),
  blocked: [
    "This pull request is blocked from merging.",
    "Inspect what is preventing merge, make the needed project changes if they are fixable in code, and leave a short summary of what is still required if GitHub policy is the blocker.",
    "",
    "Project: {{projectName}}",
    "Project path: {{projectPath}}",
    "Worktree: {{worktreeName}}",
    "Worktree path: {{worktreePath}}",
    "Current branch: {{currentBranch}}",
    "Base branch: {{baseBranch}}",
    "PR: #{{prNumber}} {{prTitle}}",
    "PR URL: {{prUrl}}",
    "Checks status: {{checksStatus}}",
    "Merge status: {{mergeStatus}}",
    "Git status:",
    "{{gitStatusSummary}}",
  ].join("\n"),
  draft: [
    "This pull request is still marked as draft.",
    "Inspect the branch and current project state, make any code or cleanup changes needed to prepare it for merge readiness, and summarize what still needs human review if applicable.",
    "",
    "Project: {{projectName}}",
    "Project path: {{projectPath}}",
    "Worktree: {{worktreeName}}",
    "Worktree path: {{worktreePath}}",
    "Current branch: {{currentBranch}}",
    "Base branch: {{baseBranch}}",
    "PR: #{{prNumber}} {{prTitle}}",
    "PR URL: {{prUrl}}",
    "Checks status: {{checksStatus}}",
    "Merge status: {{mergeStatus}}",
    "Git status:",
    "{{gitStatusSummary}}",
  ].join("\n"),
  unknown: [
    "This pull request is not currently mergeable, but GitHub did not provide a specific reason.",
    "Inspect the branch and repository state, determine what is blocking merge, and fix whatever is actionable from code.",
    "",
    "Project: {{projectName}}",
    "Project path: {{projectPath}}",
    "Worktree: {{worktreeName}}",
    "Worktree path: {{worktreePath}}",
    "Current branch: {{currentBranch}}",
    "Base branch: {{baseBranch}}",
    "PR: #{{prNumber}} {{prTitle}}",
    "PR URL: {{prUrl}}",
    "Checks status: {{checksStatus}}",
    "Merge status: {{mergeStatus}}",
    "Git status:",
    "{{gitStatusSummary}}",
  ].join("\n"),
}

export function createDefaultGitResolvePrompts(): GitResolvePrompts {
  return { ...DEFAULT_GIT_RESOLVE_PROMPTS }
}

export function normalizeGitResolvePrompts(
  prompts: Partial<Record<GitPullRequestResolveReason, string>> | null | undefined
): GitResolvePrompts {
  const normalized = createDefaultGitResolvePrompts()

  for (const reason of GIT_RESOLVE_REASONS) {
    if (typeof prompts?.[reason] === "string") {
      normalized[reason] = prompts[reason]!.replace(/\r\n/g, "\n")
    }
  }

  return normalized
}

export function getResolveTone(
  resolveReason: GitPullRequestResolveReason
): "danger" | "warning" {
  if (resolveReason === "conflicts" || resolveReason === "failed_checks") {
    return "danger"
  }

  return "warning"
}

export function getResolveHint(
  resolveReason: GitPullRequestResolveReason,
  context?: {
    baseBranch?: string | null
    failedChecksCount?: number | null
    pendingChecksCount?: number | null
  }
): string {
  const baseBranch = context?.baseBranch?.trim() || "the base branch"
  const failedChecksCount = context?.failedChecksCount ?? 0
  const pendingChecksCount = context?.pendingChecksCount ?? 0

  switch (resolveReason) {
    case "conflicts":
      return "GitHub says this PR has merge conflicts.\nClicking this opens a resolve chat to fix the conflicts in this branch."
    case "behind":
      return `GitHub says this branch is out-of-date with ${baseBranch}.\nClicking this opens a resolve chat to merge the latest ${baseBranch} changes into this branch.`
    case "failed_checks":
      return `${failedChecksCount > 0 ? `${failedChecksCount} required check${failedChecksCount === 1 ? " is" : "s are"} failing.` : "GitHub says required checks are failing."}\nClicking this opens a resolve chat to investigate and fix the failing checks.`
    case "blocked":
      return "GitHub says merging is blocked.\nClicking this opens a resolve chat to investigate the blocker; if it is a GitHub-only requirement like an unresolved conversation, it will point you back to the PR."
    case "draft":
      return "GitHub says this PR is still a draft.\nClicking this opens a resolve chat to prepare the branch for merge readiness."
    case "unknown":
      return "GitHub says this PR is not mergeable yet, but did not provide a specific reason.\nClicking this opens a resolve chat to inspect the PR state and identify the blocker."
  }
}

export function getResolveActionLabel(resolveReason: GitPullRequestResolveReason): string {
  switch (resolveReason) {
    case "conflicts":
      return "Fix conflicts"
    case "behind":
      return "Update branch"
    case "failed_checks":
      return "Fix checks"
    case "blocked":
      return "Resolve blocker"
    case "draft":
      return "Draft PR"
    case "unknown":
      return "View blocker"
  }
}

function formatGitStatusSummary(branchData: GitBranchesResponse): string {
  const summary = branchData.workingTreeSummary
  if (summary.changedFiles === 0) {
    return "Working tree is clean."
  }

  return [
    `${summary.changedFiles} changed file${summary.changedFiles === 1 ? "" : "s"}`,
    `${summary.additions} addition${summary.additions === 1 ? "" : "s"}`,
    `${summary.deletions} deletion${summary.deletions === 1 ? "" : "s"}`,
  ].join(", ")
}

function renderTemplate(
  template: string,
  variables: Record<(typeof GIT_RESOLVE_TEMPLATE_VARIABLES)[number], string>
): string {
  return template
    .replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      if (key in variables) {
        return variables[key as keyof typeof variables]
      }

      return ""
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function buildResolvePrompt(
  branchData: GitBranchesResponse,
  prompts: GitResolvePrompts,
  context: {
    projectName?: string | null
    projectPath?: string | null
    worktreeName?: string | null
    worktreePath?: string | null
  }
): string {
  const pullRequest = branchData.openPullRequest
  if (!pullRequest || pullRequest.state !== "open" || !pullRequest.resolveReason) {
    throw new Error("No resolvable pull request is available for this branch.")
  }

  const template = prompts[pullRequest.resolveReason] ?? DEFAULT_GIT_RESOLVE_PROMPTS[pullRequest.resolveReason]
  return renderTemplate(template, {
    projectName: context.projectName?.trim() ?? "",
    projectPath: context.projectPath?.trim() ?? context.worktreePath?.trim() ?? "",
    worktreeName: context.worktreeName?.trim() ?? "",
    worktreePath: context.worktreePath?.trim() ?? "",
    currentBranch: branchData.currentBranch,
    baseBranch: pullRequest.baseBranch,
    prNumber: String(pullRequest.number),
    prTitle: pullRequest.title,
    prUrl: pullRequest.url,
    checksStatus: pullRequest.checksStatus,
    mergeStatus: pullRequest.mergeStatus,
    resolveReason: pullRequest.resolveReason,
    failedChecksCount: String(pullRequest.failedChecksCount ?? 0),
    pendingChecksCount: String(pullRequest.pendingChecksCount ?? 0),
    passedChecksCount: String(pullRequest.passedChecksCount ?? 0),
    failingChecks: pullRequest.failedCheckNames?.join(", ") ?? "",
    gitStatusSummary: formatGitStatusSummary(branchData),
  })
}
