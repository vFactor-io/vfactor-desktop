import { contextBridge, ipcRenderer, webUtils } from "electron"
import { EVENT_CHANNELS, IPC_CHANNELS } from "./ipc/channels"
import type {
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
  GitPullRequestChecksOptions,
  GitPullRequestChecksResponse,
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
  RuntimeProviderStatusesResult,
  RuntimeRefreshProviderStatusInput,
  RuntimeSearchFilesInput,
  RuntimeModelsResult,
  RuntimeFileSearchResultSet,
  RuntimeSendTurnInput,
  RuntimeSessionResult,
  RuntimeTurnUpdateEvent,
  SkillsSyncResponse,
  TerminalCreateSessionEnvironment,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalStartResponse,
  WriteTextFileOptions,
} from "../src/desktop/contracts"

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => {
    listener(payload)
  }

  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

contextBridge.exposeInMainWorld("vfactor", {
  app: {
    getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.appGetVersion) as Promise<string>,
    getUpdateState: () => ipcRenderer.invoke(IPC_CHANNELS.appGetUpdateState) as Promise<unknown>,
    checkForUpdates: () =>
      ipcRenderer.invoke(IPC_CHANNELS.appCheckForUpdates) as Promise<unknown>,
    installUpdate: (options?: { force?: boolean }) =>
      ipcRenderer.invoke(IPC_CHANNELS.appInstallUpdate, options) as Promise<unknown>,
    dismissUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.appDismissUpdate) as Promise<unknown>,
    syncWindowTheme: (input: AppWindowThemeSyncInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.appSyncWindowTheme, input) as Promise<void>,
    onUpdateState: (listener: (state: AppUpdateState) => void) =>
      subscribe(EVENT_CHANNELS.appUpdateState, listener),
  },
  dialog: {
    openProjectFolder: () =>
      ipcRenderer.invoke(IPC_CHANNELS.dialogOpenProjectFolder) as Promise<string | null>,
  },
  fs: {
    readTextFile: (path: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.fsReadTextFile, path) as Promise<string>,
    readFileAsDataUrl: (path: string, options?: ReadFileAsDataUrlOptions) =>
      ipcRenderer.invoke(IPC_CHANNELS.fsReadFileAsDataUrl, path, options) as Promise<string>,
    writeTextFile: (path: string, content: string, options?: WriteTextFileOptions) =>
      ipcRenderer.invoke(IPC_CHANNELS.fsWriteTextFile, path, content, options) as Promise<void>,
    writeDataUrlFile: (path: string, dataUrl: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.fsWriteDataUrlFile, path, dataUrl) as Promise<void>,
    exists: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.fsExists, path) as Promise<boolean>,
    readDir: (path: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.fsReadDir, path) as Promise<DesktopDirEntry[]>,
    mkdir: (path: string, options?: { recursive?: boolean }) =>
      ipcRenderer.invoke(IPC_CHANNELS.fsMkdir, path, options) as Promise<void>,
    removePath: (path: string, options?: RemovePathOptions) =>
      ipcRenderer.invoke(IPC_CHANNELS.fsRemovePath, path, options) as Promise<void>,
    homeDir: () => ipcRenderer.invoke(IPC_CHANNELS.fsHomeDir) as Promise<string>,
    getPathForFile: (file: File) => {
      try {
        return webUtils.getPathForFile(file) || null
      } catch {
        return null
      }
    },
    copyPathsIntoDirectory: (
      sourcePaths: string[],
      targetDirectory: string,
      options?: CopyPathsIntoDirectoryOptions
    ) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.fsCopyPathsIntoDirectory,
        sourcePaths,
        targetDirectory,
        options
      ) as Promise<void>,
  },
  store: {
    get: <T>(file: string, key: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.storeGet, file, key) as Promise<T | null>,
    set: (file: string, key: string, value: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.storeSet, file, key, value) as Promise<void>,
    delete: (file: string, key: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.storeDelete, file, key) as Promise<void>,
    save: (file: string) => ipcRenderer.invoke(IPC_CHANNELS.storeSave, file) as Promise<void>,
  },
  watcher: {
    start: (projectPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.watcherStart, projectPath) as Promise<void>,
    stop: () => ipcRenderer.invoke(IPC_CHANNELS.watcherStop) as Promise<void>,
    onEvent: (listener: (event: ProjectFileSystemEvent) => void) =>
      subscribe(EVENT_CHANNELS.projectFs, listener),
  },
  runtime: {
    createSession: (input: RuntimeCreateSessionInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.runtimeCreateSession, input) as Promise<RuntimeSessionResult>,
    listModels: (input: RuntimeListModelsInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.runtimeListModels, input) as Promise<RuntimeModelsResult>,
    listProviderStatuses: () =>
      ipcRenderer.invoke(
        IPC_CHANNELS.runtimeListProviderStatuses
      ) as Promise<RuntimeProviderStatusesResult>,
    refreshProviderStatus: (input: RuntimeRefreshProviderStatusInput) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.runtimeRefreshProviderStatus,
        input
      ) as Promise<RuntimeProviderStatusesResult>,
    listAgents: (input: RuntimeListAgentsInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.runtimeListAgents, input) as Promise<RuntimeAgentsResult>,
    listCommands: (input: RuntimeListCommandsInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.runtimeListCommands, input) as Promise<RuntimeCommandsResult>,
    searchFiles: (input: RuntimeSearchFilesInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.runtimeSearchFiles, input) as Promise<RuntimeFileSearchResultSet>,
    sendTurn: (input: RuntimeSendTurnInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.runtimeSendTurn, input) as Promise<unknown>,
    answerPrompt: (input: RuntimeAnswerPromptInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.runtimeAnswerPrompt, input) as Promise<unknown>,
    interruptTurn: (input: RuntimeInterruptTurnInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.runtimeInterruptTurn, input) as Promise<void>,
    onEvent: (listener: (event: RuntimeTurnUpdateEvent) => void) =>
      subscribe(EVENT_CHANNELS.runtimeEvent, listener),
  },
  shell: {
    openExternal: (url: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.shellOpenExternal, url) as Promise<void>,
  },
  terminal: {
    createSession: (
      sessionId: string,
      cwd: string,
      cols: number,
      rows: number,
      initialCommand?: string,
      environment?: TerminalCreateSessionEnvironment
    ) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.terminalCreateSession,
        sessionId,
        cwd,
        cols,
        rows,
        initialCommand,
        environment
      ) as Promise<TerminalStartResponse>,
    write: (sessionId: string, data: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.terminalWrite, sessionId, data) as Promise<void>,
    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.terminalResize, sessionId, cols, rows) as Promise<void>,
    closeSession: (sessionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.terminalCloseSession, sessionId) as Promise<void>,
    onData: (listener: (event: TerminalDataEvent) => void) =>
      subscribe(EVENT_CHANNELS.terminalData, listener),
    onExit: (listener: (event: TerminalExitEvent) => void) =>
      subscribe(EVENT_CHANNELS.terminalExit, listener),
  },
  git: {
    getBranches: (projectPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.gitGetBranches, projectPath) as Promise<GitBranchesResponse>,
    getChanges: (projectPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.gitGetChanges, projectPath) as Promise<GitFileChange[]>,
    getPullRequestChecks: (projectPath: string, options?: GitPullRequestChecksOptions) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.gitGetPullRequestChecks,
        projectPath,
        options
      ) as Promise<GitPullRequestChecksResponse>,
    listWorktrees: (projectPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.gitListWorktrees, projectPath) as Promise<GitWorktreeSummary[]>,
    initRepo: (projectPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.gitInitRepo, projectPath) as Promise<GitBranchesResponse>,
    createWorktree: (projectPath: string, input: GitCreateWorktreeInput) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.gitCreateWorktree,
        projectPath,
        input
      ) as Promise<GitCreateWorktreeResult>,
    removeWorktree: (projectPath: string, input: GitRemoveWorktreeInput) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.gitRemoveWorktree,
        projectPath,
        input
      ) as Promise<GitRemoveWorktreeResult>,
    renameWorktree: (projectPath: string, input: GitRenameWorktreeInput) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.gitRenameWorktree,
        projectPath,
        input
      ) as Promise<GitRenameWorktreeResult>,
    getFileDiff: (projectPath: string, filePath: string, previousPath?: string | null) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.gitGetFileDiff,
        projectPath,
        filePath,
        previousPath ?? null
      ) as Promise<GitFileDiff>,
    checkoutBranch: (projectPath: string, branchName: string) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.gitCheckoutBranch,
        projectPath,
        branchName
      ) as Promise<GitBranchesResponse>,
    createAndCheckoutBranch: (projectPath: string, branchName: string) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.gitCreateAndCheckoutBranch,
        projectPath,
        branchName
      ) as Promise<GitBranchesResponse>,
    pull: (projectPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.gitPull, projectPath) as Promise<GitPullResult>,
    mergePullRequest: (projectPath: string) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.gitMergePullRequest,
        projectPath
      ) as Promise<GitMergePullRequestResult>,
    ensureInfoExcludeEntries: (projectPath: string, entries: string[]) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.gitEnsureInfoExcludeEntries,
        projectPath,
        entries
      ) as Promise<void>,
    runStackedAction: (projectPath: string, input: GitRunStackedActionInput) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.gitRunStackedAction,
        projectPath,
        input
      ) as Promise<GitRunStackedActionResult>,
    onActionProgress: (listener: (event: GitActionProgressEvent) => void) =>
      subscribe(EVENT_CHANNELS.gitActionProgress, listener),
  },
  skills: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.skillsList) as Promise<SkillsSyncResponse>,
  },
})
