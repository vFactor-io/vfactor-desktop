import type {
  AppUpdateDownloadEvent,
  AppUpdateInfo,
  CopyPathsIntoDirectoryOptions,
  DesktopDirEntry,
  GitBranchesResponse,
  ProjectFileSystemEvent,
  SkillsSyncResponse,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalStartResponse,
  WriteTextFileOptions,
} from "./contracts"

declare global {
  interface Window {
    nucleus: {
      app: {
        getVersion: () => Promise<string>
        checkForUpdates: () => Promise<AppUpdateInfo | null>
        installUpdate: () => Promise<void>
        onUpdateEvent: (listener: (event: AppUpdateDownloadEvent) => void) => () => void
      }
      dialog: {
        openProjectFolder: () => Promise<string | null>
      }
      fs: {
        readTextFile: (path: string) => Promise<string>
        writeTextFile: (
          path: string,
          content: string,
          options?: WriteTextFileOptions
        ) => Promise<void>
        exists: (path: string) => Promise<boolean>
        readDir: (path: string) => Promise<DesktopDirEntry[]>
        mkdir: (path: string, options?: { recursive?: boolean }) => Promise<void>
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
      codex: {
        ensureServer: () => Promise<string>
        send: (message: string) => Promise<void>
        onMessage: (listener: (message: string) => void) => () => void
        onStatus: (listener: (status: string) => void) => () => void
      }
      terminal: {
        createSession: (
          sessionId: string,
          cwd: string,
          cols: number,
          rows: number
        ) => Promise<TerminalStartResponse>
        write: (sessionId: string, data: string) => Promise<void>
        resize: (sessionId: string, cols: number, rows: number) => Promise<void>
        closeSession: (sessionId: string) => Promise<void>
        onData: (listener: (event: TerminalDataEvent) => void) => () => void
        onExit: (listener: (event: TerminalExitEvent) => void) => () => void
      }
      git: {
        getBranches: (projectPath: string) => Promise<GitBranchesResponse>
        checkoutBranch: (
          projectPath: string,
          branchName: string
        ) => Promise<GitBranchesResponse>
        createAndCheckoutBranch: (
          projectPath: string,
          branchName: string
        ) => Promise<GitBranchesResponse>
      }
      skills: {
        list: () => Promise<SkillsSyncResponse>
      }
    }
  }
}

export {}
