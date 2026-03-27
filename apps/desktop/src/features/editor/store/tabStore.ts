import { create } from "zustand"
import type { Tab } from "@/features/chat/types"

interface ProjectTabs {
  tabs: Tab[]
  activeTabId: string | null
}

interface TabState {
  currentProjectId: string | null
  tabsByProject: Record<string, ProjectTabs>

  // Derived state (current project's tabs)
  tabs: Tab[]
  activeTabId: string | null

  // Actions
  switchProject: (projectId: string | null) => void
  openFile: (filePath: string, fileName: string) => void
  openDiff: (filePath: string, fileName: string, previousFilePath?: string | null) => void
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
}

const emptyProjectTabs: ProjectTabs = { tabs: [], activeTabId: null }

export const useTabStore = create<TabState>((set, get) => ({
  currentProjectId: null,
  tabsByProject: {},
  tabs: [],
  activeTabId: null,

  switchProject: (projectId: string | null) => {
    const { currentProjectId, tabsByProject, tabs, activeTabId } = get()

    // Save current project's tabs (if we have a current project)
    let updatedTabsByProject = tabsByProject
    if (currentProjectId) {
      updatedTabsByProject = {
        ...tabsByProject,
        [currentProjectId]: { tabs, activeTabId },
      }
    }

    // Load new project's tabs
    const newProjectTabs = projectId
      ? updatedTabsByProject[projectId] ?? emptyProjectTabs
      : emptyProjectTabs

    set({
      currentProjectId: projectId,
      tabsByProject: updatedTabsByProject,
      tabs: newProjectTabs.tabs,
      activeTabId: newProjectTabs.activeTabId,
    })
  },

  openFile: (filePath: string, fileName: string) => {
    const { tabs } = get()

    // Check if file is already open
    const existingTab = tabs.find(
      (tab) => tab.type === "file" && tab.filePath === filePath
    )

    if (existingTab) {
      // File already open - just focus it
      set({ activeTabId: existingTab.id })
      return
    }

    // Create new tab for the file
    const newTab: Tab = {
      id: crypto.randomUUID(),
      type: "file",
      title: fileName,
      filePath,
    }

    set({
      tabs: [...tabs, newTab],
      activeTabId: newTab.id,
    })
  },

  openDiff: (filePath: string, fileName: string, previousFilePath?: string | null) => {
    const { tabs } = get()

    const existingTab = tabs.find(
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

    set({
      tabs: [...tabs, newTab],
      activeTabId: newTab.id,
    })
  },

  closeTab: (tabId: string) => {
    const { tabs, activeTabId } = get()
    const updatedTabs = tabs.filter((tab) => tab.id !== tabId)

    // If we closed the active tab, select another
    let newActiveId = activeTabId
    if (activeTabId === tabId) {
      newActiveId = updatedTabs.length > 0 ? updatedTabs[updatedTabs.length - 1].id : null
    }

    set({ tabs: updatedTabs, activeTabId: newActiveId })
  },

  setActiveTab: (tabId: string) => {
    set({ activeTabId: tabId })
  },
}))
