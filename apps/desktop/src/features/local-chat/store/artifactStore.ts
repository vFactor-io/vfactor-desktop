import { create } from "zustand"
import { desktop } from "@/desktop/client"
import type { ArtifactItem } from "../types"

interface ArtifactState {
  artifactsByThreadId: Record<string, ArtifactItem[]>
  loadingByThreadId: Record<string, boolean>
  errorByThreadId: Record<string, string | null>
  activeThreadId: string | null
  activeArtifactsPath: string | null
  initializeThreadArtifacts: (threadId: string, artifactsPath: string) => Promise<void>
  refreshThreadArtifacts: (threadId: string, artifactsPath: string) => Promise<void>
  clearActiveThread: () => Promise<void>
}

let watcherStop: (() => void) | null = null
let watcherRefreshTimeoutId: ReturnType<typeof setTimeout> | null = null

function getRelativePath(rootPath: string, path: string): string {
  const normalizedRoot = rootPath.replace(/\/+$/, "")
  return path === normalizedRoot ? "" : path.slice(normalizedRoot.length + 1)
}

function sortArtifacts(artifacts: ArtifactItem[]): ArtifactItem[] {
  return [...artifacts].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1
    }

    return a.name.localeCompare(b.name)
  })
}

async function readArtifacts(rootPath: string): Promise<ArtifactItem[]> {
  const entries = await desktop.fs.readDir(rootPath).catch(() => [])

  return sortArtifacts(
    entries.map((entry) => ({
      id: entry.path,
      name: entry.name,
      path: entry.path,
      relativePath: getRelativePath(rootPath, entry.path),
      isDirectory: entry.isDirectory,
      sizeBytes: entry.sizeBytes,
      modifiedAt: entry.modifiedAt,
    }))
  )
}

async function stopArtifactWatcher(): Promise<void> {
  if (watcherRefreshTimeoutId) {
    clearTimeout(watcherRefreshTimeoutId)
    watcherRefreshTimeoutId = null
  }

  watcherStop?.()
  watcherStop = null
  await desktop.watcher.stop().catch(() => undefined)
}

export const useArtifactStore = create<ArtifactState>((set, get) => ({
  artifactsByThreadId: {},
  loadingByThreadId: {},
  errorByThreadId: {},
  activeThreadId: null,
  activeArtifactsPath: null,

  initializeThreadArtifacts: async (threadId, artifactsPath) => {
    const current = get()
    if (current.activeThreadId === threadId && current.activeArtifactsPath === artifactsPath) {
      return
    }

    await stopArtifactWatcher()

    set({
      activeThreadId: threadId,
      activeArtifactsPath: artifactsPath,
    })

    const scheduleRefresh = () => {
      if (watcherRefreshTimeoutId) {
        clearTimeout(watcherRefreshTimeoutId)
      }

      watcherRefreshTimeoutId = setTimeout(() => {
        watcherRefreshTimeoutId = null
        const { activeThreadId, activeArtifactsPath, refreshThreadArtifacts } = get()
        if (activeThreadId && activeArtifactsPath) {
          void refreshThreadArtifacts(activeThreadId, activeArtifactsPath)
        }
      }, 100)
    }

    watcherStop = desktop.watcher.onEvent((event) => {
      if (event.rootPath === artifactsPath) {
        scheduleRefresh()
      }
    })

    await desktop.fs.mkdir(artifactsPath, { recursive: true }).catch(() => undefined)
    await desktop.watcher.start(artifactsPath).catch((error) => {
      console.error("[artifactStore] Failed to watch artifacts:", error)
    })
    await get().refreshThreadArtifacts(threadId, artifactsPath)
  },

  refreshThreadArtifacts: async (threadId, artifactsPath) => {
    set((state) => ({
      loadingByThreadId: {
        ...state.loadingByThreadId,
        [threadId]: true,
      },
      errorByThreadId: {
        ...state.errorByThreadId,
        [threadId]: null,
      },
    }))

    try {
      const artifacts = await readArtifacts(artifactsPath)
      set((state) => ({
        artifactsByThreadId: {
          ...state.artifactsByThreadId,
          [threadId]: artifacts,
        },
      }))
    } catch (error) {
      set((state) => ({
        errorByThreadId: {
          ...state.errorByThreadId,
          [threadId]: error instanceof Error ? error.message : "Could not read artifacts.",
        },
      }))
    } finally {
      set((state) => ({
        loadingByThreadId: {
          ...state.loadingByThreadId,
          [threadId]: false,
        },
      }))
    }
  },

  clearActiveThread: async () => {
    await stopArtifactWatcher()
    set({
      activeThreadId: null,
      activeArtifactsPath: null,
    })
  },
}))
