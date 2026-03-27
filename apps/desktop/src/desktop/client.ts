import type {
  AppUpdateDownloadEvent,
  AppUpdateInfo,
  CopyPathsIntoDirectoryOptions,
  DesktopDirEntry,
  GitBranchesResponse,
  GitFileChange,
  GitFileDiff,
  ProjectFileSystemEvent,
  SkillsSyncResponse,
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

export const desktop = {
  app: {
    getVersion: () => window.nucleus.app.getVersion(),
    checkForUpdates: () => window.nucleus.app.checkForUpdates(),
    installUpdate: () => window.nucleus.app.installUpdate(),
    onUpdateEvent: (listener: (event: AppUpdateDownloadEvent) => void) =>
      window.nucleus.app.onUpdateEvent(listener),
  },
  dialog: {
    openProjectFolder: () => window.nucleus.dialog.openProjectFolder(),
  },
  fs: {
    readTextFile: (path: string) => window.nucleus.fs.readTextFile(path),
    writeTextFile: (path: string, content: string, options?: WriteTextFileOptions) =>
      window.nucleus.fs.writeTextFile(path, content, options),
    exists: (path: string) => window.nucleus.fs.exists(path),
    readDir: (path: string) => window.nucleus.fs.readDir(path),
    mkdir: (path: string, options?: { recursive?: boolean }) =>
      window.nucleus.fs.mkdir(path, options),
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
  codex: {
    ensureServer: () => window.nucleus.codex.ensureServer(),
    send: (message: string) => window.nucleus.codex.send(message),
    onMessage: (listener: (message: string) => void) => window.nucleus.codex.onMessage(listener),
    onStatus: (listener: (status: string) => void) => window.nucleus.codex.onStatus(listener),
  },
  terminal: {
    createSession: (sessionId: string, cwd: string, cols: number, rows: number) =>
      window.nucleus.terminal.createSession(sessionId, cwd, cols, rows),
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
    getFileDiff: (projectPath: string, filePath: string, previousPath?: string | null) =>
      window.nucleus.git.getFileDiff(projectPath, filePath, previousPath),
    checkoutBranch: (projectPath: string, branchName: string) =>
      window.nucleus.git.checkoutBranch(projectPath, branchName),
    createAndCheckoutBranch: (projectPath: string, branchName: string) =>
      window.nucleus.git.createAndCheckoutBranch(projectPath, branchName),
  },
  skills: {
    list: () => window.nucleus.skills.list(),
  },
}

export type {
  AppUpdateDownloadEvent,
  AppUpdateInfo,
  DesktopDirEntry,
  GitBranchesResponse,
  GitFileChange,
  GitFileDiff,
  ProjectFileSystemEvent,
  SkillsSyncResponse,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalStartResponse,
}
