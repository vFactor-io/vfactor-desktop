import { create } from "zustand"
import { loadDesktopStore, type DesktopStoreHandle } from "@/desktop/client"
import type { Tab } from "@/features/chat/types"
import { createTerminalTab, isTerminalTab } from "@/features/terminal/utils/terminalTabs"

const STORE_FILE = "tabs.json"
const STORE_KEY = "tabState"

interface WorktreeTabs {
  tabs: Tab[]
  activeTabId: string | null
  activeTerminalTabId: string | null
}

interface PersistedTabState {
  tabsByWorktree: Record<string, WorktreeTabs>
}

interface TabState {
  currentWorktreeId: string | null
  tabsByWorktree: Record<string, WorktreeTabs>
  tabs: Tab[]
  activeTabId: string | null
  activeTerminalTabId: string | null
  isInitialized: boolean
  initialize: () => Promise<void>
  switchProject: (worktreeId: string | null) => void
  openChatSession: (sessionId: string, title?: string | null) => void
  ensureChatSessionTab: (sessionId: string, title?: string | null) => void
  updateChatSessionTitle: (sessionId: string, title?: string | null) => void
  openTerminalTab: (worktreeId: string, activate?: boolean) => string
  selectTerminalTab: (worktreeId: string, tabId: string) => void
  getOrCreateActiveTerminalTabId: (worktreeId: string) => string
  openFile: (filePath: string, fileName: string) => void
  openDiff: (filePath: string, fileName: string, previousFilePath?: string | null) => void
  rebaseWorktreeTabPaths: (worktreeId: string, previousPath: string, nextPath: string) => void
  removeWorktreeTabs: (worktreeId: string) => void
  reorderTabs: (tabIds: string[]) => void
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
}

const emptyWorktreeTabs: WorktreeTabs = { tabs: [], activeTabId: null, activeTerminalTabId: null }

let storeInstance: DesktopStoreHandle | null = null

async function getStore(): Promise<DesktopStoreHandle> {
  if (!storeInstance) {
    storeInstance = await loadDesktopStore(STORE_FILE)
  }
  return storeInstance
}

function normalizeTab(tab: Tab): Tab | null {
  if (tab.type === "chat-session") {
    return tab.sessionId
      ? {
          id: tab.id,
          type: "chat-session",
          title: tab.title || "New chat",
          sessionId: tab.sessionId,
        }
      : null
  }

  if (tab.type === "file") {
    return tab.filePath
      ? {
          id: tab.id,
          type: "file",
          title: tab.title,
          filePath: tab.filePath,
        }
      : null
  }

  if (tab.type === "terminal") {
    return {
      id: tab.id,
      type: "terminal",
      title: tab.title || "Terminal",
    }
  }

  return tab.filePath
    ? {
        id: tab.id,
        type: "diff",
        title: tab.title,
        filePath: tab.filePath,
        previousFilePath: tab.previousFilePath ?? null,
      }
    : null
}

function normalizeWorktreeTabs(worktreeTabs: WorktreeTabs | undefined): WorktreeTabs {
  if (!worktreeTabs) {
    return emptyWorktreeTabs
  }

  const tabs = worktreeTabs.tabs
    .map((tab) => normalizeTab(tab))
    .filter((tab): tab is Tab => tab != null)
  const activeTabId =
    worktreeTabs.activeTabId && tabs.some((tab) => tab.id === worktreeTabs.activeTabId)
      ? worktreeTabs.activeTabId
      : tabs[0]?.id ?? null
  const activeTerminalTabId =
    worktreeTabs.activeTerminalTabId && tabs.some((tab) => tab.id === worktreeTabs.activeTerminalTabId)
      ? worktreeTabs.activeTerminalTabId
      : tabs.find(isTerminalTab)?.id ?? null

  return { tabs, activeTabId, activeTerminalTabId }
}

function ensureTerminalTab(worktreeTabs: WorktreeTabs): WorktreeTabs {
  const terminalTabs = worktreeTabs.tabs.filter(isTerminalTab)

  if (terminalTabs.length > 0) {
    return {
      ...worktreeTabs,
      activeTerminalTabId:
        worktreeTabs.activeTerminalTabId && terminalTabs.some((tab) => tab.id === worktreeTabs.activeTerminalTabId)
          ? worktreeTabs.activeTerminalTabId
          : terminalTabs[0]?.id ?? null,
    }
  }

  const terminalTab = createTerminalTab()

  return {
    ...worktreeTabs,
    tabs: [...worktreeTabs.tabs, terminalTab],
    activeTerminalTabId: terminalTab.id,
  }
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/[\\/]+$/, "")
}

function rebasePath(
  value: string | null | undefined,
  previousRoot: string,
  nextRoot: string,
): string | null | undefined {
  if (!value) {
    return value
  }

  const normalizedPreviousRoot = trimTrailingSlashes(previousRoot)
  const normalizedNextRoot = trimTrailingSlashes(nextRoot)

  if (value === normalizedPreviousRoot) {
    return normalizedNextRoot
  }

  for (const separator of ["/", "\\"]) {
    const prefix = `${normalizedPreviousRoot}${separator}`
    if (value.startsWith(prefix)) {
      return `${normalizedNextRoot}${value.slice(normalizedPreviousRoot.length)}`
    }
  }

  return value
}

function rebaseTab(tab: Tab, previousRoot: string, nextRoot: string): Tab {
  if (tab.type === "file") {
    return {
      ...tab,
      filePath: rebasePath(tab.filePath, previousRoot, nextRoot) ?? tab.filePath,
    }
  }

  if (tab.type === "diff") {
    return {
      ...tab,
      filePath: rebasePath(tab.filePath, previousRoot, nextRoot) ?? tab.filePath,
      previousFilePath:
        rebasePath(tab.previousFilePath, previousRoot, nextRoot) ?? tab.previousFilePath ?? null,
    }
  }

  return tab
}

async function persistTabs(tabsByWorktree: Record<string, WorktreeTabs>): Promise<void> {
  const store = await getStore()
  await store.set(STORE_KEY, { tabsByWorktree } satisfies PersistedTabState)
  await store.save()
}

export const useTabStore = create<TabState>((set, get) => ({
  currentWorktreeId: null,
  tabsByWorktree: {},
  tabs: [],
  activeTabId: null,
  activeTerminalTabId: null,
  isInitialized: false,

  initialize: async () => {
    if (get().isInitialized) {
      return
    }

    try {
      const store = await getStore()
      const persisted = await store.get<PersistedTabState>(STORE_KEY)
      const tabsByWorktree = Object.fromEntries(
        Object.entries(persisted?.tabsByWorktree ?? {}).map(([worktreeId, worktreeTabs]) => [
          worktreeId,
          normalizeWorktreeTabs(worktreeTabs),
        ])
      )
      const currentWorktreeId = get().currentWorktreeId
      const currentWorktreeTabs = currentWorktreeId
        ? normalizeWorktreeTabs(tabsByWorktree[currentWorktreeId])
        : emptyWorktreeTabs

      set({
        tabsByWorktree,
        tabs: currentWorktreeTabs.tabs,
        activeTabId: currentWorktreeTabs.activeTabId,
        activeTerminalTabId: currentWorktreeTabs.activeTerminalTabId,
        isInitialized: true,
      })

    } catch (error) {
      console.error("Failed to initialize tab store:", error)
      set({
        tabsByWorktree: {},
        tabs: [],
        activeTabId: null,
        activeTerminalTabId: null,
        isInitialized: true,
      })
    }
  },

  switchProject: (worktreeId) => {
    const {
      currentWorktreeId,
      tabsByWorktree,
      tabs,
      activeTabId,
      activeTerminalTabId,
      isInitialized,
    } = get()

    let nextTabsByWorktree = tabsByWorktree
    if (currentWorktreeId && isInitialized) {
      nextTabsByWorktree = {
        ...tabsByWorktree,
        [currentWorktreeId]: normalizeWorktreeTabs({ tabs, activeTabId, activeTerminalTabId }),
      }
    }

    const nextWorktreeTabs = worktreeId
      ? normalizeWorktreeTabs(nextTabsByWorktree[worktreeId])
      : emptyWorktreeTabs

    if (worktreeId) {
      nextTabsByWorktree = {
        ...nextTabsByWorktree,
        [worktreeId]: nextWorktreeTabs,
      }
    }

    set({
      currentWorktreeId: worktreeId,
      tabsByWorktree: nextTabsByWorktree,
      tabs: nextWorktreeTabs.tabs,
      activeTabId: nextWorktreeTabs.activeTabId,
      activeTerminalTabId: nextWorktreeTabs.activeTerminalTabId,
    })

    if (isInitialized) {
      void persistTabs(nextTabsByWorktree)
    }
  },

  openChatSession: (sessionId, title) => {
    const currentTabs = get().tabs
    const existingTab = currentTabs.find(
      (tab) => tab.type === "chat-session" && tab.sessionId === sessionId
    )

    if (existingTab) {
      set({ activeTabId: existingTab.id })
      return
    }

    const newTab: Tab = {
      id: crypto.randomUUID(),
      type: "chat-session",
      title: title?.trim() || "New chat",
      sessionId,
    }

    const nextTabs = [...currentTabs, newTab]
    set({ tabs: nextTabs, activeTabId: newTab.id })

    const { currentWorktreeId, tabsByWorktree, activeTerminalTabId } = get()
    if (currentWorktreeId) {
      const nextTabsByWorktree = {
        ...tabsByWorktree,
        [currentWorktreeId]: { tabs: nextTabs, activeTabId: newTab.id, activeTerminalTabId },
      }
      set({ tabsByWorktree: nextTabsByWorktree })
      void persistTabs(nextTabsByWorktree)
    }
  },

  ensureChatSessionTab: (sessionId, title) => {
    const existingTab = get().tabs.find(
      (tab) => tab.type === "chat-session" && tab.sessionId === sessionId
    )

    if (existingTab) {
      if (title && title !== existingTab.title) {
        get().updateChatSessionTitle(sessionId, title)
      }
      return
    }

    get().openChatSession(sessionId, title)
  },

  updateChatSessionTitle: (sessionId, title) => {
    const nextTitle = title?.trim() || "New chat"
    const nextTabs = get().tabs.map((tab) =>
      tab.type === "chat-session" && tab.sessionId === sessionId
        ? { ...tab, title: nextTitle }
        : tab
    )

    set({ tabs: nextTabs })

    const { currentWorktreeId, tabsByWorktree } = get()
    if (currentWorktreeId) {
      const nextTabsByWorktree = {
        ...tabsByWorktree,
        [currentWorktreeId]: {
          tabs: nextTabs,
          activeTabId: get().activeTabId,
          activeTerminalTabId: get().activeTerminalTabId,
        },
      }
      set({ tabsByWorktree: nextTabsByWorktree })
      void persistTabs(nextTabsByWorktree)
    }
  },

  openTerminalTab: (worktreeId, activate = true) => {
    const current = get()
    const baseWorktreeTabs =
      current.currentWorktreeId === worktreeId
        ? normalizeWorktreeTabs({
            tabs: current.tabs,
            activeTabId: current.activeTabId,
            activeTerminalTabId: current.activeTerminalTabId,
          })
        : normalizeWorktreeTabs(current.tabsByWorktree[worktreeId])

    const newTab = createTerminalTab()
    const nextWorktreeTabs: WorktreeTabs = {
      tabs: [...baseWorktreeTabs.tabs, newTab],
      activeTabId: activate ? newTab.id : baseWorktreeTabs.activeTabId,
      activeTerminalTabId: newTab.id,
    }
    const nextTabsByWorktree = {
      ...current.tabsByWorktree,
      [worktreeId]: nextWorktreeTabs,
    }

    set({
      tabsByWorktree: nextTabsByWorktree,
      ...(current.currentWorktreeId === worktreeId
        ? {
            tabs: nextWorktreeTabs.tabs,
            activeTabId: nextWorktreeTabs.activeTabId,
            activeTerminalTabId: nextWorktreeTabs.activeTerminalTabId,
          }
        : {}),
    })

    if (current.isInitialized) {
      void persistTabs(nextTabsByWorktree)
    }

    return newTab.id
  },

  selectTerminalTab: (worktreeId, tabId) => {
    const current = get()
    const baseWorktreeTabs =
      current.currentWorktreeId === worktreeId
        ? normalizeWorktreeTabs({
            tabs: current.tabs,
            activeTabId: current.activeTabId,
            activeTerminalTabId: current.activeTerminalTabId,
          })
        : normalizeWorktreeTabs(current.tabsByWorktree[worktreeId])

    if (!baseWorktreeTabs.tabs.some((tab) => tab.id === tabId && isTerminalTab(tab))) {
      return
    }

    const nextWorktreeTabs: WorktreeTabs = {
      ...baseWorktreeTabs,
      activeTabId: tabId,
      activeTerminalTabId: tabId,
    }
    const nextTabsByWorktree = {
      ...current.tabsByWorktree,
      [worktreeId]: nextWorktreeTabs,
    }

    set({
      tabsByWorktree: nextTabsByWorktree,
      ...(current.currentWorktreeId === worktreeId
        ? {
            tabs: nextWorktreeTabs.tabs,
            activeTabId: nextWorktreeTabs.activeTabId,
            activeTerminalTabId: nextWorktreeTabs.activeTerminalTabId,
          }
        : {}),
    })

    if (current.isInitialized) {
      void persistTabs(nextTabsByWorktree)
    }
  },

  getOrCreateActiveTerminalTabId: (worktreeId) => {
    const current = get()
    const normalizedWorktreeTabs =
      current.currentWorktreeId === worktreeId
        ? normalizeWorktreeTabs({
            tabs: current.tabs,
            activeTabId: current.activeTabId,
            activeTerminalTabId: current.activeTerminalTabId,
          })
        : normalizeWorktreeTabs(current.tabsByWorktree[worktreeId])
    const worktreeTabs =
      current.currentWorktreeId === worktreeId
        ? normalizedWorktreeTabs
        : ensureTerminalTab(normalizedWorktreeTabs)

    if (
      current.currentWorktreeId !== worktreeId &&
      (worktreeTabs.tabs.length !== normalizedWorktreeTabs.tabs.length ||
        worktreeTabs.activeTerminalTabId !== normalizedWorktreeTabs.activeTerminalTabId)
    ) {
      const nextTabsByWorktree = {
        ...current.tabsByWorktree,
        [worktreeId]: worktreeTabs,
      }

      set({ tabsByWorktree: nextTabsByWorktree })

      if (current.isInitialized) {
        void persistTabs(nextTabsByWorktree)
      }
    }

    if (
      worktreeTabs.activeTerminalTabId &&
      worktreeTabs.tabs.some((tab) => tab.id === worktreeTabs.activeTerminalTabId && isTerminalTab(tab))
    ) {
      return worktreeTabs.activeTerminalTabId
    }

    const existingTerminalTab = worktreeTabs.tabs.find(isTerminalTab)
    if (existingTerminalTab) {
      const nextWorktreeTabs = {
        ...worktreeTabs,
        activeTerminalTabId: existingTerminalTab.id,
      }
      const nextTabsByWorktree = {
        ...current.tabsByWorktree,
        [worktreeId]: nextWorktreeTabs,
      }

      set({
        tabsByWorktree: nextTabsByWorktree,
        ...(current.currentWorktreeId === worktreeId
          ? { activeTerminalTabId: nextWorktreeTabs.activeTerminalTabId }
          : {}),
      })

      if (current.isInitialized) {
        void persistTabs(nextTabsByWorktree)
      }

      return existingTerminalTab.id
    }

    return get().openTerminalTab(worktreeId, false)
  },

  openFile: (filePath, fileName) => {
    const existingTab = get().tabs.find(
      (tab) => tab.type === "file" && tab.filePath === filePath
    )

    if (existingTab) {
      set({ activeTabId: existingTab.id })
      return
    }

    const newTab: Tab = {
      id: crypto.randomUUID(),
      type: "file",
      title: fileName,
      filePath,
    }

    const nextTabs = [...get().tabs, newTab]
    set({ tabs: nextTabs, activeTabId: newTab.id })

    const { currentWorktreeId, tabsByWorktree } = get()
    if (currentWorktreeId) {
      const nextTabsByWorktree = {
        ...tabsByWorktree,
        [currentWorktreeId]: {
          tabs: nextTabs,
          activeTabId: newTab.id,
          activeTerminalTabId: get().activeTerminalTabId,
        },
      }
      set({ tabsByWorktree: nextTabsByWorktree })
      void persistTabs(nextTabsByWorktree)
    }
  },

  openDiff: (filePath, fileName, previousFilePath) => {
    const existingTab = get().tabs.find(
      (tab) => tab.type === "diff" && tab.filePath === filePath
    )

    if (existingTab) {
      set({ activeTabId: existingTab.id })
      return
    }

    const newTab: Tab = {
      id: crypto.randomUUID(),
      type: "diff",
      title: fileName,
      filePath,
      previousFilePath: previousFilePath ?? null,
    }

    const nextTabs = [...get().tabs, newTab]
    set({ tabs: nextTabs, activeTabId: newTab.id })

    const { currentWorktreeId, tabsByWorktree } = get()
    if (currentWorktreeId) {
      const nextTabsByWorktree = {
        ...tabsByWorktree,
        [currentWorktreeId]: {
          tabs: nextTabs,
          activeTabId: newTab.id,
          activeTerminalTabId: get().activeTerminalTabId,
        },
      }
      set({ tabsByWorktree: nextTabsByWorktree })
      void persistTabs(nextTabsByWorktree)
    }
  },

  rebaseWorktreeTabPaths: (worktreeId, previousPath, nextPath) => {
    const current = get()
    const worktreeTabs = normalizeWorktreeTabs(current.tabsByWorktree[worktreeId])
    const nextTabs = worktreeTabs.tabs.map((tab) => rebaseTab(tab, previousPath, nextPath))
    const changed = nextTabs.some((tab, index) => tab !== worktreeTabs.tabs[index])

    if (!changed) {
      return
    }

    const nextWorktreeTabs: WorktreeTabs = {
      ...worktreeTabs,
      tabs: nextTabs,
    }
    const nextTabsByWorktree = {
      ...current.tabsByWorktree,
      [worktreeId]: nextWorktreeTabs,
    }

    set({
      tabsByWorktree: nextTabsByWorktree,
      ...(current.currentWorktreeId === worktreeId ? { tabs: nextTabs } : {}),
    })

    if (current.isInitialized) {
      void persistTabs(nextTabsByWorktree)
    }
  },

  removeWorktreeTabs: (worktreeId) => {
    const { currentWorktreeId, tabsByWorktree } = get()
    const nextTabsByWorktree = { ...tabsByWorktree }
    delete nextTabsByWorktree[worktreeId]

    set({
      tabsByWorktree: nextTabsByWorktree,
      ...(currentWorktreeId === worktreeId
        ? {
            currentWorktreeId: null,
            tabs: [],
            activeTabId: null,
            activeTerminalTabId: null,
          }
        : {}),
    })

    void persistTabs(nextTabsByWorktree)
  },

  reorderTabs: (tabIds) => {
    const { tabs, activeTabId, activeTerminalTabId, currentWorktreeId, tabsByWorktree } = get()
    const tabById = new Map(tabs.map((tab) => [tab.id, tab]))
    const nextTabs = tabIds.map((id) => tabById.get(id)).filter((tab): tab is Tab => tab != null)

    if (nextTabs.length !== tabs.length) {
      return
    }

    set({ tabs: nextTabs })

    if (currentWorktreeId) {
      const nextTabsByWorktree = {
        ...tabsByWorktree,
        [currentWorktreeId]: { tabs: nextTabs, activeTabId, activeTerminalTabId },
      }
      set({ tabsByWorktree: nextTabsByWorktree })
      void persistTabs(nextTabsByWorktree)
    }
  },

  closeTab: (tabId) => {
    const { tabs, activeTabId, activeTerminalTabId } = get()
    const nextTabs = tabs.filter((tab) => tab.id !== tabId)
    const nextTerminalTabs = nextTabs.filter(isTerminalTab)
    const nextActiveTabId =
      activeTabId === tabId ? nextTabs[nextTabs.length - 1]?.id ?? null : activeTabId
    const nextActiveTerminalTabId =
      activeTerminalTabId === tabId
        ? nextTerminalTabs[nextTerminalTabs.length - 1]?.id ?? null
        : activeTerminalTabId

    set({ tabs: nextTabs, activeTabId: nextActiveTabId, activeTerminalTabId: nextActiveTerminalTabId })

    const { currentWorktreeId, tabsByWorktree } = get()
    if (currentWorktreeId) {
      const nextTabsByWorktree = {
        ...tabsByWorktree,
        [currentWorktreeId]: {
          tabs: nextTabs,
          activeTabId: nextActiveTabId,
          activeTerminalTabId: nextActiveTerminalTabId,
        },
      }
      set({ tabsByWorktree: nextTabsByWorktree })
      void persistTabs(nextTabsByWorktree)
    }
  },

  setActiveTab: (tabId) => {
    const nextTab = get().tabs.find((tab) => tab.id === tabId)
    const nextActiveTerminalTabId = nextTab && isTerminalTab(nextTab) ? tabId : get().activeTerminalTabId

    set({ activeTabId: tabId, activeTerminalTabId: nextActiveTerminalTabId })

    const { currentWorktreeId, tabsByWorktree, tabs } = get()
    if (currentWorktreeId) {
      const nextTabsByWorktree = {
        ...tabsByWorktree,
        [currentWorktreeId]: {
          tabs,
          activeTabId: tabId,
          activeTerminalTabId: nextActiveTerminalTabId,
        },
      }
      set({ tabsByWorktree: nextTabsByWorktree })
      void persistTabs(nextTabsByWorktree)
    }
  },
}))
