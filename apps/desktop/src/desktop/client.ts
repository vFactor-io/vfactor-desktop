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
  GitPullRequestChecksResponse,
  GitPullRequestCheck,
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
  RuntimeModelsResult,
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
    return window.nucleus.store.get<T>(this.file, key)
  }

  set(key: string, value: unknown): Promise<void> {
    return window.nucleus.store.set(this.file, key, value)
  }

  delete(key: string): Promise<void> {
    return window.nucleus.store.delete(this.file, key)
  }

  save(): Promise<void> {
    return window.nucleus.store.save(this.file)
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
  const hasReviewsArray = Array.isArray(response.reviews)
  const hasCommentsArray = Array.isArray(response.comments)
  const hasReviewCommentsArray = Array.isArray(response.reviewComments)
  const reviews = hasReviewsArray ? response.reviews : []
  const comments = hasCommentsArray ? response.comments : []
  const reviewComments = hasReviewCommentsArray ? response.reviewComments : []
  const pullRequestNumber =
    typeof response.pullRequestNumber === "number" ? response.pullRequestNumber : null
  const error = response.error ?? null

  if (!hasReviewsArray || !hasCommentsArray || !hasReviewCommentsArray) {
    const legacyBridgeMessage =
      "The desktop bridge is still using the older pull request checks payload. Restart the desktop dev process to load reviews and comments."

    return {
      checks,
      reviews,
      comments,
      reviewComments,
      pullRequestNumber,
      error: error ? `${error} ${legacyBridgeMessage}` : legacyBridgeMessage,
    }
  }

  return {
    checks,
    reviews,
    comments,
    reviewComments,
    pullRequestNumber,
    error,
  }
}

export const desktop = {
  app: {
    getVersion: () => window.nucleus.app.getVersion(),
    getUpdateState: () => window.nucleus.app.getUpdateState(),
    checkForUpdates: () => window.nucleus.app.checkForUpdates(),
    installUpdate: (options?: { force?: boolean }) => window.nucleus.app.installUpdate(options),
    dismissUpdate: () => window.nucleus.app.dismissUpdate(),
    syncWindowTheme: (input: AppWindowThemeSyncInput) => {
      const syncWindowTheme = window.nucleus.app.syncWindowTheme
      if (typeof syncWindowTheme !== "function") {
        console.warn("[desktop.app] syncWindowTheme is unavailable in the current preload bridge")
        return Promise.resolve()
      }

      return syncWindowTheme(input)
    },
    onUpdateState: (listener: (state: AppUpdateState) => void) =>
      window.nucleus.app.onUpdateState(listener),
  },
  dialog: {
    openProjectFolder: () => window.nucleus.dialog.openProjectFolder(),
  },
  fs: {
    readTextFile: (path: string) => window.nucleus.fs.readTextFile(path),
    readFileAsDataUrl: (path: string, options?: ReadFileAsDataUrlOptions) =>
      window.nucleus.fs.readFileAsDataUrl(path, options),
    writeTextFile: (path: string, content: string, options?: WriteTextFileOptions) =>
      window.nucleus.fs.writeTextFile(path, content, options),
    writeDataUrlFile: (path: string, dataUrl: string) => {
      const writeDataUrlFile = window.nucleus.fs.writeDataUrlFile
      if (typeof writeDataUrlFile !== "function") {
        return Promise.reject(
          new Error("Uploads require restarting Nucleus to reload the desktop bridge.")
        )
      }

      return writeDataUrlFile(path, dataUrl)
    },
    exists: (path: string) => window.nucleus.fs.exists(path),
    readDir: (path: string) => window.nucleus.fs.readDir(path),
    mkdir: (path: string, options?: { recursive?: boolean }) =>
      window.nucleus.fs.mkdir(path, options),
    removePath: (path: string, options?: RemovePathOptions) => {
      const removePath = window.nucleus.fs.removePath
      if (typeof removePath !== "function") {
        console.warn("[desktop.fs] removePath is unavailable in the current preload bridge")
        return Promise.resolve()
      }

      return removePath(path, options)
    },
    homeDir: () => window.nucleus.fs.homeDir(),
    getPathForFile: (file: File) => window.nucleus.fs.getPathForFile(file),
    copyPathsIntoDirectory: (
      sourcePaths: string[],
      targetDirectory: string,
      options?: CopyPathsIntoDirectoryOptions
    ) => window.nucleus.fs.copyPathsIntoDirectory(sourcePaths, targetDirectory, options),
  },
  store: {
    load: loadDesktopStore,
  },
  watcher: {
    start: (projectPath: string) => window.nucleus.watcher.start(projectPath),
    stop: () => window.nucleus.watcher.stop(),
    onEvent: (listener: (event: ProjectFileSystemEvent) => void) =>
      window.nucleus.watcher.onEvent(listener),
  },
  runtime: {
    createSession: (input: RuntimeCreateSessionInput) => window.nucleus.runtime.createSession(input),
    listModels: (input: RuntimeListModelsInput) => window.nucleus.runtime.listModels(input),
    listAgents: (input: RuntimeListAgentsInput) => window.nucleus.runtime.listAgents(input),
    listCommands: (input: RuntimeListCommandsInput) => window.nucleus.runtime.listCommands(input),
    sendTurn: (input: RuntimeSendTurnInput) => window.nucleus.runtime.sendTurn(input),
    answerPrompt: (input: RuntimeAnswerPromptInput) => window.nucleus.runtime.answerPrompt(input),
    interruptTurn: (input: RuntimeInterruptTurnInput) =>
      window.nucleus.runtime.interruptTurn(input),
    onEvent: (listener: (event: RuntimeTurnUpdateEvent) => void) =>
      window.nucleus.runtime.onEvent(listener),
  },
  shell: {
    openExternal: (url: string) => window.nucleus.shell.openExternal(url),
  },
  terminal: {
    createSession: (
      sessionId: string,
      cwd: string,
      cols: number,
      rows: number,
      initialCommand?: string,
      environment?: TerminalCreateSessionEnvironment
    ) => window.nucleus.terminal.createSession(sessionId, cwd, cols, rows, initialCommand, environment),
    write: (sessionId: string, data: string) => window.nucleus.terminal.write(sessionId, data),
    resize: (sessionId: string, cols: number, rows: number) =>
      window.nucleus.terminal.resize(sessionId, cols, rows),
    closeSession: (sessionId: string) => window.nucleus.terminal.closeSession(sessionId),
    onData: (listener: (event: TerminalDataEvent) => void) =>
      window.nucleus.terminal.onData(listener),
    onExit: (listener: (event: TerminalExitEvent) => void) =>
      window.nucleus.terminal.onExit(listener),
  },
  git: {
    getBranches: (projectPath: string) => window.nucleus.git.getBranches(projectPath),
    getChanges: (projectPath: string) => window.nucleus.git.getChanges(projectPath),
    getPullRequestChecks: (projectPath: string) => {
      const getPullRequestChecks = window.nucleus.git.getPullRequestChecks
      if (typeof getPullRequestChecks !== "function") {
        console.warn("[desktop.git] getPullRequestChecks is unavailable in the current preload bridge")
        return Promise.resolve({
          checks: [],
          reviews: [],
          comments: [],
          reviewComments: [],
          pullRequestNumber: null,
          error: "Pull request checks are unavailable in the current desktop bridge.",
        })
      }

      return getPullRequestChecks(projectPath).then((result) =>
        normalizePullRequestChecksResponse(projectPath, result)
      )
    },
    listWorktrees: (projectPath: string) => window.nucleus.git.listWorktrees(projectPath),
    initRepo: (projectPath: string) => window.nucleus.git.initRepo(projectPath),
    createWorktree: (projectPath: string, input: GitCreateWorktreeInput) =>
      window.nucleus.git.createWorktree(projectPath, input),
    removeWorktree: (projectPath: string, input: GitRemoveWorktreeInput) =>
      window.nucleus.git.removeWorktree(projectPath, input),
    renameWorktree: (projectPath: string, input: GitRenameWorktreeInput) =>
      window.nucleus.git.renameWorktree(projectPath, input),
    getFileDiff: (projectPath: string, filePath: string, previousPath?: string | null) =>
      window.nucleus.git.getFileDiff(projectPath, filePath, previousPath),
    checkoutBranch: (projectPath: string, branchName: string) =>
      window.nucleus.git.checkoutBranch(projectPath, branchName),
    createAndCheckoutBranch: (projectPath: string, branchName: string) =>
      window.nucleus.git.createAndCheckoutBranch(projectPath, branchName),
    pull: (projectPath: string) => window.nucleus.git.pull(projectPath),
    mergePullRequest: (projectPath: string) => window.nucleus.git.mergePullRequest(projectPath),
    ensureInfoExcludeEntries: (projectPath: string, entries: string[]) => {
      const ensureInfoExcludeEntries = window.nucleus.git.ensureInfoExcludeEntries
      if (typeof ensureInfoExcludeEntries !== "function") {
        console.warn(
          "[desktop.git] ensureInfoExcludeEntries is unavailable in the current preload bridge"
        )
        return Promise.resolve()
      }

      return ensureInfoExcludeEntries(projectPath, entries)
    },
    runStackedAction: (projectPath: string, input: GitRunStackedActionInput) =>
      window.nucleus.git.runStackedAction(projectPath, input),
    onActionProgress: (listener: (event: GitActionProgressEvent) => void) =>
      window.nucleus.git.onActionProgress(listener),
  },
  skills: {
    list: () => window.nucleus.skills.list(),
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
  GitPullRequestChecksResponse,
  GitPullRequestCheck,
  GitPullRequestComment,
  GitPullRequestCheckStatus,
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
