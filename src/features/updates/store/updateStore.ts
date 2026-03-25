import { create } from "zustand"
import { desktop } from "@/desktop/client"
import type { AppUpdateDownloadEvent, AppUpdateInfo } from "@/desktop/client"

export type AppUpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "up-to-date"
  | "downloading"
  | "installing"
  | "installed"
  | "error"

export type { AppUpdateDownloadEvent, AppUpdateInfo } from "@/desktop/client"

interface CheckForUpdatesOptions {
  silent?: boolean
}

interface AppUpdateState {
  phase: AppUpdatePhase
  availableUpdate: AppUpdateInfo | null
  lastCheckedAt: number | null
  error: string | null
  hasInitialized: boolean
  dismissedVersion: string | null
  downloadedBytes: number
  contentLength: number | null
  initialize: () => Promise<void>
  checkForUpdates: (options?: CheckForUpdatesOptions) => Promise<AppUpdateInfo | null>
  installUpdate: () => Promise<void>
  dismissUpdate: () => void
  handleDownloadEvent: (event: AppUpdateDownloadEvent) => void
}

let initializePromise: Promise<void> | null = null
let checkPromise: Promise<AppUpdateInfo | null> | null = null

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return String(error)
}

export const useAppUpdateStore = create<AppUpdateState>((set, get) => ({
  phase: "idle",
  availableUpdate: null,
  lastCheckedAt: null,
  error: null,
  hasInitialized: false,
  dismissedVersion: null,
  downloadedBytes: 0,
  contentLength: null,

  initialize: async () => {
    if (get().hasInitialized) {
      return
    }

    if (initializePromise) {
      return initializePromise
    }

    set({ hasInitialized: true })

    initializePromise = (async () => {
      if (import.meta.env.DEV) {
        return
      }

      await get().checkForUpdates({ silent: true })
    })().finally(() => {
      initializePromise = null
    })

    return initializePromise
  },

  checkForUpdates: async (options) => {
    if (checkPromise) {
      return checkPromise
    }

    const previousPhase = get().phase
    set({ phase: "checking", error: null })

    checkPromise = (async () => {
      try {
        const update = await desktop.app.checkForUpdates()
        const lastCheckedAt = Date.now()

        if (update) {
          set((state) => ({
            availableUpdate: update,
            phase: "available",
            error: null,
            lastCheckedAt,
            downloadedBytes: 0,
            contentLength: null,
            dismissedVersion:
              state.dismissedVersion === update.version ? state.dismissedVersion : null,
          }))

          return update
        }

        set({
          availableUpdate: null,
          phase: "up-to-date",
          error: null,
          lastCheckedAt,
          downloadedBytes: 0,
          contentLength: null,
        })

        return null
      } catch (error) {
        const message = getErrorMessage(error)

        set((state) => ({
          error: message,
          lastCheckedAt: Date.now(),
          phase: options?.silent ? (state.availableUpdate ? state.phase : previousPhase) : "error",
        }))

        return null
      } finally {
        checkPromise = null
      }
    })()

    return checkPromise
  },

  installUpdate: async () => {
    const update = get().availableUpdate
    if (!update) {
      set({ phase: "error", error: "There is no update ready to install." })
      return
    }

    set({
      phase: "downloading",
      error: null,
      dismissedVersion: null,
      downloadedBytes: 0,
      contentLength: null,
    })

    try {
      await desktop.app.installUpdate()
      set({ phase: "installed", error: null })
    } catch (error) {
      set({ phase: "error", error: getErrorMessage(error) })
    }
  },

  dismissUpdate: () => {
    const update = get().availableUpdate
    if (!update) {
      return
    }

    set({ dismissedVersion: update.version })
  },

  handleDownloadEvent: (event) => {
    switch (event.event) {
      case "started":
        set({
          phase: "downloading",
          error: null,
          downloadedBytes: 0,
          contentLength: event.contentLength ?? null,
        })
        return
      case "progress":
        set((state) => ({
          phase: "downloading",
          downloadedBytes: event.downloaded ?? state.downloadedBytes,
          contentLength: event.contentLength ?? state.contentLength,
        }))
        return
      case "finished":
        set({ phase: "installing" })
    }
  },
}))
