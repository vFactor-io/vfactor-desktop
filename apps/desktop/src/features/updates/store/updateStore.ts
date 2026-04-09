import { create } from "zustand"
import { desktop } from "@/desktop/client"
import type {
  AppUpdateActionResult,
  AppUpdateCheckResult,
  AppUpdateState,
} from "@/desktop/client"

function createInitialUpdateState(): AppUpdateState {
  return {
    enabled: false,
    status: "disabled",
    currentVersion: "",
    availableVersion: null,
    downloadedVersion: null,
    downloadPercent: null,
    checkedAt: null,
    message: null,
    errorContext: null,
    activeWork: null,
    canDismiss: false,
    canRetry: false,
    canInstall: false,
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return String(error)
}

function toErroredUpdateState(
  currentState: AppUpdateState,
  error: unknown,
  errorContext: AppUpdateState["errorContext"],
): AppUpdateState {
  return {
    ...currentState,
    status: "error",
    message: getErrorMessage(error),
    errorContext,
    canDismiss: true,
    canRetry: true,
    canInstall: currentState.canInstall,
  }
}

interface AppUpdateStoreState {
  updateState: AppUpdateState
  hasInitialized: boolean
  blockedDialogOpen: boolean
  toastDismissedForStatus: AppUpdateState["status"] | null
  initialize: () => Promise<void>
  checkForUpdates: () => Promise<AppUpdateCheckResult>
  installUpdate: (options?: { force?: boolean }) => Promise<AppUpdateActionResult>
  dismissUpdate: () => Promise<void>
  dismissToast: () => void
  setUpdateState: (state: AppUpdateState) => void
  closeBlockedDialog: () => void
}

let initializePromise: Promise<void> | null = null

export const useAppUpdateStore = create<AppUpdateStoreState>((set, get) => ({
  updateState: createInitialUpdateState(),
  hasInitialized: false,
  blockedDialogOpen: false,
  toastDismissedForStatus: null,

  initialize: async () => {
    if (get().hasInitialized) {
      return
    }

    if (initializePromise) {
      return initializePromise
    }

    initializePromise = (async () => {
      try {
        const updateState = await desktop.app.getUpdateState()
        set({ updateState, hasInitialized: true })
      } catch (error) {
        set((state) => ({
          updateState: toErroredUpdateState(state.updateState, error, "check"),
        }))
      }
    })().finally(() => {
      initializePromise = null
    })

    return initializePromise
  },

  checkForUpdates: async () => {
    try {
      const result = await desktop.app.checkForUpdates()
      set({
        updateState: result.state,
        blockedDialogOpen: result.state.status === "blocked",
      })
      return result
    } catch (error) {
      const updateState = toErroredUpdateState(get().updateState, error, "check")
      set({ updateState, blockedDialogOpen: false })
      return { checked: false, state: updateState }
    }
  },

  installUpdate: async (options) => {
    try {
      const result = await desktop.app.installUpdate(options)
      set({
        updateState: result.state,
        blockedDialogOpen: result.state.status === "blocked",
      })
      return result
    } catch (error) {
      const updateState = toErroredUpdateState(get().updateState, error, "install")
      set({ updateState, blockedDialogOpen: false })
      return { accepted: false, completed: false, state: updateState }
    }
  },

  dismissUpdate: async () => {
    try {
      const updateState = await desktop.app.dismissUpdate()
      set({ updateState, blockedDialogOpen: false })
    } catch (error) {
      set((state) => ({
        blockedDialogOpen: false,
        updateState: toErroredUpdateState(state.updateState, error, state.updateState.errorContext),
      }))
    }
  },

  dismissToast: () =>
    set((state) => ({ toastDismissedForStatus: state.updateState.status })),

  setUpdateState: (updateState) =>
    set((state) => ({
      updateState,
      blockedDialogOpen: updateState.status === "blocked",
      toastDismissedForStatus:
        state.toastDismissedForStatus === updateState.status
          ? state.toastDismissedForStatus
          : null,
    })),

  closeBlockedDialog: () => set({ blockedDialogOpen: false }),
}))

export type {
  AppUpdateActionResult,
  AppUpdateCheckResult,
  AppUpdateState,
} from "@/desktop/client"
