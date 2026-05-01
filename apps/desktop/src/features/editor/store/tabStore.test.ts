import { beforeEach, describe, expect, mock, test } from "bun:test"

const storeData = new Map<string, unknown>()

const desktopStore = {
  get: async <T>(key: string): Promise<T | null> =>
    storeData.has(key) ? (storeData.get(key) as T) : null,
  set: async (key: string, value: unknown) => {
    storeData.set(key, value)
  },
  save: async () => {},
}

mock.module("@/desktop/client", () => ({
  loadDesktopStore: async () => desktopStore,
}))

const { useTabStore } = await import("./tabStore")
const { isTerminalTab } = await import("@/features/terminal/utils/terminalTabs")

describe("tabStore", () => {
  beforeEach(() => {
    storeData.clear()
    useTabStore.setState({
      currentWorktreeId: null,
      tabsByWorktree: {},
      tabs: [],
      activeTabId: null,
      activeTerminalTabId: null,
      isInitialized: false,
    })
  })

  test("does not synthesize a terminal tab when initializing an empty worktree", async () => {
    useTabStore.setState({ currentWorktreeId: "worktree-1" })

    await useTabStore.getState().initialize()

    expect(useTabStore.getState().tabs).toEqual([])
    expect(useTabStore.getState().activeTabId).toBeNull()
    expect(useTabStore.getState().activeTerminalTabId).toBeNull()
  })

  test("does not synthesize a terminal tab when switching to a new worktree", () => {
    useTabStore.setState({ isInitialized: true })

    useTabStore.getState().switchProject("worktree-1")

    expect(useTabStore.getState().tabs).toEqual([])
    expect(useTabStore.getState().tabsByWorktree["worktree-1"]?.tabs).toEqual([])
  })

  test("still creates a terminal tab for explicit terminal commands", () => {
    useTabStore.setState({
      currentWorktreeId: "worktree-1",
      isInitialized: true,
    })

    const tabId = useTabStore.getState().getOrCreateActiveTerminalTabId("worktree-1")

    expect(useTabStore.getState().tabs.filter(isTerminalTab)).toHaveLength(1)
    expect(useTabStore.getState().activeTerminalTabId).toBe(tabId)
  })

  test("ensures chat session tabs in the requested inactive worktree", () => {
    useTabStore.setState({
      currentWorktreeId: "worktree-1",
      tabs: [],
      activeTabId: null,
      tabsByWorktree: {
        "worktree-2": { tabs: [], activeTabId: null, activeTerminalTabId: null },
      },
      isInitialized: true,
    })

    useTabStore.getState().ensureChatSessionTab("session-1", "Debug auth flow", "worktree-2")

    expect(useTabStore.getState().tabs).toEqual([])
    expect(useTabStore.getState().activeTabId).toBeNull()
    expect(useTabStore.getState().tabsByWorktree["worktree-2"]?.tabs).toMatchObject([
      {
        type: "chat-session",
        title: "Debug auth flow",
        sessionId: "session-1",
      },
    ])
    expect(useTabStore.getState().tabsByWorktree["worktree-2"]?.activeTabId).toBe(
      useTabStore.getState().tabsByWorktree["worktree-2"]?.tabs[0]?.id
    )
  })

  test("closes chat session tabs in the requested inactive worktree", () => {
    useTabStore.setState({
      currentWorktreeId: "worktree-1",
      tabs: [],
      activeTabId: null,
      tabsByWorktree: {
        "worktree-2": { tabs: [], activeTabId: null, activeTerminalTabId: null },
      },
      isInitialized: true,
    })

    useTabStore.getState().ensureChatSessionTab("session-1", "Debug auth flow", "worktree-2")
    useTabStore.getState().closeChatSessionTab("session-1", "worktree-2")

    expect(useTabStore.getState().tabs).toEqual([])
    expect(useTabStore.getState().tabsByWorktree["worktree-2"]?.tabs).toEqual([])
    expect(useTabStore.getState().tabsByWorktree["worktree-2"]?.activeTabId).toBeNull()
  })
})
