import { create } from "zustand"

export interface TerminalTab {
  id: string
}

export interface ProjectTerminalState {
  tabs: TerminalTab[]
  activeTabId: string | null
  isCollapsed: boolean
}

interface TerminalStoreState {
  terminalStateByProject: Record<string, ProjectTerminalState>
  ensureProject: (projectId: string) => void
  addTerminal: (projectId: string) => string
  selectTerminal: (projectId: string, tabId: string) => void
  toggleProjectCollapsed: (projectId: string) => void
  setProjectCollapsed: (projectId: string, isCollapsed: boolean) => void
  closeTerminal: (projectId: string, tabId: string) => void
  getOrCreateActiveTabId: (projectId: string) => string
  removeProject: (projectId: string) => void
}

function createTerminalTab(projectId: string): TerminalTab {
  return {
    id: `${projectId}:${crypto.randomUUID()}`,
  }
}

function createProjectTerminalState(projectId: string): ProjectTerminalState {
  const firstTab = createTerminalTab(projectId)

  return {
    tabs: [firstTab],
    activeTabId: firstTab.id,
    isCollapsed: false,
  }
}

function normalizeProjectState(
  projectId: string,
  projectState: ProjectTerminalState | undefined,
): ProjectTerminalState {
  if (!projectState) {
    return createProjectTerminalState(projectId)
  }

  if (projectState.tabs.length === 0) {
    return {
      ...projectState,
      activeTabId: null,
    }
  }

  if (projectState.activeTabId && projectState.tabs.some((tab) => tab.id === projectState.activeTabId)) {
    return projectState
  }

  return {
    ...projectState,
    activeTabId: projectState.tabs[0]?.id ?? null,
  }
}

export const useTerminalStore = create<TerminalStoreState>((set, get) => ({
  terminalStateByProject: {},

  ensureProject: (projectId) => {
    set((current) => {
      if (current.terminalStateByProject[projectId]) {
        return current
      }

      return {
        terminalStateByProject: {
          ...current.terminalStateByProject,
          [projectId]: createProjectTerminalState(projectId),
        },
      }
    })
  },

  addTerminal: (projectId) => {
    const nextTab = createTerminalTab(projectId)

    set((current) => {
      const projectState = normalizeProjectState(projectId, current.terminalStateByProject[projectId])

      return {
        terminalStateByProject: {
          ...current.terminalStateByProject,
          [projectId]: {
            ...projectState,
            tabs: [...projectState.tabs, nextTab],
            activeTabId: nextTab.id,
            isCollapsed: false,
          },
        },
      }
    })

    return nextTab.id
  },

  selectTerminal: (projectId, tabId) => {
    set((current) => {
      const projectState = normalizeProjectState(projectId, current.terminalStateByProject[projectId])
      if (!projectState.tabs.some((tab) => tab.id === tabId)) {
        return current
      }

      return {
        terminalStateByProject: {
          ...current.terminalStateByProject,
          [projectId]: {
            ...projectState,
            activeTabId: tabId,
            isCollapsed: false,
          },
        },
      }
    })
  },

  toggleProjectCollapsed: (projectId) => {
    set((current) => {
      const projectState = normalizeProjectState(projectId, current.terminalStateByProject[projectId])

      return {
        terminalStateByProject: {
          ...current.terminalStateByProject,
          [projectId]: {
            ...projectState,
            isCollapsed: !projectState.isCollapsed,
          },
        },
      }
    })
  },

  setProjectCollapsed: (projectId, isCollapsed) => {
    set((current) => {
      const projectState = normalizeProjectState(projectId, current.terminalStateByProject[projectId])

      return {
        terminalStateByProject: {
          ...current.terminalStateByProject,
          [projectId]: {
            ...projectState,
            isCollapsed,
          },
        },
      }
    })
  },

  closeTerminal: (projectId, tabId) => {
    set((current) => {
      const projectState = normalizeProjectState(projectId, current.terminalStateByProject[projectId])
      const nextTabs = projectState.tabs.filter((tab) => tab.id !== tabId)

      if (nextTabs.length === 0) {
        return {
          terminalStateByProject: {
            ...current.terminalStateByProject,
            [projectId]: {
              ...projectState,
              tabs: [],
              activeTabId: null,
            },
          },
        }
      }

      const currentIndex = projectState.tabs.findIndex((tab) => tab.id === tabId)
      const fallbackTab = nextTabs[Math.max(0, currentIndex - 1)] ?? nextTabs[0]

      return {
        terminalStateByProject: {
          ...current.terminalStateByProject,
          [projectId]: {
            ...projectState,
            tabs: nextTabs,
            activeTabId: projectState.activeTabId === tabId ? fallbackTab?.id ?? null : projectState.activeTabId,
          },
        },
      }
    })
  },

  getOrCreateActiveTabId: (projectId) => {
    const projectState = normalizeProjectState(projectId, get().terminalStateByProject[projectId])

    if (projectState.activeTabId) {
      set((current) => ({
        terminalStateByProject: {
          ...current.terminalStateByProject,
          [projectId]: projectState,
        },
      }))
      return projectState.activeTabId
    }

    const nextTab = createTerminalTab(projectId)
    const nextProjectState = {
      ...projectState,
      tabs: [...projectState.tabs, nextTab],
      activeTabId: nextTab.id,
      isCollapsed: false,
    }

    set((current) => ({
      terminalStateByProject: {
        ...current.terminalStateByProject,
        [projectId]: nextProjectState,
      },
    }))

    return nextTab.id
  },

  removeProject: (projectId) => {
    set((current) => {
      if (!current.terminalStateByProject[projectId]) {
        return current
      }

      const nextState = { ...current.terminalStateByProject }
      delete nextState[projectId]

      return {
        terminalStateByProject: nextState,
      }
    })
  },
}))
