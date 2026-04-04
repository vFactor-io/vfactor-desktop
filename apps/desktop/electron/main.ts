import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { app, BrowserWindow, ipcMain, nativeImage, shell } from "electron"
import { basename, dirname, join } from "node:path"
import { EVENT_CHANNELS, IPC_CHANNELS } from "./ipc/channels"
import { JsonStoreService } from "./services/store"
import { DesktopFsService } from "./services/fs"
import { DialogService } from "./services/dialog"
import { GitService } from "./services/git"
import { SkillsService } from "./services/skills"
import { CodexServerService } from "./services/codexServer"
import { TerminalService } from "./services/terminal"
import { ProjectWatcherService } from "./services/projectWatcher"
import { UpdaterService } from "./services/updater"
import {
  isAnalyticsConfigured,
  isAnalyticsExplicitlyEnabled,
  initAnalytics,
  capture,
  shutdownAnalytics,
} from "./services/analytics"

let mainWindow: BrowserWindow | null = null
const LEGACY_USER_DATA_DIRS = ["nucleus-desktop", "io.nucleus.desktop"] as const

function getDevAppIconPath(): string {
  return join(process.cwd(), "public", "brands", "nucleus-app-icon-desktop.png")
}

function hasPersistedDesktopData(directoryPath: string): boolean {
  return existsSync(join(directoryPath, "projects.json")) || existsSync(join(directoryPath, "chat.json"))
}

function resolveUserDataPath(): string {
  const currentPath = app.getPath("userData")
  const appDataPath = app.getPath("appData")
  const fallbackPath = join(appDataPath, LEGACY_USER_DATA_DIRS[0])
  const candidatePaths = [
    currentPath,
    ...LEGACY_USER_DATA_DIRS.map((directoryName) => join(appDataPath, directoryName)),
  ]
  const preferredPath = candidatePaths.find((candidatePath) => hasPersistedDesktopData(candidatePath))

  if (preferredPath) {
    return preferredPath
  }

  return basename(currentPath) === "desktop" ? fallbackPath : currentPath
}

const stableUserDataPath = resolveUserDataPath()

if (stableUserDataPath !== app.getPath("userData")) {
  app.setPath("userData", stableUserDataPath)
}

function loadDesktopEnv(): void {
  if (typeof process.loadEnvFile !== "function") {
    return
  }

  const envPaths = [
    join(stableUserDataPath, ".env.local"),
    join(stableUserDataPath, ".env"),
    join(dirname(app.getPath("exe")), ".env.local"),
    join(dirname(app.getPath("exe")), ".env"),
    join(process.resourcesPath, ".env.local"),
    join(process.resourcesPath, ".env"),
    join(app.getAppPath(), ".env.local"),
    join(app.getAppPath(), ".env"),
    join(process.cwd(), ".env.local"),
    join(process.cwd(), ".env"),
  ]
  const seenPaths = new Set<string>()

  for (const envPath of envPaths) {
    if (seenPaths.has(envPath)) {
      continue
    }

    seenPaths.add(envPath)

    if (!existsSync(envPath)) {
      continue
    }

    process.loadEnvFile(envPath)
  }
}

function sendToRenderer(channel: string, payload: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  mainWindow.webContents.send(channel, payload)
}

const fsService = new DesktopFsService()
const dialogService = new DialogService()
const gitService = new GitService()
const skillsService = new SkillsService()
const codexServerService = new CodexServerService(sendToRenderer)
const terminalService = new TerminalService(sendToRenderer)
const projectWatcherService = new ProjectWatcherService(sendToRenderer)
const updaterService = new UpdaterService(sendToRenderer)

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#1e1e1e",
    title: "Nucleus",
    icon: process.platform === "linux" || process.platform === "win32"
      ? getDevAppIconPath()
      : undefined,
    webPreferences: {
      preload: join(__dirname, "../preload/preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    titleBarStyle: process.platform === "darwin" ? "hidden" : undefined,
    trafficLightPosition:
      process.platform === "darwin" ? { x: 16, y: 14 } : undefined,
    titleBarOverlay:
      process.platform !== "darwin"
        ? {
            color: "#1e1e1e",
            symbolColor: "#9ca3af",
            height: 44,
          }
        : false,
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"))
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
      if (!message.includes("[file-tree-drop]")) {
        return
      }

      console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`)
    })

    window.webContents.once("did-finish-load", () => {
      window.webContents.openDevTools({ mode: "detach" })
    })
  }

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null
    }
  })

  return window
}

function registerIpcHandlers(storeService: JsonStoreService): void {
  ipcMain.handle(IPC_CHANNELS.appGetVersion, () => app.getVersion())
  ipcMain.handle(IPC_CHANNELS.appCheckForUpdates, () => updaterService.checkForUpdates())
  ipcMain.handle(IPC_CHANNELS.appInstallUpdate, () => updaterService.installUpdate())

  ipcMain.handle(IPC_CHANNELS.dialogOpenProjectFolder, () => {
    if (!mainWindow) {
      return null
    }
    return dialogService.openProjectFolder(mainWindow)
  })

  ipcMain.handle(IPC_CHANNELS.fsReadTextFile, (_event, path: string) => fsService.readTextFile(path))
  ipcMain.handle(
    IPC_CHANNELS.fsReadFileAsDataUrl,
    (_event, path: string, options?: { mimeType?: string }) =>
      fsService.readFileAsDataUrl(path, options)
  )
  ipcMain.handle(
    IPC_CHANNELS.fsWriteTextFile,
    (_event, path: string, content: string, options?: { create?: boolean }) =>
      fsService.writeTextFile(path, content, options)
  )
  ipcMain.handle(IPC_CHANNELS.fsExists, (_event, path: string) => fsService.exists(path))
  ipcMain.handle(IPC_CHANNELS.fsReadDir, (_event, path: string) => fsService.readDir(path))
  ipcMain.handle(
    IPC_CHANNELS.fsMkdir,
    (_event, path: string, options?: { recursive?: boolean }) => fsService.mkdir(path, options)
  )
  ipcMain.handle(IPC_CHANNELS.fsHomeDir, () => fsService.homeDir())
  ipcMain.handle(
    IPC_CHANNELS.fsCopyPathsIntoDirectory,
    (
      _event,
      sourcePaths: string[],
      targetDirectory: string,
      options?: { overwrite?: boolean }
    ) => fsService.copyPathsIntoDirectory(sourcePaths, targetDirectory, options)
  )

  ipcMain.handle(IPC_CHANNELS.storeGet, (_event, file: string, key: string) =>
    storeService.get(file, key)
  )
  ipcMain.handle(IPC_CHANNELS.storeSet, (_event, file: string, key: string, value: unknown) =>
    storeService.set(file, key, value)
  )
  ipcMain.handle(IPC_CHANNELS.storeDelete, (_event, file: string, key: string) =>
    storeService.delete(file, key)
  )
  ipcMain.handle(IPC_CHANNELS.storeSave, (_event, file: string) => storeService.save(file))

  ipcMain.handle(IPC_CHANNELS.watcherStart, (_event, projectPath: string) =>
    projectWatcherService.start(projectPath)
  )
  ipcMain.handle(IPC_CHANNELS.watcherStop, () => projectWatcherService.stop())

  ipcMain.handle(IPC_CHANNELS.codexEnsureServer, () => codexServerService.ensureServer())
  ipcMain.handle(IPC_CHANNELS.codexSend, (_event, message: string) =>
    codexServerService.send(message)
  )
  ipcMain.handle(IPC_CHANNELS.shellOpenExternal, (_event, url: string) =>
    shell.openExternal(url).then(() => undefined)
  )

  ipcMain.handle(
    IPC_CHANNELS.terminalCreateSession,
    (
      _event,
      sessionId: string,
      cwd: string,
      cols: number,
      rows: number,
      initialCommand?: string,
      environment?: Record<string, string>
    ) => terminalService.createSession(sessionId, cwd, cols, rows, initialCommand, environment)
  )
  ipcMain.handle(IPC_CHANNELS.terminalWrite, (_event, sessionId: string, data: string) =>
    terminalService.write(sessionId, data)
  )
  ipcMain.handle(IPC_CHANNELS.terminalResize, (_event, sessionId: string, cols: number, rows: number) =>
    terminalService.resize(sessionId, cols, rows)
  )
  ipcMain.handle(IPC_CHANNELS.terminalCloseSession, (_event, sessionId: string) =>
    terminalService.closeSession(sessionId)
  )

  ipcMain.handle(IPC_CHANNELS.gitGetBranches, (_event, projectPath: string) =>
    gitService.getBranches(projectPath)
  )
  ipcMain.handle(IPC_CHANNELS.gitGetChanges, (_event, projectPath: string) =>
    gitService.getChanges(projectPath)
  )
  ipcMain.handle(IPC_CHANNELS.gitGetPullRequestChecks, (_event, projectPath: string) =>
    gitService.getPullRequestChecks(projectPath)
  )
  ipcMain.handle(IPC_CHANNELS.gitListWorktrees, (_event, projectPath: string) =>
    gitService.listWorktrees(projectPath)
  )
  ipcMain.handle(
    IPC_CHANNELS.gitCreateWorktree,
    (_event, projectPath: string, input: Parameters<GitService["createWorktree"]>[1]) =>
      gitService.createWorktree(projectPath, input)
  )
  ipcMain.handle(
    IPC_CHANNELS.gitRemoveWorktree,
    (_event, projectPath: string, input: Parameters<GitService["removeWorktree"]>[1]) =>
      gitService.removeWorktree(projectPath, input)
  )
  ipcMain.handle(
    IPC_CHANNELS.gitRenameWorktree,
    (_event, projectPath: string, input: Parameters<GitService["renameWorktree"]>[1]) =>
      gitService.renameWorktree(projectPath, input)
  )
  ipcMain.handle(
    IPC_CHANNELS.gitGetFileDiff,
    (_event, projectPath: string, filePath: string, previousPath?: string | null) =>
      gitService.getFileDiff(projectPath, filePath, previousPath)
  )
  ipcMain.handle(
    IPC_CHANNELS.gitCheckoutBranch,
    (_event, projectPath: string, branchName: string) =>
      gitService.checkoutBranch(projectPath, branchName)
  )
  ipcMain.handle(
    IPC_CHANNELS.gitCreateAndCheckoutBranch,
    (_event, projectPath: string, branchName: string) =>
      gitService.createAndCheckoutBranch(projectPath, branchName)
  )
  ipcMain.handle(IPC_CHANNELS.gitPull, (_event, projectPath: string) =>
    gitService.pull(projectPath)
  )
  ipcMain.handle(IPC_CHANNELS.gitMergePullRequest, (_event, projectPath: string) =>
    gitService.mergePullRequest(projectPath)
  )
  ipcMain.handle(
    IPC_CHANNELS.gitRunStackedAction,
    (_event, projectPath: string, input: Parameters<GitService["runStackedAction"]>[1]) =>
      gitService.runStackedAction(projectPath, input, (progress) =>
        sendToRenderer(EVENT_CHANNELS.gitActionProgress, progress)
      )
  )

  ipcMain.handle(IPC_CHANNELS.skillsList, () => skillsService.list())
}

async function getOrCreateDeviceId(userDataPath: string): Promise<string> {
  const filePath = join(userDataPath, "device-id.json")
  try {
    const raw = await readFile(filePath, "utf8")
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === "object" && "id" in parsed && typeof (parsed as { id: unknown }).id === "string") {
      return (parsed as { id: string }).id
    }
  } catch {
    // file doesn't exist yet or is invalid
  }
  const id = randomUUID()
  await mkdir(userDataPath, { recursive: true })
  await writeFile(filePath, JSON.stringify({ id }), "utf8")
  return id
}

async function initializeAnalytics(): Promise<void> {
  loadDesktopEnv()

  if (!isAnalyticsConfigured()) {
    return
  }

  if (!isAnalyticsExplicitlyEnabled()) {
    console.warn("[posthog] Analytics disabled: POSTHOG_ENABLED is not set to true")
    return
  }

  let deviceId = randomUUID()

  try {
    deviceId = await getOrCreateDeviceId(stableUserDataPath)
  } catch (error) {
    console.warn("[posthog] Failed to persist device id, using an ephemeral session id:", error)
  }

  initAnalytics(deviceId)
}

async function bootstrap(): Promise<void> {
  await app.whenReady()

  if (!app.isPackaged && process.platform === "darwin") {
    app.dock.setIcon(nativeImage.createFromPath(getDevAppIconPath()))
  }

  await initializeAnalytics()

  const storeService = new JsonStoreService(app.getPath("userData"))
  registerIpcHandlers(storeService)

  mainWindow = createWindow()
  capture("app_launched", { version: app.getVersion(), platform: process.platform })

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})

let isFinalizingQuit = false

app.on("before-quit", (event) => {
  if (isFinalizingQuit) {
    return
  }

  isFinalizingQuit = true
  event.preventDefault()

  projectWatcherService.stop().catch((error) => {
    console.warn("[watcher] Failed to stop project watcher:", error)
  })
  terminalService.dispose()
  codexServerService.dispose()

  void shutdownAnalytics(2_000)
    .catch((error) => {
      console.warn("[posthog] Failed to flush analytics during shutdown:", error)
    })
    .finally(() => {
      app.quit()
    })
})

void bootstrap().catch((error) => {
  console.error("[electron] Failed to bootstrap application:", error)
  app.quit()
})
