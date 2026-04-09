export interface GitWorkingTreeSummary {
  changedFiles: number
  additions: number
  deletions: number
}

export type GitFileStatus =
  | "modified"
  | "added"
  | "deleted"
  | "untracked"
  | "renamed"
  | "copied"
  | "ignored"

export interface GitFileChange {
  path: string
  status: GitFileStatus
  previousPath?: string | null
  additions?: number
  deletions?: number
}

export interface GitFileDiff {
  path: string
  previousPath?: string | null
  status: GitFileStatus
  original: string
  modified: string
}

export interface GitBranchesResponse {
  currentBranch: string
  upstreamBranch: string | null
  branches: string[]
  remoteNames: string[]
  workingTreeSummary: GitWorkingTreeSummary
  aheadCount: number
  behindCount: number
  hasOriginRemote: boolean
  hasUpstream: boolean
  defaultBranch: string | null
  isDefaultBranch: boolean
  isDetached: boolean
  openPullRequest: GitPullRequest | null
}

export type GitPullRequestResolveReason =
  | "conflicts"
  | "behind"
  | "failed_checks"
  | "blocked"
  | "draft"
  | "unknown"

export interface GitPullRequest {
  number: number
  title: string
  description?: string | null
  url: string
  state: "open" | "closed" | "merged"
  baseBranch: string
  headBranch: string
  checksStatus: "none" | "pending" | "passed" | "failed"
  mergeStatus: "unknown" | "blocked" | "mergeable" | "merged"
  isMergeable: boolean
  resolveReason?: GitPullRequestResolveReason
  checksError?: string | null
  failedChecksCount?: number
  failedCheckNames?: string[]
  pendingChecksCount?: number
  passedChecksCount?: number
}

export type GitPullRequestCheckStatus =
  | "pending"
  | "passed"
  | "failed"
  | "cancelled"
  | "skipped"

export interface GitPullRequestCheck {
  id: string
  name: string
  workflowName?: string | null
  description?: string | null
  event?: string | null
  status: GitPullRequestCheckStatus
  startedAt?: string | null
  completedAt?: string | null
  detailsUrl?: string | null
  errorText?: string
  errorCopyText?: string
  hasFailureDetails: boolean
}

export interface GitPullRequestChecksResponse {
  checks: GitPullRequestCheck[]
  pullRequestNumber: number | null
  error?: string | null
}

export interface GitWorktreeSummary {
  path: string
  branchName: string
  head: string | null
  isDetached: boolean
  isCurrent: boolean
  isMain: boolean
}

export interface GitCreateWorktreeInput {
  name: string
  branchName: string
  baseBranch: string
  remoteName?: string | null
  targetPath?: string | null
}

export interface GitCreateWorktreeResult {
  worktree: GitWorktreeSummary
}

export interface GitRemoveWorktreeInput {
  worktreePath: string
}

export interface GitRemoveWorktreeResult {
  worktreePath: string
}

export interface GitRenameWorktreeInput {
  worktreePath: string
  branchName: string
  targetPath?: string | null
}

export interface GitRenameWorktreeResult {
  worktree: GitWorktreeSummary
  previousBranchName: string
  previousPath: string
}

export type GitStackedAction = "commit" | "commit_push" | "commit_push_pr"

export interface GitRunStackedActionInput {
  action: GitStackedAction
  commitMessage?: string
  featureBranch?: boolean
  filePaths?: string[]
  generationModel?: string | null
  remoteName?: string | null
}

export interface GitRunStackedActionResult {
  action: GitStackedAction
  branch: {
    status: "created" | "skipped_not_requested"
    name?: string
  }
  commit: {
    status: "created" | "skipped_no_changes"
    commitSha?: string
    subject?: string
  }
  push: {
    status: "pushed" | "skipped_not_requested" | "skipped_up_to_date"
    branch?: string
    upstreamBranch?: string | null
    setUpstream?: boolean
  }
  pr: {
    status: "created" | "opened_existing" | "skipped_not_requested"
    url?: string
    number?: number
    title?: string
    baseBranch?: string
    headBranch?: string
  }
}

export type GitActionStep = "generating" | "committing" | "pushing" | "creating_pr"

export interface GitActionProgressEvent {
  step: GitActionStep
}

export interface GitPullResult {
  status: "pulled" | "skipped_up_to_date"
  branch: string
  upstreamBranch: string | null
}

export interface GitMergePullRequestResult {
  number: number
  url: string
}

export interface ProjectFileSystemEvent {
  rootPath: string
  kind: "add" | "modify" | "unlink" | "rename" | "rescan"
  path: string
  oldPath?: string | null
  isDirectory: boolean
  requiresRescan: boolean
}

export interface TerminalStartResponse {
  initialData: string
  shellKind: "posix" | "cmd" | "powershell"
}

export interface TerminalCreateSessionEnvironment {
  [key: string]: string
}

export interface TerminalDataEvent {
  sessionId: string
  data: string
}

export interface TerminalExitEvent {
  sessionId: string
  exitCode?: number
}

export interface AppUpdateInfo {
  version: string
  currentVersion: string
  notes: string | null
  pubDate: string | null
  target: string
}

export interface AppUpdateDownloadEvent {
  event: "started" | "progress" | "finished"
  chunkLength?: number | null
  downloaded?: number | null
  contentLength?: number | null
}

export interface ManagedSkill {
  id: string
  name: string
  description: string
  directoryPath: string
  entryPath: string
  body: string
  hasFrontmatter: boolean
}

export interface SkillsSyncResponse {
  managedRootPath: string
  skills: ManagedSkill[]
}

export interface DesktopDirEntry {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
}

export interface WriteTextFileOptions {
  create?: boolean
}

export interface CopyPathsIntoDirectoryOptions {
  overwrite?: boolean
}

export interface ReadFileAsDataUrlOptions {
  mimeType?: string
}

export interface RemovePathOptions {
  recursive?: boolean
  force?: boolean
}

export interface StoreValueMap {
  [key: string]: unknown
}
