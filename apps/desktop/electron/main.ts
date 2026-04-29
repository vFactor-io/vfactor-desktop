import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { app, BrowserWindow, ipcMain, nativeImage, nativeTheme, shell } from "electron"
import { basename, dirname, join } from "node:path"
import { EVENT_CHANNELS, IPC_CHANNELS } from "./ipc/channels"
import { JsonStoreService } from "./services/store"
import { DesktopFsService } from "./services/fs"
import { DialogService } from "./services/dialog"
import { GitService } from "./services/git"
import { SkillsService } from "./services/skills"
import { CodexServerService } from "./services/codexServer"
import { OpenCodeServerService } from "./services/opencodeServer"
import { RuntimeService } from "./services/runtime/runtimeService"
import { ProviderSettingsService } from "./services/runtime/providerSettings"
import { TerminalService } from "./services/terminal"
import { ProjectWatcherService } from "./services/projectWatcher"
import { UpdaterService } from "./services/updater"
import {
  isAnalyticsConfigured,
  isAnalyticsExplicitlyEnabled,
  initAnalytics,
  capture,
  flushAnalyticsWithTimeout,
  shutdownAnalytics,
} from "./services/analytics"
import {
  attachWindowCrashTelemetry,
  captureCrashTelemetry,
  registerElectronCrashTelemetry,
  registerProcessCrashTelemetry,
} from "./services/crashTelemetry"
import type { AppWindowThemeSyncInput, GitPullRequestChecksOptions } from "../src/desktop/contracts"
import {
  APPEARANCE_THEME_ID_KEY,
  areWindowThemeStatesEqual,
  getWindowControlsOverlayStyle,
  resolveWindowThemeState,
  SETTINGS_STORE_FILE,
  type WindowThemeState,
  normalizeWindowThemeState,
} from "./services/windowTheme"
import { syncShellEnvironment } from "./services/shellEnvironment"

syncShellEnvironment()

let mainWindow: BrowserWindow | null = null
const isDevelopment = !app.isPackaged
const APP_DISPLAY_NAME = isDevelopment ? "vFactor Dev" : "vFactor"
const APP_ID = isDevelopment ? "io.vfactor.desktop.dev" : "io.vfactor.desktop"
const LINUX_DESKTOP_ENTRY_NAME = isDevelopment ? "vfactor-dev.desktop" : "vfactor.desktop"
const LINUX_WM_CLASS = isDevelopment ? "vfactor-dev" : "vfactor"
const USER_DATA_DIRS = isDevelopment
  ? ["vfactor-desktop-dev", "io.vfactor.desktop.dev"]
  : ["vfactor-desktop", "io.vfactor.desktop"]
let windowThemeState: WindowThemeState = resolveWindowThemeState("system", false)

app.setName(APP_DISPLAY_NAME)

if (process.platform === "linux") {
  app.commandLine.appendSwitch("class", LINUX_WM_CLASS)
}

if (process.platform === "win32") {
  app.setAppUserModelId(APP_ID)
}

function getAppIconPath(fileName: "icon.ico" | "icon.png" | "dock.png"): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "icons", fileName)
  }

  return join(process.cwd(), "build", "icons", "dev", fileName)
}

function hasPersistedDesktopData(directoryPath: string): boolean {
  return existsSync(join(directoryPath, "projects.json")) || existsSync(join(directoryPath, "chat.json"))
}

function resolveUserDataPath(): string {
  const currentPath = app.getPath("userData")
  const appDataPath = app.getPath("appData")
  const fallbackPath = join(appDataPath, USER_DATA_DIRS[0])
  const candidatePaths = [
    currentPath,
    ...USER_DATA_DIRS.map((directoryName) => join(appDataPath, directoryName)),
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

function loadDesktopEnv(): string[] {
  if (typeof process.loadEnvFile !== "function") {
    return []
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
  const loadedPaths: string[] = []

  for (const envPath of envPaths) {
    if (seenPaths.has(envPath)) {
      continue
    }

    seenPaths.add(envPath)

    if (!existsSync(envPath)) {
      continue
    }

    process.loadEnvFile(envPath)
    loadedPaths.push(envPath)
  }

  return loadedPaths
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
let codexServerService = new CodexServerService(sendToRenderer)
let openCodeServerService = new OpenCodeServerService()
const terminalService = new TerminalService(sendToRenderer)
const projectWatcherService = new ProjectWatcherService(sendToRenderer)
let runtimeService: RuntimeService | null = null

type QuitReason = "none" | "normal" | "update-install"

let quitReason: QuitReason = "none"
let isFinalizingQuit = false

function getActiveUpdateWork() {
  const activeTurns = runtimeService?.getActiveTurnCount() ?? codexServerService.getActiveTurnCount()
  const activeTerminalSessions = terminalService.getActiveSessionCount()

  if (activeTurns === 0 && activeTerminalSessions === 0) {
    return null
  }

  const labels: string[] = []

  if (activeTurns > 0) {
    labels.push(`${activeTurns} active coding ${activeTurns === 1 ? "turn" : "turns"}`)
  }

  if (activeTerminalSessions > 0) {
    labels.push(
      `${activeTerminalSessions} active terminal ${activeTerminalSessions === 1 ? "session" : "sessions"}`
    )
  }

  return {
    activeTurns,
    activeTerminalSessions,
    labels,
  }
}

function getCrashTelemetryContext(): Record<string, unknown> {
  const activeWork = getActiveUpdateWork()

  return {
    quit_reason: quitReason,
    active_turns: activeWork?.activeTurns ?? 0,
    active_terminal_sessions: activeWork?.activeTerminalSessions ?? 0,
  }
}

async function cleanupForQuit(options: { includeAnalytics: boolean }): Promise<void> {
  await projectWatcherService.stop().catch((error) => {
    console.warn("[watcher] Failed to stop project watcher:", error)
  })
  terminalService.dispose()
  runtimeService?.dispose()
  codexServerService.dispose()
  await openCodeServerService.dispose()

  if (!options.includeAnalytics) {
    return
  }

  await shutdownAnalytics(2_000).catch((error) => {
    console.warn("[posthog] Failed to flush analytics during shutdown:", error)
  })
}

async function prepareForUpdateInstall(): Promise<void> {
  quitReason = "update-install"
  await cleanupForQuit({ includeAnalytics: false })

  for (const window of BrowserWindow.getAllWindows()) {
    window.close()
  }
}

async function restoreAfterFailedUpdateInstall(): Promise<void> {
  quitReason = "none"

  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createWindow()
  }
}

const updaterService = new UpdaterService(sendToRenderer, {
  getActiveUpdateWork,
  prepareForInstall: prepareForUpdateInstall,
  restoreAfterInstallFailure: restoreAfterFailedUpdateInstall,
})

registerProcessCrashTelemetry(getCrashTelemetryContext)
registerElectronCrashTelemetry(getCrashTelemetryContext)

function applyWindowThemeState(nextThemeState: WindowThemeState): void {
  const previousThemeState = windowThemeState

  if (areWindowThemeStatesEqual(previousThemeState, nextThemeState)) {
    return
  }

  const didThemeSourceChange = previousThemeState.themeSource !== nextThemeState.themeSource
  const didWindowAppearanceChange =
    previousThemeState.backgroundColor !== nextThemeState.backgroundColor ||
    previousThemeState.resolvedAppearance !== nextThemeState.resolvedAppearance

  windowThemeState = nextThemeState

  if (didThemeSourceChange) {
    nativeTheme.themeSource = nextThemeState.themeSource
  }

  if (!didWindowAppearanceChange) {
    return
  }

  for (const window of BrowserWindow.getAllWindows()) {
    window.setBackgroundColor(nextThemeState.backgroundColor)

    if (process.platform !== "darwin") {
      window.setTitleBarOverlay(getWindowControlsOverlayStyle(nextThemeState))
    }
  }
}

function createWindow(): BrowserWindow {
  if (windowThemeState.themeSource === "system") {
    windowThemeState = resolveWindowThemeState("system", nativeTheme.shouldUseDarkColors)
  }

  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: windowThemeState.backgroundColor,
    title: APP_DISPLAY_NAME,
    icon: process.platform === "linux" || process.platform === "win32"
      ? getAppIconPath(process.platform === "win32" ? "icon.ico" : "icon.png")
      : undefined,
    webPreferences: {
      preload: join(__dirname, "../preload/preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
    titleBarStyle: process.platform === "darwin" ? "hidden" : undefined,
    trafficLightPosition:
      process.platform === "darwin" ? { x: 16, y: 14 } : undefined,
    titleBarOverlay:
      process.platform !== "darwin"
        ? getWindowControlsOverlayStyle(windowThemeState)
        : false,
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"))
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    window.webContents.on("console-message", (event) => {
      const { level, message, lineNumber, sourceId } = event
      if (!message.includes("[file-tree-drop]")) {
        return
      }

      console.log(`[renderer:${level}] ${message} (${sourceId}:${lineNumber})`)
    })

    window.webContents.once("did-finish-load", () => {
      window.webContents.openDevTools({ mode: "detach" })
    })
  }

  attachWindowCrashTelemetry(window, getCrashTelemetryContext)

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null
    }
  })

  return window
}

function registerIpcHandlers(storeService: JsonStoreService): void {
  const providerSettingsService = new ProviderSettingsService(storeService)
  codexServerService = new CodexServerService(sendToRenderer, providerSettingsService)
  openCodeServerService = new OpenCodeServerService(providerSettingsService)
  runtimeService = new RuntimeService(
    sendToRenderer,
    storeService,
    gitService,
    codexServerService,
    openCodeServerService,
    providerSettingsService
  )

  ipcMain.handle(IPC_CHANNELS.appGetVersion, () => app.getVersion())
  ipcMain.handle(IPC_CHANNELS.appGetUpdateState, () => updaterService.getState())
  ipcMain.handle(IPC_CHANNELS.appCheckForUpdates, () => updaterService.checkForUpdates())
  ipcMain.handle(
    IPC_CHANNELS.appInstallUpdate,
    (_event, options?: { force?: boolean }) => updaterService.installUpdate(options)
  )
  ipcMain.handle(IPC_CHANNELS.appDismissUpdate, () => updaterService.dismissUpdate())
  ipcMain.handle(IPC_CHANNELS.appSyncWindowTheme, (_event, input: AppWindowThemeSyncInput) => {
    applyWindowThemeState(
      normalizeWindowThemeState(input, nativeTheme.shouldUseDarkColors)
    )
  })

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
  ipcMain.handle(IPC_CHANNELS.fsWriteDataUrlFile, (_event, path: string, dataUrl: string) =>
    fsService.writeDataUrlFile(path, dataUrl)
  )
  ipcMain.handle(IPC_CHANNELS.fsExists, (_event, path: string) => fsService.exists(path))
  ipcMain.handle(IPC_CHANNELS.fsReadDir, (_event, path: string) => fsService.readDir(path))
  ipcMain.handle(
    IPC_CHANNELS.fsMkdir,
    (_event, path: string, options?: { recursive?: boolean }) => fsService.mkdir(path, options)
  )
  ipcMain.handle(
    IPC_CHANNELS.fsRemovePath,
    (_event, path: string, options?: { recursive?: boolean; force?: boolean }) =>
      fsService.removePath(path, options)
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

  ipcMain.handle(IPC_CHANNELS.runtimeCreateSession, (_event, input: unknown) =>
    runtimeService?.createSession(input as never)
  )
  ipcMain.handle(IPC_CHANNELS.runtimeListModels, (_event, input: unknown) =>
    runtimeService?.listModels(input as never)
  )
  ipcMain.handle(IPC_CHANNELS.runtimeListProviderStatuses, () =>
    runtimeService?.listProviderStatuses()
  )
  ipcMain.handle(IPC_CHANNELS.runtimeRefreshProviderStatus, (_event, input: unknown) =>
    runtimeService?.refreshProviderStatus(input as never)
  )
  ipcMain.handle(IPC_CHANNELS.runtimeListAgents, (_event, input: unknown) =>
    runtimeService?.listAgents(input as never)
  )
  ipcMain.handle(IPC_CHANNELS.runtimeListCommands, (_event, input: unknown) =>
    runtimeService?.listCommands(input as never)
  )
  ipcMain.handle(IPC_CHANNELS.runtimeSearchFiles, (_event, input: unknown) =>
    runtimeService?.searchFiles(input as never)
  )
  ipcMain.handle(IPC_CHANNELS.runtimeSendTurn, (_event, input: unknown) =>
    runtimeService?.sendTurn(input as never)
  )
  ipcMain.handle(IPC_CHANNELS.runtimeAnswerPrompt, (_event, input: unknown) =>
    runtimeService?.answerPrompt(input as never)
  )
  ipcMain.handle(IPC_CHANNELS.runtimeInterruptTurn, (_event, input: unknown) =>
    runtimeService?.interruptTurn(input as never)
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
  ipcMain.handle(
    IPC_CHANNELS.gitGetPullRequestChecks,
    (_event, projectPath: string, options?: GitPullRequestChecksOptions) =>
      gitService.getPullRequestChecks(projectPath, options)
  )
  ipcMain.handle(IPC_CHANNELS.gitListWorktrees, (_event, projectPath: string) =>
    gitService.listWorktrees(projectPath)
  )
  ipcMain.handle(IPC_CHANNELS.gitInitRepo, (_event, projectPath: string) =>
    gitService.initRepo(projectPath)
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
    IPC_CHANNELS.gitEnsureInfoExcludeEntries,
    (_event, projectPath: string, entries: string[]) =>
      gitService.ensureInfoExcludeEntries(projectPath, entries)
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
  const loadedEnvPaths = loadDesktopEnv()

  if (!isAnalyticsConfigured()) {
    if (app.isPackaged) {
      console.warn(
        `[posthog] Analytics disabled: POSTHOG_API_KEY is not set. Loaded runtime env files: ${loadedEnvPaths.join(", ") || "none"}.`
      )
    }
    return
  }

  if (!isAnalyticsExplicitlyEnabled()) {
    console.warn(
      `[posthog] Analytics disabled: POSTHOG_ENABLED is not set to true. Loaded runtime env files: ${loadedEnvPaths.join(", ") || "none"}.`
    )
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

  if (process.platform === "linux") {
    ;(app as typeof app & { setDesktopName?: (desktopName: string) => void }).setDesktopName?.(
      LINUX_DESKTOP_ENTRY_NAME
    )
  }

  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(getAppIconPath("dock.png")))
  }

  await initializeAnalytics()

  const storeService = new JsonStoreService(app.getPath("userData"))
  applyWindowThemeState(
    resolveWindowThemeState(
      await storeService.get<string>(SETTINGS_STORE_FILE, APPEARANCE_THEME_ID_KEY),
      nativeTheme.shouldUseDarkColors
    )
  )
  registerIpcHandlers(storeService)

  mainWindow = createWindow()
  updaterService.start()
  capture("app_launched", { version: app.getVersion(), platform: process.platform })

  nativeTheme.on("updated", () => {
    if (windowThemeState.themeSource !== "system") {
      return
    }

    applyWindowThemeState(
      resolveWindowThemeState(windowThemeState.themeSource, nativeTheme.shouldUseDarkColors)
    )
  })

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
}

app.on("window-all-closed", () => {
  if (quitReason === "update-install") {
    return
  }

  if (process.platform !== "darwin") {
    app.quit()
  }
})

app.on("before-quit", (event) => {
  if (quitReason === "update-install") {
    return
  }

  if (isFinalizingQuit) {
    return
  }

  isFinalizingQuit = true
  quitReason = "normal"
  event.preventDefault()

  void cleanupForQuit({ includeAnalytics: true }).finally(() => {
    app.quit()
  })
})

void bootstrap().catch((error) => {
  console.error("[electron] Failed to bootstrap application:", error)
  captureCrashTelemetry("bootstrap_failed", error, getCrashTelemetryContext())
  void flushAnalyticsWithTimeout(1_500)
    .catch((flushError) => {
      console.warn("[posthog] Failed to flush bootstrap failure telemetry:", flushError)
    })
    .finally(() => {
      app.quit()
    })
})
