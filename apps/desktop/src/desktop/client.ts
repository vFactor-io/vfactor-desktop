import type {
  AppUpdateActionResult,
  AppUpdateCheckResult,
  AppUpdateState,
  AppWindowThemeSyncInput,
  CopyPathsIntoDirectoryOptions,
  DesktopDirEntry,
  GitActionProgressEvent,
  GitBranchesResponse,
  GitCreateWorktreeInput,
  GitCreateWorktreeResult,
  GitFileChange,
  GitFileDiff,
  GitMergePullRequestResult,
  GitPullRequestResolveReason,
  GitPullRequestChecksOptions,
  GitPullRequestChecksResponse,
  GitPullRequestCheck,
  GitPullRequestCommit,
  GitPullRequestComment,
  GitPullRequestCheckStatus,
  GitPullRequestReviewComment,
  GitPullRequestReview,
  GitPullResult,
  GitRenameWorktreeInput,
  GitRenameWorktreeResult,
  GitRemoveWorktreeInput,
  GitRemoveWorktreeResult,
  GitRunStackedActionInput,
  GitRunStackedActionResult,
  GitWorktreeSummary,
  ProjectFileSystemEvent,
  ReadFileAsDataUrlOptions,
  RemovePathOptions,
  RuntimeAgentsResult,
  RuntimeAnswerPromptInput,
  RuntimeCommandsResult,
  RuntimeCreateSessionInput,
  RuntimeInterruptTurnInput,
  RuntimeListAgentsInput,
  RuntimeListCommandsInput,
  RuntimeListModelsInput,
  RuntimeSearchFilesInput,
  RuntimeModelsResult,
  RuntimeRefreshProviderStatusInput,
  RuntimeSendTurnInput,
  RuntimeSessionResult,
  RuntimeTurnUpdateEvent,
  SkillsSyncResponse,
  TerminalCreateSessionEnvironment,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalStartResponse,
  WriteTextFileOptions,
} from "./contracts"

export interface DesktopStoreHandle {
  get<T>(key: string): Promise<T | null>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  save(): Promise<void>
}

class RendererStoreHandle implements DesktopStoreHandle {
  constructor(private readonly file: string) {}

  get<T>(key: string): Promise<T | null> {
    return window.vfactor.store.get<T>(this.file, key)
  }

  set(key: string, value: unknown): Promise<void> {
    return window.vfactor.store.set(this.file, key, value)
  }

  delete(key: string): Promise<void> {
    return window.vfactor.store.delete(this.file, key)
  }

  save(): Promise<void> {
    return window.vfactor.store.save(this.file)
  }
}

export function loadDesktopStore(file: string): Promise<DesktopStoreHandle> {
  return Promise.resolve(new RendererStoreHandle(file))
}

function normalizePullRequestChecksResponse(
  projectPath: string,
  value: GitPullRequestChecksResponse
): GitPullRequestChecksResponse {
  const response = (value ?? {}) as Partial<GitPullRequestChecksResponse>
  const checks = Array.isArray(response.checks) ? response.checks : []
  const hasCommitsArray = Array.isArray(response.commits)
  const hasReviewsArray = Array.isArray(response.reviews)
  const hasCommentsArray = Array.isArray(response.comments)
  const hasReviewCommentsArray = Array.isArray(response.reviewComments)
  const commits = hasCommitsArray ? response.commits : []
  const reviews = hasReviewsArray ? response.reviews : []
  const comments = hasCommentsArray ? response.comments : []
  const reviewComments = hasReviewCommentsArray ? response.reviewComments : []
  const pullRequestNumber =
    typeof response.pullRequestNumber === "number" ? response.pullRequestNumber : null
  const error = response.error ?? null
  const activityError = response.activityError ?? null

  if (!hasCommitsArray || !hasReviewsArray || !hasCommentsArray || !hasReviewCommentsArray) {
    const legacyBridgeMessage =
      "The desktop bridge is still using the older pull request checks payload. Restart the desktop dev process to load commits, reviews, and comments."

    return {
      checks,
      commits,
      reviews,
      comments,
      reviewComments,
      pullRequestNumber,
      error: error ? `${error} ${legacyBridgeMessage}` : legacyBridgeMessage,
      activityIncluded: false,
      activityError,
    }
  }

  return {
    checks,
    commits,
    reviews,
    comments,
    reviewComments,
    pullRequestNumber,
    error,
    activityIncluded: response.activityIncluded !== false,
    activityError,
  }
}

export const desktop = {
  app: {
    getVersion: () => window.vfactor.app.getVersion(),
    getUpdateState: () => window.vfactor.app.getUpdateState(),
    checkForUpdates: () => window.vfactor.app.checkForUpdates(),
    installUpdate: (options?: { force?: boolean }) => window.vfactor.app.installUpdate(options),
    dismissUpdate: () => window.vfactor.app.dismissUpdate(),
    syncWindowTheme: (input: AppWindowThemeSyncInput) => {
      const syncWindowTheme = window.vfactor.app.syncWindowTheme
      if (typeof syncWindowTheme !== "function") {
        console.warn("[desktop.app] syncWindowTheme is unavailable in the current preload bridge")
        return Promise.resolve()
      }

      return syncWindowTheme(input)
    },
    onUpdateState: (listener: (state: AppUpdateState) => void) =>
      window.vfactor.app.onUpdateState(listener),
  },
  dialog: {
    openProjectFolder: () => window.vfactor.dialog.openProjectFolder(),
  },
  fs: {
    readTextFile: (path: string) => window.vfactor.fs.readTextFile(path),
    readFileAsDataUrl: (path: string, options?: ReadFileAsDataUrlOptions) =>
      window.vfactor.fs.readFileAsDataUrl(path, options),
    writeTextFile: (path: string, content: string, options?: WriteTextFileOptions) =>
      window.vfactor.fs.writeTextFile(path, content, options),
    writeDataUrlFile: (path: string, dataUrl: string) => {
      const writeDataUrlFile = window.vfactor.fs.writeDataUrlFile
      if (typeof writeDataUrlFile !== "function") {
        return Promise.reject(
          new Error("Uploads require restarting vFactor to reload the desktop bridge.")
        )
      }

      return writeDataUrlFile(path, dataUrl)
    },
    exists: (path: string) => window.vfactor.fs.exists(path),
    readDir: (path: string) => window.vfactor.fs.readDir(path),
    mkdir: (path: string, options?: { recursive?: boolean }) =>
      window.vfactor.fs.mkdir(path, options),
    removePath: (path: string, options?: RemovePathOptions) => {
      const removePath = window.vfactor.fs.removePath
      if (typeof removePath !== "function") {
        console.warn("[desktop.fs] removePath is unavailable in the current preload bridge")
        return Promise.resolve()
      }

      return removePath(path, options)
    },
    homeDir: () => window.vfactor.fs.homeDir(),
    getPathForFile: (file: File) => window.vfactor.fs.getPathForFile(file),
    copyPathsIntoDirectory: (
      sourcePaths: string[],
      targetDirectory: string,
      options?: CopyPathsIntoDirectoryOptions
    ) => window.vfactor.fs.copyPathsIntoDirectory(sourcePaths, targetDirectory, options),
  },
  store: {
    load: loadDesktopStore,
  },
  watcher: {
    start: (projectPath: string) => window.vfactor.watcher.start(projectPath),
    stop: () => window.vfactor.watcher.stop(),
    onEvent: (listener: (event: ProjectFileSystemEvent) => void) =>
      window.vfactor.watcher.onEvent(listener),
  },
  runtime: {
    createSession: (input: RuntimeCreateSessionInput) => window.vfactor.runtime.createSession(input),
    listModels: (input: RuntimeListModelsInput) => window.vfactor.runtime.listModels(input),
    listProviderStatuses: () => window.vfactor.runtime.listProviderStatuses(),
    refreshProviderStatus: (input: RuntimeRefreshProviderStatusInput) =>
      window.vfactor.runtime.refreshProviderStatus(input),
    listAgents: (input: RuntimeListAgentsInput) => window.vfactor.runtime.listAgents(input),
    listCommands: (input: RuntimeListCommandsInput) => window.vfactor.runtime.listCommands(input),
    searchFiles: (input: RuntimeSearchFilesInput) => window.vfactor.runtime.searchFiles(input),
    sendTurn: (input: RuntimeSendTurnInput) => window.vfactor.runtime.sendTurn(input),
    answerPrompt: (input: RuntimeAnswerPromptInput) => window.vfactor.runtime.answerPrompt(input),
    interruptTurn: (input: RuntimeInterruptTurnInput) =>
      window.vfactor.runtime.interruptTurn(input),
    onEvent: (listener: (event: RuntimeTurnUpdateEvent) => void) =>
      window.vfactor.runtime.onEvent(listener),
  },
  shell: {
    openExternal: (url: string) => window.vfactor.shell.openExternal(url),
  },
  terminal: {
    createSession: (
      sessionId: string,
      cwd: string,
      cols: number,
      rows: number,
      initialCommand?: string,
      environment?: TerminalCreateSessionEnvironment
    ) => window.vfactor.terminal.createSession(sessionId, cwd, cols, rows, initialCommand, environment),
    write: (sessionId: string, data: string) => window.vfactor.terminal.write(sessionId, data),
    resize: (sessionId: string, cols: number, rows: number) =>
      window.vfactor.terminal.resize(sessionId, cols, rows),
    closeSession: (sessionId: string) => window.vfactor.terminal.closeSession(sessionId),
    onData: (listener: (event: TerminalDataEvent) => void) =>
      window.vfactor.terminal.onData(listener),
    onExit: (listener: (event: TerminalExitEvent) => void) =>
      window.vfactor.terminal.onExit(listener),
  },
  git: {
    getBranches: (projectPath: string) => window.vfactor.git.getBranches(projectPath),
    getChanges: (projectPath: string) => window.vfactor.git.getChanges(projectPath),
    getPullRequestChecks: (projectPath: string, options?: GitPullRequestChecksOptions) => {
      const getPullRequestChecks = window.vfactor.git.getPullRequestChecks
      if (typeof getPullRequestChecks !== "function") {
        console.warn("[desktop.git] getPullRequestChecks is unavailable in the current preload bridge")
        return Promise.resolve({
          checks: [],
          reviews: [],
          comments: [],
          reviewComments: [],
          pullRequestNumber: null,
          error: "Pull request checks are unavailable in the current desktop bridge.",
          activityIncluded: false,
          activityError: null,
        })
      }

      return getPullRequestChecks(projectPath, options).then((result) =>
        normalizePullRequestChecksResponse(projectPath, result)
      )
    },
    listWorktrees: (projectPath: string) => window.vfactor.git.listWorktrees(projectPath),
    initRepo: (projectPath: string) => window.vfactor.git.initRepo(projectPath),
    createWorktree: (projectPath: string, input: GitCreateWorktreeInput) =>
      window.vfactor.git.createWorktree(projectPath, input),
    removeWorktree: (projectPath: string, input: GitRemoveWorktreeInput) =>
      window.vfactor.git.removeWorktree(projectPath, input),
    renameWorktree: (projectPath: string, input: GitRenameWorktreeInput) =>
      window.vfactor.git.renameWorktree(projectPath, input),
    getFileDiff: (projectPath: string, filePath: string, previousPath?: string | null) =>
      window.vfactor.git.getFileDiff(projectPath, filePath, previousPath),
    checkoutBranch: (projectPath: string, branchName: string) =>
      window.vfactor.git.checkoutBranch(projectPath, branchName),
    createAndCheckoutBranch: (projectPath: string, branchName: string) =>
      window.vfactor.git.createAndCheckoutBranch(projectPath, branchName),
    pull: (projectPath: string) => window.vfactor.git.pull(projectPath),
    mergePullRequest: (projectPath: string) => window.vfactor.git.mergePullRequest(projectPath),
    ensureInfoExcludeEntries: (projectPath: string, entries: string[]) => {
      const ensureInfoExcludeEntries = window.vfactor.git.ensureInfoExcludeEntries
      if (typeof ensureInfoExcludeEntries !== "function") {
        console.warn(
          "[desktop.git] ensureInfoExcludeEntries is unavailable in the current preload bridge"
        )
        return Promise.resolve()
      }

      return ensureInfoExcludeEntries(projectPath, entries)
    },
    runStackedAction: (projectPath: string, input: GitRunStackedActionInput) =>
      window.vfactor.git.runStackedAction(projectPath, input),
    onActionProgress: (listener: (event: GitActionProgressEvent) => void) =>
      window.vfactor.git.onActionProgress(listener),
  },
  skills: {
    list: () => window.vfactor.skills.list(),
  },
}

export type {
  AppUpdateActionResult,
  AppUpdateCheckResult,
  AppUpdateState,
  DesktopDirEntry,
  GitActionProgressEvent,
  GitBranchesResponse,
  GitCreateWorktreeInput,
  GitCreateWorktreeResult,
  GitFileChange,
  GitFileDiff,
  GitMergePullRequestResult,
  GitPullRequestResolveReason,
  GitPullRequestChecksOptions,
  GitPullRequestChecksResponse,
  GitPullRequestCheck,
  GitPullRequestCommit,
  GitPullRequestComment,
  GitPullRequestCheckStatus,
  GitPullRequestReview,
  GitPullRequestReviewComment,
  GitPullResult,
  GitRenameWorktreeInput,
  GitRenameWorktreeResult,
  GitRemoveWorktreeInput,
  GitRemoveWorktreeResult,
  GitRunStackedActionInput,
  GitRunStackedActionResult,
  GitWorktreeSummary,
  ProjectFileSystemEvent,
  RuntimeAgentsResult,
  RuntimeCommandsResult,
  RuntimeModelsResult,
  RuntimeSessionResult,
  RuntimeTurnUpdateEvent,
  SkillsSyncResponse,
  TerminalCreateSessionEnvironment,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalStartResponse,
}
