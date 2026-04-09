import { beforeEach, describe, expect, mock, test } from "bun:test"

const initialUpdateState = {
  enabled: true,
  status: "idle",
  currentVersion: "0.1.1",
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
} as const

const getUpdateStateMock = mock(async () => initialUpdateState)
const checkForUpdatesMock = mock(async () => ({
  checked: true,
  state: {
    ...initialUpdateState,
    status: "up-to-date",
    checkedAt: 123,
  },
}))
const installUpdateMock = mock(async () => ({
  accepted: true,
  completed: true,
  state: {
    ...initialUpdateState,
    status: "installing",
    downloadedVersion: "0.2.0",
  },
}))
const dismissUpdateMock = mock(async () => ({
  ...initialUpdateState,
  status: "ready",
  downloadedVersion: "0.2.0",
  canDismiss: false,
  canInstall: true,
}))

mock.module("zustand", () => ({
  create: <T>(
    initializer: (
      set: (partial: Partial<T> | ((state: T) => Partial<T>)) => void,
      get: () => T,
    ) => T,
  ) => {
    let state!: T

    const getState = () => state
    const setState = (partial: Partial<T> | ((currentState: T) => Partial<T>)) => {
      const nextState = typeof partial === "function" ? partial(state) : partial
      state = {
        ...state,
        ...nextState,
      }
    }

    state = initializer(setState, getState)

    const store = ((selector?: (currentState: T) => unknown) =>
      selector ? selector(state) : state) as ((selector?: (currentState: T) => unknown) => unknown) & {
      getState: () => T
      setState: (partial: Partial<T>) => void
    }

    store.getState = getState
    store.setState = (partial: Partial<T>) => {
      state = {
        ...state,
        ...partial,
      }
    }

    return store
  },
}))

mock.module("@/desktop/client", () => ({
  desktop: {
    app: {
      getUpdateState: getUpdateStateMock,
      checkForUpdates: checkForUpdatesMock,
      installUpdate: installUpdateMock,
      dismissUpdate: dismissUpdateMock,
      onUpdateState: () => () => {},
    },
  },
}))

const { useAppUpdateStore } = await import("./updateStore")

function resetUpdateStore() {
  useAppUpdateStore.setState({
    updateState: {
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
    },
    hasInitialized: false,
    blockedDialogOpen: false,
  })
}

describe("useAppUpdateStore", () => {
  beforeEach(() => {
    getUpdateStateMock.mockReset()
    getUpdateStateMock.mockResolvedValue(initialUpdateState)
    checkForUpdatesMock.mockReset()
    checkForUpdatesMock.mockResolvedValue({
      checked: true,
      state: {
        ...initialUpdateState,
        status: "up-to-date",
        checkedAt: 123,
      },
    })
    installUpdateMock.mockReset()
    installUpdateMock.mockResolvedValue({
      accepted: true,
      completed: true,
      state: {
        ...initialUpdateState,
        status: "installing",
        downloadedVersion: "0.2.0",
      },
    })
    dismissUpdateMock.mockReset()
    dismissUpdateMock.mockResolvedValue({
      ...initialUpdateState,
      status: "ready",
      downloadedVersion: "0.2.0",
      canDismiss: false,
      canInstall: true,
    })
    resetUpdateStore()
  })

  test("hydrates the initial snapshot from the main process", async () => {
    await useAppUpdateStore.getState().initialize()

    expect(getUpdateStateMock).toHaveBeenCalled()
    expect(useAppUpdateStore.getState().updateState).toEqual(initialUpdateState)
  })

  test("allows initialization to retry after a failed first attempt", async () => {
    getUpdateStateMock
      .mockRejectedValueOnce(new Error("Bridge offline"))
      .mockResolvedValueOnce(initialUpdateState)

    await useAppUpdateStore.getState().initialize()
    expect(useAppUpdateStore.getState().hasInitialized).toBe(false)

    await useAppUpdateStore.getState().initialize()

    expect(getUpdateStateMock).toHaveBeenCalledTimes(2)
    expect(useAppUpdateStore.getState().hasInitialized).toBe(true)
    expect(useAppUpdateStore.getState().updateState).toEqual(initialUpdateState)
  })

  test("mirrors manual check results from the main process", async () => {
    const result = await useAppUpdateStore.getState().checkForUpdates()

    expect(result.checked).toBe(true)
    expect(useAppUpdateStore.getState().updateState.status).toBe("up-to-date")
    expect(useAppUpdateStore.getState().blockedDialogOpen).toBe(false)
  })

  test("opens the blocked dialog when install is blocked by active work", async () => {
    installUpdateMock.mockResolvedValue({
      accepted: true,
      completed: false,
      state: {
        ...initialUpdateState,
        status: "blocked",
        downloadedVersion: "0.2.0",
        canInstall: true,
        activeWork: {
          activeTurns: 1,
          activeTerminalSessions: 0,
          labels: ["1 active coding turn"],
        },
      },
    })

    const result = await useAppUpdateStore.getState().installUpdate()

    expect(result.state.status).toBe("blocked")
    expect(useAppUpdateStore.getState().blockedDialogOpen).toBe(true)
  })

  test("converts thrown IPC failures into visible error state", async () => {
    checkForUpdatesMock.mockRejectedValue(new Error("Bridge offline"))

    const result = await useAppUpdateStore.getState().checkForUpdates()

    expect(result.checked).toBe(false)
    expect(useAppUpdateStore.getState().updateState.status).toBe("error")
    expect(useAppUpdateStore.getState().updateState.message).toContain("Bridge offline")
  })

  test("dismiss clears the blocked dialog and mirrors the returned snapshot", async () => {
    useAppUpdateStore.setState({
      blockedDialogOpen: true,
    })

    await useAppUpdateStore.getState().dismissUpdate()

    expect(dismissUpdateMock).toHaveBeenCalled()
    expect(useAppUpdateStore.getState().blockedDialogOpen).toBe(false)
    expect(useAppUpdateStore.getState().updateState.status).toBe("ready")
  })

  test("closes the blocked dialog when a later snapshot is no longer blocked", () => {
    useAppUpdateStore.setState({
      blockedDialogOpen: true,
    })

    useAppUpdateStore.getState().setUpdateState({
      ...initialUpdateState,
      status: "ready",
      downloadedVersion: "0.2.0",
      canInstall: true,
    })

    expect(useAppUpdateStore.getState().blockedDialogOpen).toBe(false)
  })
})
