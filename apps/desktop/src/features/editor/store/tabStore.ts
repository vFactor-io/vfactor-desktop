import { create } from "zustand"
import { loadDesktopStore, type DesktopStoreHandle } from "@/desktop/client"
import type { Tab } from "@/features/chat/types"

const STORE_FILE = "tabs.json"
const STORE_KEY = "tabState"

interface WorktreeTabs {
  tabs: Tab[]
  activeTabId: string | null
}

interface PersistedTabState {
  tabsByWorktree: Record<string, WorktreeTabs>
}

interface TabState {
  currentWorktreeId: string | null
  tabsByWorktree: Record<string, WorktreeTabs>
  tabs: Tab[]
  activeTabId: string | null
  isInitialized: boolean
  initialize: () => Promise<void>
  switchProject: (worktreeId: string | null) => void
  openChatSession: (sessionId: string, title?: string | null) => void
  ensureChatSessionTab: (sessionId: string, title?: string | null) => void
  updateChatSessionTitle: (sessionId: string, title?: string | null) => void
  openFile: (filePath: string, fileName: string) => void
  openDiff: (filePath: string, fileName: string, previousFilePath?: string | null) => void
  removeWorktreeTabs: (worktreeId: string) => void
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
}

const emptyWorktreeTabs: WorktreeTabs = { tabs: [], activeTabId: null }

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

  return { tabs, activeTabId }
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
        isInitialized: true,
      })
    } catch (error) {
      console.error("Failed to initialize tab store:", error)
      set({
        tabsByWorktree: {},
        tabs: [],
        activeTabId: null,
        isInitialized: true,
      })
    }
  },

  switchProject: (worktreeId) => {
    const { currentWorktreeId, tabsByWorktree, tabs, activeTabId, isInitialized } = get()

    let nextTabsByWorktree = tabsByWorktree
    if (currentWorktreeId && isInitialized) {
      nextTabsByWorktree = {
        ...tabsByWorktree,
        [currentWorktreeId]: normalizeWorktreeTabs({ tabs, activeTabId }),
      }
    }

    const nextWorktreeTabs = worktreeId
      ? normalizeWorktreeTabs(nextTabsByWorktree[worktreeId])
      : emptyWorktreeTabs

    set({
      currentWorktreeId: worktreeId,
      tabsByWorktree: nextTabsByWorktree,
      tabs: nextWorktreeTabs.tabs,
      activeTabId: nextWorktreeTabs.activeTabId,
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

    const { currentWorktreeId, tabsByWorktree } = get()
    if (currentWorktreeId) {
      const nextTabsByWorktree = {
        ...tabsByWorktree,
        [currentWorktreeId]: { tabs: nextTabs, activeTabId: newTab.id },
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
        },
      }
      set({ tabsByWorktree: nextTabsByWorktree })
      void persistTabs(nextTabsByWorktree)
    }
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
        },
      }
      set({ tabsByWorktree: nextTabsByWorktree })
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
          }
        : {}),
    })

    void persistTabs(nextTabsByWorktree)
  },

  closeTab: (tabId) => {
    const { tabs, activeTabId } = get()
    const nextTabs = tabs.filter((tab) => tab.id !== tabId)
    const nextActiveTabId =
      activeTabId === tabId ? nextTabs[nextTabs.length - 1]?.id ?? null : activeTabId

    set({ tabs: nextTabs, activeTabId: nextActiveTabId })

    const { currentWorktreeId, tabsByWorktree } = get()
    if (currentWorktreeId) {
      const nextTabsByWorktree = {
        ...tabsByWorktree,
        [currentWorktreeId]: {
          tabs: nextTabs,
          activeTabId: nextActiveTabId,
        },
      }
      set({ tabsByWorktree: nextTabsByWorktree })
      void persistTabs(nextTabsByWorktree)
    }
  },

  setActiveTab: (tabId) => {
    set({ activeTabId: tabId })

    const { currentWorktreeId, tabsByWorktree, tabs } = get()
    if (currentWorktreeId) {
      const nextTabsByWorktree = {
        ...tabsByWorktree,
        [currentWorktreeId]: {
          tabs,
          activeTabId: tabId,
        },
      }
      set({ tabsByWorktree: nextTabsByWorktree })
      void persistTabs(nextTabsByWorktree)
    }
  },
}))
