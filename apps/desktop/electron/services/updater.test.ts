import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

const appMock = {
  isPackaged: true,
  getVersion: mock(() => "0.1.1"),
}

const captureMock = mock(() => {})
const captureExceptionMock = mock(() => {})
const consoleErrorMock = mock(() => {})
const updaterListeners = new Map<string, Array<(payload?: unknown) => void>>()
const originalConsoleError = console.error

function emitUpdaterEvent(event: string, payload?: unknown) {
  for (const listener of updaterListeners.get(event) ?? []) {
    listener(payload)
  }
}

const autoUpdater = {
  autoDownload: false,
  autoInstallOnAppQuit: true,
  disableDifferentialDownload: false,
  setFeedURL: mock(() => {}),
  on: mock((event: string, listener: (payload?: unknown) => void) => {
    const listeners = updaterListeners.get(event) ?? []
    listeners.push(listener)
    updaterListeners.set(event, listeners)
    return autoUpdater
  }),
  checkForUpdates: mock(async () => {}),
  quitAndInstall: mock(() => {}),
}

mock.module("electron", () => ({
  app: appMock,
}))

mock.module("electron-updater", () => ({
  default: { autoUpdater },
  autoUpdater,
}))

mock.module("./analytics", () => ({
  capture: captureMock,
  captureException: captureExceptionMock,
}))

const { UpdaterService } = await import("./updater")

describe("UpdaterService", () => {
  beforeEach(() => {
    appMock.isPackaged = true
    appMock.getVersion.mockReset()
    appMock.getVersion.mockReturnValue("0.1.1")
    captureMock.mockReset()
    captureExceptionMock.mockReset()
    consoleErrorMock.mockReset()
    console.error = consoleErrorMock as typeof console.error
    updaterListeners.clear()
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.disableDifferentialDownload = false
    autoUpdater.setFeedURL.mockReset()
    autoUpdater.on.mockReset()
    autoUpdater.on.mockImplementation((event: string, listener: (payload?: unknown) => void) => {
      const listeners = updaterListeners.get(event) ?? []
      listeners.push(listener)
      updaterListeners.set(event, listeners)
      return autoUpdater
    })
    autoUpdater.checkForUpdates.mockReset()
    autoUpdater.checkForUpdates.mockImplementation(async () => {})
    autoUpdater.quitAndInstall.mockReset()
  })

  afterEach(() => {
    console.error = originalConsoleError
  })

  test("reports disabled state for unpackaged builds", async () => {
    appMock.isPackaged = false

    const service = new UpdaterService(() => {})
    const state = service.getState()
    const result = await service.checkForUpdates()

    expect(state.enabled).toBe(false)
    expect(state.status).toBe("disabled")
    expect(result.checked).toBe(false)
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  test("mirrors a background download through to ready state", async () => {
    autoUpdater.checkForUpdates.mockImplementation(async () => {
      emitUpdaterEvent("checking-for-update")
      emitUpdaterEvent("update-available", {
        version: "0.2.0",
        releaseNotes: "Shipped a quieter updater.",
      })
      emitUpdaterEvent("download-progress", {
        percent: 48.6,
      })
      emitUpdaterEvent("update-downloaded", {
        version: "0.2.0",
        releaseNotes: "Shipped a quieter updater.",
      })
    })

    const snapshots: Array<{ status: string; downloadPercent: number | null }> = []
    const service = new UpdaterService((_channel, payload) => {
      const snapshot = payload as { status: string; downloadPercent: number | null }
      snapshots.push({
        status: snapshot.status,
        downloadPercent: snapshot.downloadPercent,
      })
    })

    const result = await service.checkForUpdates()

    expect(result.checked).toBe(true)
    expect(result.state.status).toBe("ready")
    expect(result.state.availableVersion).toBe("0.2.0")
    expect(result.state.downloadedVersion).toBe("0.2.0")
    expect(result.state.downloadPercent).toBe(100)
    expect(result.state.canInstall).toBe(true)
    expect(autoUpdater.autoDownload).toBe(true)
    expect(autoUpdater.autoInstallOnAppQuit).toBe(false)
    expect(autoUpdater.disableDifferentialDownload).toBe(true)
    expect(autoUpdater.setFeedURL).toHaveBeenCalledWith({
      provider: "generic",
      url: "https://github.com/vFactor-io/vfactor-desktop/releases/latest/download",
    })
    expect(snapshots.some((snapshot) => snapshot.status === "downloading")).toBe(true)
  })

  test("moves to up-to-date when no release is available", async () => {
    autoUpdater.checkForUpdates.mockImplementation(async () => {
      emitUpdaterEvent("checking-for-update")
      emitUpdaterEvent("update-not-available")
    })

    const service = new UpdaterService(() => {})
    const result = await service.checkForUpdates()

    expect(result.checked).toBe(true)
    expect(result.state.status).toBe("up-to-date")
    expect(result.state.availableVersion).toBeNull()
  })

  test("keeps background check failures silent", async () => {
    autoUpdater.checkForUpdates.mockRejectedValue(new Error("Network down"))

    const service = new UpdaterService(() => {})
    const result = await service.checkForUpdates({ manual: false })

    expect(result.checked).toBe(false)
    expect(result.state.status).toBe("idle")
    expect(result.state.message).toBeNull()
  })

  test("blocks restart when active work is present", async () => {
    autoUpdater.checkForUpdates.mockImplementation(async () => {
      emitUpdaterEvent("checking-for-update")
      emitUpdaterEvent("update-available", { version: "0.2.0" })
      emitUpdaterEvent("update-downloaded", { version: "0.2.0" })
    })

    const service = new UpdaterService(() => {}, {
      getActiveUpdateWork: () => ({
        activeTurns: 1,
        activeTerminalSessions: 2,
        labels: ["1 active coding turn", "2 active terminal sessions"],
      }),
    })

    await service.checkForUpdates()
    const result = await service.installUpdate()

    expect(result.accepted).toBe(true)
    expect(result.completed).toBe(false)
    expect(result.state.status).toBe("blocked")
    expect(result.state.activeWork?.activeTurns).toBe(1)
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  test("forces restart through the installer handoff when requested", async () => {
    autoUpdater.checkForUpdates.mockImplementation(async () => {
      emitUpdaterEvent("checking-for-update")
      emitUpdaterEvent("update-available", { version: "0.2.0" })
      emitUpdaterEvent("update-downloaded", { version: "0.2.0" })
    })

    const prepareForInstall = mock(async () => {})
    const service = new UpdaterService(() => {}, {
      prepareForInstall,
    })

    await service.checkForUpdates()
    const result = await service.installUpdate({ force: true })

    expect(result.accepted).toBe(true)
    expect(result.completed).toBe(true)
    expect(result.state.status).toBe("installing")
    expect(prepareForInstall).toHaveBeenCalled()
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  test("restores the app if installer handoff never completes", async () => {
    autoUpdater.checkForUpdates.mockImplementation(async () => {
      emitUpdaterEvent("checking-for-update")
      emitUpdaterEvent("update-available", { version: "0.2.0" })
      emitUpdaterEvent("update-downloaded", { version: "0.2.0" })
    })

    const restoreAfterInstallFailure = mock(async () => {})
    const service = new UpdaterService(() => {}, {
      restoreAfterInstallFailure,
      installHandoffTimeoutMs: 5,
    })

    await service.checkForUpdates()
    const result = await service.installUpdate({ force: true })

    expect(result.accepted).toBe(true)
    expect(result.completed).toBe(true)

    await Bun.sleep(20)

    const state = service.getState()
    expect(state.status).toBe("error")
    expect(state.errorContext).toBe("install")
    expect(state.canInstall).toBe(true)
    expect(restoreAfterInstallFailure).toHaveBeenCalled()
    expect(captureMock).toHaveBeenCalledWith("update_install_handoff_timed_out", {
      current_version: "0.1.1",
      target_version: "0.2.0",
      forced: true,
    })
  })

  test("does not replace a blocked install snapshot with a new update check", async () => {
    autoUpdater.checkForUpdates.mockImplementation(async () => {
      emitUpdaterEvent("checking-for-update")
      emitUpdaterEvent("update-available", { version: "0.2.0" })
      emitUpdaterEvent("update-downloaded", { version: "0.2.0" })
    })

    const service = new UpdaterService(() => {}, {
      getActiveUpdateWork: () => ({
        activeTurns: 1,
        activeTerminalSessions: 0,
        labels: ["1 active coding turn"],
      }),
    })

    await service.checkForUpdates()
    await service.installUpdate()
    autoUpdater.checkForUpdates.mockClear()

    const result = await service.checkForUpdates({ manual: false })

    expect(result.checked).toBe(false)
    expect(result.state.status).toBe("blocked")
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  test("returns to an install error state when quitAndInstall throws", async () => {
    autoUpdater.checkForUpdates.mockImplementation(async () => {
      emitUpdaterEvent("checking-for-update")
      emitUpdaterEvent("update-available", { version: "0.2.0" })
      emitUpdaterEvent("update-downloaded", { version: "0.2.0" })
    })
    autoUpdater.quitAndInstall.mockImplementation(() => {
      throw new Error("Installer handoff failed")
    })

    const restoreAfterInstallFailure = mock(async () => {})
    const service = new UpdaterService(() => {}, {
      restoreAfterInstallFailure,
    })

    await service.checkForUpdates()
    const result = await service.installUpdate({ force: true })

    expect(result.accepted).toBe(true)
    expect(result.completed).toBe(false)
    expect(result.state.status).toBe("error")
    expect(result.state.errorContext).toBe("install")
    expect(result.state.canInstall).toBe(true)
    expect(restoreAfterInstallFailure).toHaveBeenCalled()
  })
})
