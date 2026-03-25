import { contextBridge, ipcRenderer, webUtils } from "electron"
import { EVENT_CHANNELS, IPC_CHANNELS } from "./ipc/channels"
import type {
  AppUpdateDownloadEvent,
  CopyPathsIntoDirectoryOptions,
  DesktopDirEntry,
  GitBranchesResponse,
  ProjectFileSystemEvent,
  SkillsSyncResponse,
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

contextBridge.exposeInMainWorld("nucleus", {
  app: {
    getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.appGetVersion) as Promise<string>,
    checkForUpdates: () =>
      ipcRenderer.invoke(IPC_CHANNELS.appCheckForUpdates) as Promise<unknown>,
    installUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.appInstallUpdate) as Promise<void>,
    onUpdateEvent: (listener: (event: AppUpdateDownloadEvent) => void) =>
      subscribe(EVENT_CHANNELS.appUpdate, listener),
  },
  dialog: {
    openProjectFolder: () =>
      ipcRenderer.invoke(IPC_CHANNELS.dialogOpenProjectFolder) as Promise<string | null>,
  },
  fs: {
    readTextFile: (path: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.fsReadTextFile, path) as Promise<string>,
    writeTextFile: (path: string, content: string, options?: WriteTextFileOptions) =>
      ipcRenderer.invoke(IPC_CHANNELS.fsWriteTextFile, path, content, options) as Promise<void>,
    exists: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.fsExists, path) as Promise<boolean>,
    readDir: (path: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.fsReadDir, path) as Promise<DesktopDirEntry[]>,
    mkdir: (path: string, options?: { recursive?: boolean }) =>
      ipcRenderer.invoke(IPC_CHANNELS.fsMkdir, path, options) as Promise<void>,
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
  codex: {
    ensureServer: () => ipcRenderer.invoke(IPC_CHANNELS.codexEnsureServer) as Promise<string>,
    send: (message: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.codexSend, message) as Promise<void>,
    onMessage: (listener: (message: string) => void) =>
      subscribe(EVENT_CHANNELS.codexMessage, listener),
    onStatus: (listener: (status: string) => void) =>
      subscribe(EVENT_CHANNELS.codexStatus, listener),
  },
  terminal: {
    createSession: (sessionId: string, cwd: string, cols: number, rows: number) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.terminalCreateSession,
        sessionId,
        cwd,
        cols,
        rows
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
  },
  skills: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.skillsList) as Promise<SkillsSyncResponse>,
  },
})
