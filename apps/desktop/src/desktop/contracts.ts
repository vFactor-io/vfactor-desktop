import type {
  CollaborationModeKind,
  RuntimeModeKind,
  HarnessId,
  RuntimeFileSearchResult,
  HarnessTurnResult,
  RuntimeAgent,
  RuntimeCommand,
  RuntimeModel,
  RuntimePrompt,
  RuntimePromptResponse,
  RuntimeReasoningEffort,
  RuntimeSession,
} from "@/features/chat/types"

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
  patch?: string | null
  isBinary?: boolean
  isImage?: boolean
  isTooLarge?: boolean
  previewUnavailableReason?: "binary" | "image" | "too_large"
}

export interface GitBranchesResponse {
  isGitAvailable: boolean
  isRepo: boolean
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

export type GitPullRequestReviewState =
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "COMMENTED"
  | "DISMISSED"
  | "PENDING"
  | "UNKNOWN"

export interface GitPullRequestReview {
  id: string
  authorLogin: string
  authorAvatarUrl?: string | null
  authorAssociation?: string | null
  body?: string | null
  state: GitPullRequestReviewState
  submittedAt?: string | null
  commitOid?: string | null
}

export interface GitPullRequestComment {
  id: string
  authorLogin: string
  authorAvatarUrl?: string | null
  authorAssociation?: string | null
  body?: string | null
  createdAt?: string | null
  url?: string | null
}

export interface GitPullRequestReviewComment {
  id: string
  threadId: string
  authorLogin: string
  authorAvatarUrl?: string | null
  body?: string | null
  path?: string | null
  state?: string | null
  createdAt?: string | null
  publishedAt?: string | null
  url?: string | null
  diffHunk?: string | null
  line?: number | null
  startLine?: number | null
  originalLine?: number | null
  originalStartLine?: number | null
  isResolved: boolean
  isOutdated: boolean
  replyToId?: string | null
}

export interface GitPullRequestChecksResponse {
  checks: GitPullRequestCheck[]
  reviews: GitPullRequestReview[]
  comments: GitPullRequestComment[]
  reviewComments: GitPullRequestReviewComment[]
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

export type AppUpdateStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "up-to-date"
  | "downloading"
  | "ready"
  | "blocked"
  | "installing"
  | "error"

export type AppUpdateErrorContext = "check" | "download" | "install" | "blocked" | null

export interface AppUpdateActiveWork {
  activeTurns: number
  activeTerminalSessions: number
  labels: string[]
}

export interface AppUpdateState {
  enabled: boolean
  status: AppUpdateStatus
  currentVersion: string
  availableVersion: string | null
  downloadedVersion: string | null
  downloadPercent: number | null
  checkedAt: number | null
  message: string | null
  errorContext: AppUpdateErrorContext
  activeWork: AppUpdateActiveWork | null
  canDismiss: boolean
  canRetry: boolean
  canInstall: boolean
}

export interface AppUpdateActionResult {
  accepted: boolean
  completed: boolean
  state: AppUpdateState
}

export interface AppUpdateCheckResult {
  checked: boolean
  state: AppUpdateState
}

export interface AppWindowThemeSyncInput {
  themeSource: "system" | "light" | "dark"
  resolvedAppearance: "light" | "dark"
  backgroundColor: string
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

export interface RuntimeCreateSessionInput {
  harnessId: HarnessId
  projectPath: string
  runtimeMode?: RuntimeModeKind
}

export interface RuntimeListModelsInput {
  harnessId: HarnessId
}

export interface RuntimeRefreshProviderStatusInput {
  harnessId: HarnessId
}

export interface RuntimeListAgentsInput {
  harnessId: HarnessId
}

export interface RuntimeListCommandsInput {
  harnessId: HarnessId
  projectPath?: string
}

export interface RuntimeSearchFilesInput {
  harnessId: HarnessId
  query: string
  directory?: string
}

export interface RuntimeSendTurnInput {
  harnessId: HarnessId
  session: RuntimeSession
  turnId: string
  projectPath?: string
  text: string
  agent?: string
  collaborationMode?: CollaborationModeKind
  runtimeMode?: RuntimeModeKind
  model?: string
  reasoningEffort?: RuntimeReasoningEffort | null
  modelVariant?: string | null
  fastMode?: boolean
}

export interface RuntimeAnswerPromptInput {
  harnessId: HarnessId
  session: RuntimeSession
  projectPath?: string
  prompt: RuntimePrompt
  response: RuntimePromptResponse
}

export interface RuntimeInterruptTurnInput {
  harnessId: HarnessId
  session: RuntimeSession
}

export interface RuntimeSessionResult {
  session: RuntimeSession
}

export interface RuntimeModelsResult {
  models: RuntimeModel[]
}

export type RuntimeProviderAuthStatus = "authenticated" | "unauthenticated" | "unknown"

export interface RuntimeProviderAuth {
  status: RuntimeProviderAuthStatus
  type?: string
  label?: string
}

export interface RuntimeProviderStatus {
  harnessId: HarnessId
  enabled: boolean
  installed: boolean
  version: string | null
  auth: RuntimeProviderAuth
  models: RuntimeModel[]
  message?: string
  checkedAt: number
}

export interface RuntimeProviderStatusesResult {
  statuses: RuntimeProviderStatus[]
}

export interface RuntimeProviderSettingsBase {
  enabled: boolean
  binaryPath: string
  customModels: string[]
}

export interface RuntimeCodexProviderSettings extends RuntimeProviderSettingsBase {
  homePath: string
}

export interface RuntimeClaudeProviderSettings extends RuntimeProviderSettingsBase {
  launchArgs: string
}

export interface RuntimeOpenCodeProviderSettings extends RuntimeProviderSettingsBase {
  serverUrl: string
  serverPassword: string
}

export interface RuntimeProviderSettingsRecord {
  codex: RuntimeCodexProviderSettings
  "claude-code": RuntimeClaudeProviderSettings
  opencode: RuntimeOpenCodeProviderSettings
}

export interface RuntimeAgentsResult {
  agents: RuntimeAgent[]
}

export interface RuntimeCommandsResult {
  commands: RuntimeCommand[]
}

export interface RuntimeFileSearchResultSet {
  results: RuntimeFileSearchResult[]
}

export interface RuntimeTurnUpdateEvent {
  harnessId: HarnessId
  remoteId: string
  result: HarnessTurnResult
}
