import { app } from "electron"
import electronUpdater from "electron-updater"
import type { ProgressInfo, UpdateInfo } from "electron-updater"
import type { AppUpdateDownloadEvent, AppUpdateInfo } from "../../src/desktop/contracts"
import { EVENT_CHANNELS } from "../ipc/channels"

const { autoUpdater } = electronUpdater

type EventSender = (channel: string, payload: unknown) => void

function mapUpdateInfo(info: UpdateInfo): AppUpdateInfo {
  return {
    version: info.version,
    currentVersion: app.getVersion(),
    notes:
      typeof info.releaseNotes === "string"
        ? info.releaseNotes
        : info.releaseName ?? null,
    pubDate: info.releaseDate ?? null,
    target: process.platform,
  }
}

export class UpdaterService {
  private availableUpdate: UpdateInfo | null = null
  private isBound = false

  constructor(private readonly sendEvent: EventSender) {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
  }

  async checkForUpdates(): Promise<AppUpdateInfo | null> {
    if (!app.isPackaged) {
      return null
    }

    this.bindEvents()

    this.availableUpdate = null
    let sawAvailable = false

    const availableListener = (info: UpdateInfo) => {
      sawAvailable = true
      this.availableUpdate = info
    }

    autoUpdater.once("update-available", availableListener)
    autoUpdater.once("update-not-available", () => {
      sawAvailable = false
      this.availableUpdate = null
    })

    try {
      await autoUpdater.checkForUpdates()
    } finally {
      autoUpdater.removeListener("update-available", availableListener)
    }

    return sawAvailable && this.availableUpdate ? mapUpdateInfo(this.availableUpdate) : null
  }

  async installUpdate(): Promise<void> {
    if (!this.availableUpdate) {
      throw new Error("There is no pending app update to install.")
    }

    this.bindEvents()
    const startedPayload: AppUpdateDownloadEvent = {
      event: "started",
      chunkLength: null,
      downloaded: 0,
      contentLength: null,
    }
    this.sendEvent(EVENT_CHANNELS.appUpdate, startedPayload)

    await autoUpdater.downloadUpdate()
    autoUpdater.quitAndInstall()
  }

  private bindEvents(): void {
    if (this.isBound) {
      return
    }

    autoUpdater.on("download-progress", (progress: ProgressInfo) => {
      const payload: AppUpdateDownloadEvent = {
        event: "progress",
        chunkLength: progress.delta,
        downloaded: progress.transferred,
        contentLength: progress.total,
      }
      this.sendEvent(EVENT_CHANNELS.appUpdate, payload)
    })

    autoUpdater.on("update-downloaded", () => {
      const payload: AppUpdateDownloadEvent = {
        event: "finished",
        chunkLength: null,
        downloaded: null,
        contentLength: null,
      }
      this.sendEvent(EVENT_CHANNELS.appUpdate, payload)
    })

    autoUpdater.on("error", (error) => {
      console.error("[updates] Auto-update error:", error)
    })

    this.isBound = true
  }
}
