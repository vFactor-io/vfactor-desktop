import electronUpdater from "electron-updater"
import { app } from "electron"
import type { ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from "electron-updater"
import type {
  AppUpdateActionResult,
  AppUpdateActiveWork,
  AppUpdateCheckResult,
  AppUpdateErrorContext,
  AppUpdateState,
} from "../../src/desktop/contracts"
import { EVENT_CHANNELS } from "../ipc/channels"
import { capture, captureException } from "./analytics"

const { autoUpdater } = electronUpdater

const UPDATE_FEED_URL =
  "https://github.com/vFactor-io/vfactor-desktop/releases/latest/download"
const AUTO_CHECK_DELAY_MS = 30_000
const AUTO_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1_000
const INSTALL_HANDOFF_TIMEOUT_MS = 15_000
const UPDATE_DISABLED_MESSAGE =
  "Automatic updates are unavailable in this build. Install vFactor from a packaged release to use the updater."
const PRIVATE_GITHUB_RELEASES_MESSAGE =
  "Automatic updates are unavailable because the release feed is private or inaccessible. Publish the release publicly or install the latest version manually."

type EventSender = (channel: string, payload: unknown) => void
type CheckOrigin = "manual" | "background" | null
type PrepareForInstall = () => Promise<void> | void
type RestoreAfterInstallFailure = () => Promise<void> | void
type GetActiveUpdateWork = () => AppUpdateActiveWork | null

interface UpdaterServiceOptions {
  getActiveUpdateWork?: GetActiveUpdateWork
  prepareForInstall?: PrepareForInstall
  restoreAfterInstallFailure?: RestoreAfterInstallFailure
  autoCheckDelayMs?: number
  autoCheckIntervalMs?: number
  installHandoffTimeoutMs?: number
}

function getReleaseMessage(info: UpdateInfo | null): string | null {
  if (!info) {
    return null
  }

  if (typeof info.releaseNotes === "string" && info.releaseNotes.trim().length > 0) {
    return info.releaseNotes.trim()
  }

  if (typeof info.releaseName === "string" && info.releaseName.trim().length > 0) {
    return info.releaseName.trim()
  }

  return null
}

function normalizeUpdateError(error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error(String(error))
  }

  const message = error.message
  const isGithubFeed404 =
    message.includes("github.com") &&
    (message.includes("HttpError: 404") ||
      message.includes("status maybe not reported, but 404") ||
      message.includes("authentication token is correct"))

  if (isGithubFeed404) {
    return new Error(PRIVATE_GITHUB_RELEASES_MESSAGE)
  }

  return error
}

function hasActiveWork(activeWork: AppUpdateActiveWork | null): boolean {
  if (!activeWork) {
    return false
  }

  return activeWork.activeTerminalSessions > 0 || activeWork.activeTurns > 0
}

function cloneState(state: AppUpdateState): AppUpdateState {
  return {
    ...state,
    activeWork: state.activeWork
      ? {
          ...state.activeWork,
          labels: [...state.activeWork.labels],
        }
      : null,
  }
}

export class UpdaterService {
  private readonly getActiveUpdateWork: GetActiveUpdateWork
  private readonly prepareForInstall: PrepareForInstall
  private readonly restoreAfterInstallFailure: RestoreAfterInstallFailure
  private readonly autoCheckDelayMs: number
  private readonly autoCheckIntervalMs: number
  private readonly installHandoffTimeoutMs: number
  private state: AppUpdateState
  private availableInfo: UpdateInfo | null = null
  private downloadedInfo: UpdateInfo | null = null
  private dismissedVersion: string | null = null
  private isBound = false
  private isConfigured = false
  private checkOrigin: CheckOrigin = null
  private errorContext: Exclude<AppUpdateErrorContext, "blocked"> = null
  private startupCheckTimeout: ReturnType<typeof setTimeout> | null = null
  private pollInterval: ReturnType<typeof setInterval> | null = null
  private installHandoffTimeout: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly sendEvent: EventSender,
    options: UpdaterServiceOptions = {},
  ) {
    this.getActiveUpdateWork = options.getActiveUpdateWork ?? (() => null)
    this.prepareForInstall = options.prepareForInstall ?? (() => {})
    this.restoreAfterInstallFailure = options.restoreAfterInstallFailure ?? (() => {})
    this.autoCheckDelayMs = options.autoCheckDelayMs ?? AUTO_CHECK_DELAY_MS
    this.autoCheckIntervalMs = options.autoCheckIntervalMs ?? AUTO_CHECK_INTERVAL_MS
    this.installHandoffTimeoutMs = options.installHandoffTimeoutMs ?? INSTALL_HANDOFF_TIMEOUT_MS
    this.state = this.createInitialState()
  }

  start(): void {
    if (!this.state.enabled) {
      this.broadcastState()
      return
    }

    this.configureUpdater()
    this.bindEvents()
    this.scheduleAutomaticChecks()
    this.broadcastState()
  }

  getState(): AppUpdateState {
    return cloneState(this.state)
  }

  async checkForUpdates(options: { manual?: boolean } = {}): Promise<AppUpdateCheckResult> {
    const manual = options.manual ?? true

    if (!this.state.enabled) {
      return { checked: false, state: this.getState() }
    }

    if (
      this.state.status === "checking" ||
      this.state.status === "downloading" ||
      this.state.status === "blocked" ||
      this.state.status === "installing" ||
      this.state.status === "ready"
    ) {
      return { checked: false, state: this.getState() }
    }

    this.configureUpdater()
    this.bindEvents()
    this.checkOrigin = manual ? "manual" : "background"
    this.errorContext = "check"

    capture("update_check_requested", {
      origin: this.checkOrigin,
      current_version: this.state.currentVersion,
    })

    try {
      await autoUpdater.checkForUpdates()
      return { checked: true, state: this.getState() }
    } catch (error) {
      this.handleCheckFailure(error, manual)
      return { checked: false, state: this.getState() }
    } finally {
      this.checkOrigin = null
      if (this.errorContext === "check") {
        this.errorContext = null
      }
    }
  }

  async installUpdate(options?: { force?: boolean }): Promise<AppUpdateActionResult> {
    const force = options?.force === true

    if (!this.state.enabled) {
      return { accepted: false, completed: false, state: this.getState() }
    }

    const downloadedVersion = this.state.downloadedVersion
    if (!downloadedVersion) {
      this.setState({
        status: "error",
        message: "There is no downloaded update ready to install.",
        errorContext: "install",
        activeWork: null,
        canDismiss: true,
        canRetry: false,
        canInstall: false,
      })
      return { accepted: false, completed: false, state: this.getState() }
    }

    if (!force) {
      const activeWork = this.getActiveUpdateWork()
      if (hasActiveWork(activeWork)) {
        capture("update_install_blocked", {
          active_turns: activeWork?.activeTurns ?? 0,
          active_terminal_sessions: activeWork?.activeTerminalSessions ?? 0,
          target_version: downloadedVersion,
        })

        this.setState({
          status: "blocked",
          message: "Restarting now will interrupt active coding work.",
          errorContext: "blocked",
          activeWork,
          canDismiss: true,
          canRetry: false,
          canInstall: true,
        })

        return { accepted: true, completed: false, state: this.getState() }
      }
    }

    try {
      this.errorContext = "install"
      this.setState({
        status: "installing",
        message: "Preparing to restart and install the update…",
        errorContext: null,
        activeWork: null,
        canDismiss: false,
        canRetry: false,
        canInstall: false,
      })

      await this.prepareForInstall()
      capture("update_install_started", {
        current_version: this.state.currentVersion,
        target_version: downloadedVersion,
        forced: force,
      })
      this.armInstallHandoffTimeout(downloadedVersion, force)
      autoUpdater.quitAndInstall(false, true)
      return { accepted: true, completed: true, state: this.getState() }
    } catch (error) {
      this.clearInstallHandoffTimeout()
      await this.restoreAfterInstallFailure()
      this.handleError(error)
      return { accepted: true, completed: false, state: this.getState() }
    }
  }

  dismissUpdate(): AppUpdateState {
    if (this.state.status === "blocked" && this.state.downloadedVersion) {
      this.setState({
        status: "ready",
        message: getReleaseMessage(this.downloadedInfo ?? this.availableInfo),
        errorContext: null,
        activeWork: null,
        canDismiss: this.dismissedVersion !== this.state.downloadedVersion,
        canRetry: false,
        canInstall: true,
      })
      return this.getState()
    }

    const version = this.state.downloadedVersion ?? this.state.availableVersion
    if (!version) {
      return this.getState()
    }

    this.dismissedVersion = version
    this.setState({ canDismiss: false })
    return this.getState()
  }

  private createInitialState(): AppUpdateState {
    const enabled =
      app.isPackaged && (process.platform === "darwin" || process.platform === "win32")

    return {
      enabled,
      status: enabled ? "idle" : "disabled",
      currentVersion: app.getVersion(),
      availableVersion: null,
      downloadedVersion: null,
      downloadPercent: null,
      checkedAt: null,
      message: enabled ? null : UPDATE_DISABLED_MESSAGE,
      errorContext: null,
      activeWork: null,
      canDismiss: false,
      canRetry: false,
      canInstall: false,
    }
  }

  private configureUpdater(): void {
    if (this.isConfigured || !this.state.enabled) {
      return
    }

    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = false

    ;(autoUpdater as typeof autoUpdater & { disableDifferentialDownload?: boolean })
      .disableDifferentialDownload = true
    autoUpdater.setFeedURL({
      provider: "generic",
      url: UPDATE_FEED_URL,
    })

    this.isConfigured = true
  }

  private bindEvents(): void {
    if (this.isBound) {
      return
    }

    autoUpdater.on("checking-for-update", () => {
      if (this.state.status === "ready" || this.state.status === "installing") {
        return
      }

      this.setState({
        status: "checking",
        message: null,
        errorContext: null,
        activeWork: null,
        canDismiss: false,
        canRetry: false,
        canInstall: false,
      })
    })

    autoUpdater.on("update-available", (info: UpdateInfo) => {
      this.availableInfo = info
      this.errorContext = "download"
      capture("update_download_started", {
        origin: this.checkOrigin,
        current_version: this.state.currentVersion,
        target_version: info.version,
      })
      this.setState({
        status: "downloading",
        availableVersion: info.version,
        downloadedVersion: null,
        downloadPercent: 0,
        checkedAt: Date.now(),
        message: getReleaseMessage(info),
        errorContext: null,
        activeWork: null,
        canDismiss: false,
        canRetry: false,
        canInstall: false,
      })
    })

    autoUpdater.on("download-progress", (progress: ProgressInfo) => {
      this.errorContext = "download"
      this.setState({
        status: "downloading",
        downloadPercent: Math.max(0, Math.min(100, Math.round(progress.percent))),
      })
    })

    autoUpdater.on("update-downloaded", (info: UpdateDownloadedEvent) => {
      this.downloadedInfo = info
      this.availableInfo = info
      this.errorContext = null

      capture("update_download_completed", {
        current_version: this.state.currentVersion,
        target_version: info.version,
      })

      this.setState({
        status: "ready",
        availableVersion: info.version,
        downloadedVersion: info.version,
        downloadPercent: 100,
        checkedAt: Date.now(),
        message: getReleaseMessage(info),
        errorContext: null,
        activeWork: null,
        canDismiss: this.dismissedVersion !== info.version,
        canRetry: false,
        canInstall: true,
      })
    })

    autoUpdater.on("update-not-available", () => {
      this.availableInfo = null
      this.downloadedInfo = null
      this.errorContext = null
      this.dismissedVersion = null
      capture("update_not_available", {
        origin: this.checkOrigin,
        current_version: this.state.currentVersion,
      })

      this.setState({
        status: "up-to-date",
        availableVersion: null,
        downloadedVersion: null,
        downloadPercent: null,
        checkedAt: Date.now(),
        message: null,
        errorContext: null,
        activeWork: null,
        canDismiss: false,
        canRetry: false,
        canInstall: false,
      })
    })

    autoUpdater.on("error", (error) => {
      this.handleError(error)
    })

    this.isBound = true
  }

  private scheduleAutomaticChecks(): void {
    if (this.startupCheckTimeout) {
      clearTimeout(this.startupCheckTimeout)
    }

    if (this.pollInterval) {
      clearInterval(this.pollInterval)
    }

    this.startupCheckTimeout = setTimeout(() => {
      void this.checkForUpdates({ manual: false })
    }, this.autoCheckDelayMs)

    this.pollInterval = setInterval(() => {
      void this.checkForUpdates({ manual: false })
    }, this.autoCheckIntervalMs)
  }

  private handleCheckFailure(error: unknown, manual: boolean): void {
    this.clearInstallHandoffTimeout()
    const normalizedError = normalizeUpdateError(error)
    const isAlreadyHandled =
      this.state.status === "error" &&
      this.state.errorContext === "check" &&
      this.state.message === normalizedError.message

    if (isAlreadyHandled) {
      return
    }

    if (!manual) {
      if (this.state.downloadedVersion) {
        this.setState({
          status: "ready",
          checkedAt: Date.now(),
          errorContext: null,
          canDismiss: this.dismissedVersion !== this.state.downloadedVersion,
          canRetry: false,
          canInstall: true,
        })
        return
      }

      this.setState({
        status: "idle",
        checkedAt: Date.now(),
        message: null,
        errorContext: null,
        activeWork: null,
        canDismiss: false,
        canRetry: false,
        canInstall: false,
      })
      return
    }

    this.setState({
      status: "error",
      checkedAt: Date.now(),
      message: normalizedError.message,
      errorContext: "check",
      activeWork: null,
      canDismiss: true,
      canRetry: true,
      canInstall: Boolean(this.state.downloadedVersion),
    })
  }

  private handleError(error: unknown): void {
    this.clearInstallHandoffTimeout()
    const normalizedError = normalizeUpdateError(error)
    console.error("[updates] Auto-update error:", normalizedError)
    captureException(normalizedError, { context: "auto_updater" })

    if (this.errorContext === "check") {
      this.handleCheckFailure(normalizedError, this.checkOrigin === "manual")
      return
    }

    const errorContext: AppUpdateErrorContext =
      this.errorContext === "install"
        ? "install"
        : this.errorContext === "download" || this.state.status === "downloading"
          ? "download"
          : "check"

    if (errorContext === "install") {
      void this.restoreAfterInstallFailure()
    }

    this.setState({
      status: "error",
      checkedAt: Date.now(),
      message: normalizedError.message,
      errorContext,
      activeWork: null,
      canDismiss: true,
      canRetry: true,
      canInstall: Boolean(this.state.downloadedVersion),
    })

    this.errorContext = null
  }

  private setState(patch: Partial<AppUpdateState>): void {
    this.state = {
      ...this.state,
      ...patch,
      currentVersion: app.getVersion(),
    }
    this.broadcastState()
  }

  private broadcastState(): void {
    this.sendEvent(EVENT_CHANNELS.appUpdateState, this.getState())
  }

  private clearInstallHandoffTimeout(): void {
    if (!this.installHandoffTimeout) {
      return
    }

    clearTimeout(this.installHandoffTimeout)
    this.installHandoffTimeout = null
  }

  private armInstallHandoffTimeout(targetVersion: string, force: boolean): void {
    this.clearInstallHandoffTimeout()

    this.installHandoffTimeout = setTimeout(() => {
      this.installHandoffTimeout = null

      capture("update_install_handoff_timed_out", {
        current_version: this.state.currentVersion,
        target_version: targetVersion,
        forced: force,
      })

      void this.restoreAfterInstallFailure().finally(() => {
        const error = new Error(
          "vFactor couldn't restart to install the update. Retry restart, or download the latest release manually."
        )
        captureException(error, { context: "auto_updater_install_handoff_timeout" })
        this.setState({
          status: "error",
          checkedAt: Date.now(),
          message: error.message,
          errorContext: "install",
          activeWork: null,
          canDismiss: true,
          canRetry: true,
          canInstall: Boolean(this.state.downloadedVersion),
        })
        this.errorContext = null
      })
    }, this.installHandoffTimeoutMs)
  }
}
