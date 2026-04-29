import type * as React from "react"
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
} from "./contracts"

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        partition?: string
        src?: string
      }
    }
  }

  interface Window {
    vfactor: {
      app: {
        getVersion: () => Promise<string>
        getUpdateState: () => Promise<AppUpdateState>
        checkForUpdates: () => Promise<AppUpdateCheckResult>
        installUpdate: (options?: { force?: boolean }) => Promise<AppUpdateActionResult>
        dismissUpdate: () => Promise<AppUpdateState>
        syncWindowTheme: (input: AppWindowThemeSyncInput) => Promise<void>
        onUpdateState: (listener: (state: AppUpdateState) => void) => () => void
      }
      dialog: {
        openProjectFolder: () => Promise<string | null>
      }
      fs: {
        readTextFile: (path: string) => Promise<string>
        readFileAsDataUrl: (
          path: string,
          options?: ReadFileAsDataUrlOptions
        ) => Promise<string>
        writeTextFile: (
          path: string,
          content: string,
          options?: WriteTextFileOptions
        ) => Promise<void>
        writeDataUrlFile: (path: string, dataUrl: string) => Promise<void>
        exists: (path: string) => Promise<boolean>
        readDir: (path: string) => Promise<DesktopDirEntry[]>
        mkdir: (path: string, options?: { recursive?: boolean }) => Promise<void>
        removePath: (path: string, options?: RemovePathOptions) => Promise<void>
        homeDir: () => Promise<string>
        getPathForFile: (file: File) => string | null
        copyPathsIntoDirectory: (
          sourcePaths: string[],
          targetDirectory: string,
          options?: CopyPathsIntoDirectoryOptions
        ) => Promise<void>
      }
      store: {
        get: <T>(file: string, key: string) => Promise<T | null>
        set: (file: string, key: string, value: unknown) => Promise<void>
        delete: (file: string, key: string) => Promise<void>
        save: (file: string) => Promise<void>
      }
      watcher: {
        start: (projectPath: string) => Promise<void>
        stop: () => Promise<void>
        onEvent: (listener: (event: ProjectFileSystemEvent) => void) => () => void
      }
      runtime: {
        createSession: (input: RuntimeCreateSessionInput) => Promise<RuntimeSessionResult>
        listModels: (input: RuntimeListModelsInput) => Promise<RuntimeModelsResult>
        listProviderStatuses: () => Promise<RuntimeProviderStatusesResult>
        refreshProviderStatus: (
          input: RuntimeRefreshProviderStatusInput
        ) => Promise<RuntimeProviderStatusesResult>
        listAgents: (input: RuntimeListAgentsInput) => Promise<RuntimeAgentsResult>
        listCommands: (input: RuntimeListCommandsInput) => Promise<RuntimeCommandsResult>
        searchFiles: (input: RuntimeSearchFilesInput) => Promise<RuntimeFileSearchResultSet>
        sendTurn: (input: RuntimeSendTurnInput) => Promise<unknown>
        answerPrompt: (input: RuntimeAnswerPromptInput) => Promise<unknown>
        interruptTurn: (input: RuntimeInterruptTurnInput) => Promise<void>
        onEvent: (listener: (event: RuntimeTurnUpdateEvent) => void) => () => void
      }
      shell: {
        openExternal: (url: string) => Promise<void>
      }
      terminal: {
        createSession: (
          sessionId: string,
          cwd: string,
          cols: number,
          rows: number,
          initialCommand?: string,
          environment?: TerminalCreateSessionEnvironment
        ) => Promise<TerminalStartResponse>
        write: (sessionId: string, data: string) => Promise<void>
        resize: (sessionId: string, cols: number, rows: number) => Promise<void>
        closeSession: (sessionId: string) => Promise<void>
        onData: (listener: (event: TerminalDataEvent) => void) => () => void
        onExit: (listener: (event: TerminalExitEvent) => void) => () => void
      }
      git: {
        getBranches: (projectPath: string) => Promise<GitBranchesResponse>
        getChanges: (projectPath: string) => Promise<GitFileChange[]>
        getPullRequestChecks: (
          projectPath: string,
          options?: GitPullRequestChecksOptions
        ) => Promise<GitPullRequestChecksResponse>
        listWorktrees: (projectPath: string) => Promise<GitWorktreeSummary[]>
        initRepo: (projectPath: string) => Promise<GitBranchesResponse>
        createWorktree: (
          projectPath: string,
          input: GitCreateWorktreeInput
        ) => Promise<GitCreateWorktreeResult>
        removeWorktree: (
          projectPath: string,
          input: GitRemoveWorktreeInput
        ) => Promise<GitRemoveWorktreeResult>
        renameWorktree: (
          projectPath: string,
          input: GitRenameWorktreeInput
        ) => Promise<GitRenameWorktreeResult>
        getFileDiff: (
          projectPath: string,
          filePath: string,
          previousPath?: string | null
        ) => Promise<GitFileDiff>
        checkoutBranch: (
          projectPath: string,
          branchName: string
        ) => Promise<GitBranchesResponse>
        createAndCheckoutBranch: (
          projectPath: string,
          branchName: string
        ) => Promise<GitBranchesResponse>
        pull: (projectPath: string) => Promise<GitPullResult>
        mergePullRequest: (projectPath: string) => Promise<GitMergePullRequestResult>
        ensureInfoExcludeEntries: (projectPath: string, entries: string[]) => Promise<void>
        runStackedAction: (
          projectPath: string,
          input: GitRunStackedActionInput
        ) => Promise<GitRunStackedActionResult>
        onActionProgress: (listener: (event: GitActionProgressEvent) => void) => () => void
      }
      skills: {
        list: () => Promise<SkillsSyncResponse>
      }
    }
  }
}

export {}
