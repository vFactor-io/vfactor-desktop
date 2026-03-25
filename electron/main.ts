import { app, BrowserWindow, ipcMain } from "electron"
import { join } from "node:path"
import { IPC_CHANNELS } from "./ipc/channels"
import { JsonStoreService } from "./services/store"
import { DesktopFsService } from "./services/fs"
import { DialogService } from "./services/dialog"
import { GitService } from "./services/git"
import { SkillsService } from "./services/skills"
import { CodexServerService } from "./services/codexServer"
import { TerminalService } from "./services/terminal"
import { ProjectWatcherService } from "./services/projectWatcher"
import { UpdaterService } from "./services/updater"

let mainWindow: BrowserWindow | null = null

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

  ipcMain.handle(
    IPC_CHANNELS.terminalCreateSession,
    (_event, sessionId: string, cwd: string, cols: number, rows: number) =>
      terminalService.createSession(sessionId, cwd, cols, rows)
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

  ipcMain.handle(IPC_CHANNELS.skillsList, () => skillsService.list())
}

async function bootstrap(): Promise<void> {
  await app.whenReady()

  const storeService = new JsonStoreService(app.getPath("userData"))
  registerIpcHandlers(storeService)

  mainWindow = createWindow()

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

app.on("before-quit", () => {
  projectWatcherService.stop().catch((error) => {
    console.warn("[watcher] Failed to stop project watcher:", error)
  })
  terminalService.dispose()
  codexServerService.dispose()
})

void bootstrap().catch((error) => {
  console.error("[electron] Failed to bootstrap application:", error)
  app.quit()
})
