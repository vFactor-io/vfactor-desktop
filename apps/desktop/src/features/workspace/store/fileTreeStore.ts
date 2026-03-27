import { create } from "zustand"
import type { FileTreeItem } from "@/features/version-control/types"
import { applyProjectFileSystemEvent } from "@/features/workspace/utils/fileTree"
import { readProjectFiles } from "@/features/workspace/utils/fileSystem"
import {
  listenToProjectFileEvents,
  startProjectFileWatcher,
  stopProjectFileWatcher,
  type ProjectFileSystemEvent,
} from "@/features/workspace/utils/projectWatcher"

interface FileTreeState {
  activeProjectPath: string | null
  dataByProjectPath: Record<string, Record<string, FileTreeItem>>
  loadingByProjectPath: Record<string, boolean>
  lastEventByProjectPath: Record<string, ProjectFileSystemEvent | null>
  isInitialized: boolean
  initialize: () => Promise<void>
  setActiveProjectPath: (projectPath: string | null) => Promise<void>
  refreshActiveProject: () => Promise<void>
}

let unlistenProjectEvents: (() => void) | null = null
let initializePromise: Promise<void> | null = null
let switchingProjectPromise: Promise<void> | null = null
let eventFlushTimeoutId: ReturnType<typeof setTimeout> | null = null
const queuedEventsByProject = new Map<string, ProjectFileSystemEvent[]>()

function clearQueuedEvents(projectPath?: string | null): void {
  if (projectPath) {
    queuedEventsByProject.delete(projectPath)
    return
  }

  queuedEventsByProject.clear()
}

function setProjectLoading(
  set: (updater: (state: FileTreeState) => Partial<FileTreeState>) => void,
  projectPath: string,
  isLoading: boolean
): void {
  set((state) => ({
    loadingByProjectPath: {
      ...state.loadingByProjectPath,
      [projectPath]: isLoading,
    },
  }))
}

async function loadProjectTree(projectPath: string): Promise<Record<string, FileTreeItem>> {
  return readProjectFiles(projectPath)
}

async function applyQueuedEventsForProject(
  projectPath: string,
  get: () => FileTreeState,
  set: (updater: (state: FileTreeState) => Partial<FileTreeState>) => void
): Promise<void> {
  const queuedEvents = queuedEventsByProject.get(projectPath) ?? []
  queuedEventsByProject.delete(projectPath)

  if (queuedEvents.length === 0) {
    return
  }

  let nextTree = get().dataByProjectPath[projectPath] ?? {}

  for (const event of queuedEvents) {
    const patchedTree = await applyProjectFileSystemEvent(nextTree, projectPath, event)
    if (!patchedTree) {
      const freshTree = await loadProjectTree(projectPath)
      set((state) => ({
        dataByProjectPath: {
          ...state.dataByProjectPath,
          [projectPath]: freshTree,
        },
      }))
      return
    }

    nextTree = patchedTree
  }

  set((state) => ({
    dataByProjectPath: {
      ...state.dataByProjectPath,
      [projectPath]: nextTree,
    },
  }))
}

function scheduleEventFlush(
  get: () => FileTreeState,
  set: (updater: (state: FileTreeState) => Partial<FileTreeState>) => void
): void {
  if (eventFlushTimeoutId) {
    clearTimeout(eventFlushTimeoutId)
  }

  eventFlushTimeoutId = setTimeout(() => {
    eventFlushTimeoutId = null

    void (async () => {
      const { activeProjectPath, loadingByProjectPath } = get()
      if (!activeProjectPath || loadingByProjectPath[activeProjectPath]) {
        return
      }

      await applyQueuedEventsForProject(activeProjectPath, get, set)
    })()
  }, 75)
}

async function ensureProjectListener(
  get: () => FileTreeState,
  set: (updater: (state: FileTreeState) => Partial<FileTreeState>) => void
): Promise<void> {
  if (unlistenProjectEvents) {
    return
  }

  unlistenProjectEvents = await listenToProjectFileEvents((event) => {
    const activeProjectPath = get().activeProjectPath
    if (!activeProjectPath || event.rootPath !== activeProjectPath) {
      return
    }

    const existing = queuedEventsByProject.get(event.rootPath) ?? []
    existing.push(event)
    queuedEventsByProject.set(event.rootPath, existing)
    set((state) => ({
      lastEventByProjectPath: {
        ...state.lastEventByProjectPath,
        [event.rootPath]: event,
      },
    }))
    scheduleEventFlush(get, set)
  })
}

export const useFileTreeStore = create<FileTreeState>((set, get) => ({
  activeProjectPath: null,
  dataByProjectPath: {},
  loadingByProjectPath: {},
  lastEventByProjectPath: {},
  isInitialized: false,

  initialize: async () => {
    if (get().isInitialized) {
      return
    }

    if (initializePromise) {
      return initializePromise
    }

    initializePromise = (async () => {
      await ensureProjectListener(get, set)
      set({ isInitialized: true })
    })().finally(() => {
      initializePromise = null
    })

    return initializePromise
  },

  setActiveProjectPath: async (projectPath) => {
    if (switchingProjectPromise) {
      await switchingProjectPromise
    }

    switchingProjectPromise = (async () => {
      await get().initialize()

      const previousProjectPath = get().activeProjectPath
      if (previousProjectPath === projectPath) {
        return
      }

      if (eventFlushTimeoutId) {
        clearTimeout(eventFlushTimeoutId)
        eventFlushTimeoutId = null
      }

      clearQueuedEvents(previousProjectPath)

      if (!projectPath) {
        await stopProjectFileWatcher()
        set({ activeProjectPath: null })
        return
      }

      set({ activeProjectPath: projectPath })
      setProjectLoading(set, projectPath, true)

      try {
        await startProjectFileWatcher(projectPath)
      } catch (error) {
        console.error("Failed to start project file watcher:", error)
      }

      try {
        const tree = await loadProjectTree(projectPath)
        set((state) => ({
          dataByProjectPath: {
            ...state.dataByProjectPath,
            [projectPath]: tree,
          },
        }))
      } catch (error) {
        console.error("Failed to load project files:", error)
        set((state) => ({
          dataByProjectPath: {
            ...state.dataByProjectPath,
            [projectPath]: {},
          },
        }))
      } finally {
        setProjectLoading(set, projectPath, false)
      }

      await applyQueuedEventsForProject(projectPath, get, set)
    })().finally(() => {
      switchingProjectPromise = null
    })

    return switchingProjectPromise
  },

  refreshActiveProject: async () => {
    const projectPath = get().activeProjectPath
    if (!projectPath) {
      return
    }

    setProjectLoading(set, projectPath, true)

    try {
      const tree = await loadProjectTree(projectPath)
      set((state) => ({
        dataByProjectPath: {
          ...state.dataByProjectPath,
          [projectPath]: tree,
        },
      }))
    } catch (error) {
      console.error("Failed to refresh project files:", error)
    } finally {
      setProjectLoading(set, projectPath, false)
    }

    await applyQueuedEventsForProject(projectPath, get, set)
  },
}))
