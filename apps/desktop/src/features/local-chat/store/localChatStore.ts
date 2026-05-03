import { create } from "zustand"
import { desktop, loadDesktopStore, type DesktopStoreHandle } from "@/desktop/client"
import type { LocalChatThread } from "../types"

const STORE_FILE = "local-chat.json"
const THREADS_KEY = "threads"
const ACTIVE_THREAD_KEY = "activeThreadId"
const VFACTOR_FOLDER_NAME = ".vFactor"
const THREADS_FOLDER_NAME = "threads"
const ARTIFACTS_FOLDER_NAME = "artifacts"

interface PersistedLocalChatState {
  threads?: LocalChatThread[]
  activeThreadId?: string | null
}

interface LocalChatState {
  threads: LocalChatThread[]
  activeThreadId: string | null
  isLoading: boolean
  isInitialized: boolean
  initialize: () => Promise<void>
  createThread: (input?: { title?: string | null; prompt?: string | null }) => Promise<LocalChatThread>
  selectThread: (threadId: string | null) => Promise<void>
  setThreadActiveSession: (threadId: string, sessionId: string | null) => Promise<void>
  touchThread: (threadId: string, updates?: Partial<Pick<LocalChatThread, "title">>) => Promise<void>
  archiveThread: (threadId: string) => Promise<void>
}

let storeInstance: DesktopStoreHandle | null = null
let initializePromise: Promise<void> | null = null

async function getStore(): Promise<DesktopStoreHandle> {
  if (!storeInstance) {
    storeInstance = await loadDesktopStore(STORE_FILE)
  }
  return storeInstance
}

function joinPath(...segments: string[]): string {
  return segments
    .map((segment, index) =>
      index === 0 ? segment.replace(/\/+$/, "") : segment.replace(/^\/+|\/+$/g, "")
    )
    .filter(Boolean)
    .join("/")
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)

  return slug || "new-chat"
}

function deriveThreadTitle(input?: { title?: string | null; prompt?: string | null }): string {
  const candidate = input?.title?.trim() || input?.prompt?.trim() || "New chat"
  const singleLine = candidate.replace(/\s+/g, " ").trim()
  if (singleLine.length <= 64) {
    return singleLine || "New chat"
  }

  return `${singleLine.slice(0, 61).trim()}...`
}

async function resolveLocalChatRoot(): Promise<string> {
  const homeDir = await desktop.fs.homeDir()
  return joinPath(homeDir, "Documents", VFACTOR_FOLDER_NAME)
}

async function ensureLocalChatFolders(rootPath: string): Promise<void> {
  await desktop.fs.mkdir(joinPath(rootPath, THREADS_FOLDER_NAME), { recursive: true })
}

function normalizeThread(thread: Partial<LocalChatThread>): LocalChatThread | null {
  const id = thread.id?.trim()
  const path = thread.path?.trim()
  const artifactsPath = thread.artifactsPath?.trim()
  if (!id || !path || !artifactsPath) {
    return null
  }

  const now = Date.now()
  return {
    id,
    title: thread.title?.trim() || "New chat",
    path,
    artifactsPath,
    createdAt: thread.createdAt ?? now,
    updatedAt: thread.updatedAt ?? thread.createdAt ?? now,
    activeSessionId: thread.activeSessionId ?? null,
    archivedAt: thread.archivedAt ?? null,
    deletedAt: thread.deletedAt ?? null,
  }
}

function visibleThreads(threads: LocalChatThread[]): LocalChatThread[] {
  return threads
    .filter((thread) => !thread.deletedAt && !thread.archivedAt)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

async function persistState(threads: LocalChatThread[], activeThreadId: string | null): Promise<void> {
  const store = await getStore()
  await store.set(THREADS_KEY, threads)
  await store.set(ACTIVE_THREAD_KEY, activeThreadId)
  await store.save()
}

export const useLocalChatStore = create<LocalChatState>((set, get) => ({
  threads: [],
  activeThreadId: null,
  isLoading: true,
  isInitialized: false,

  initialize: async () => {
    if (get().isInitialized) {
      return
    }

    if (initializePromise) {
      await initializePromise
      return
    }

    initializePromise = (async () => {
      try {
        const rootPath = await resolveLocalChatRoot()
        await ensureLocalChatFolders(rootPath)

        const store = await getStore()
        const persistedThreads = await store.get<LocalChatThread[]>(THREADS_KEY)
        const persistedActiveThreadId = await store.get<string>(ACTIVE_THREAD_KEY)
        const threads = visibleThreads(
          (Array.isArray(persistedThreads) ? persistedThreads : [])
            .map(normalizeThread)
            .filter((thread): thread is LocalChatThread => thread != null)
        )
        const activeThreadId =
          persistedActiveThreadId && threads.some((thread) => thread.id === persistedActiveThreadId)
            ? persistedActiveThreadId
            : threads[0]?.id ?? null

        set({
          threads,
          activeThreadId,
          isLoading: false,
          isInitialized: true,
        })
      } catch (error) {
        console.error("[localChatStore] Failed to initialize:", error)
        set({
          threads: [],
          activeThreadId: null,
          isLoading: false,
          isInitialized: true,
        })
      } finally {
        initializePromise = null
      }
    })()

    await initializePromise
  },

  createThread: async (input) => {
    if (!get().isInitialized) {
      await get().initialize()
    }

    const rootPath = await resolveLocalChatRoot()
    await ensureLocalChatFolders(rootPath)

    const now = Date.now()
    const id = crypto.randomUUID()
    const title = deriveThreadTitle(input)
    const timestamp = new Date(now).toISOString().replace(/[-:]/g, "").replace(/\..+$/, "")
    const folderName = `${timestamp}-${slugify(title)}-${id.slice(0, 8)}`
    const threadPath = joinPath(rootPath, THREADS_FOLDER_NAME, folderName)
    const artifactsPath = joinPath(threadPath, ARTIFACTS_FOLDER_NAME)

    await desktop.fs.mkdir(artifactsPath, { recursive: true })
    await desktop.fs.writeTextFile(
      joinPath(threadPath, "AGENTS.md"),
      [
        "# Local Chat Thread",
        "",
        "Use this folder as the working directory for this local chat.",
        "Place any user-facing files, exports, drafts, mockups, or generated artifacts in `./artifacts`.",
        "Do not initialize or use git for this thread unless the user explicitly asks.",
        "",
      ].join("\n")
    )

    const thread: LocalChatThread = {
      id,
      title,
      path: threadPath,
      artifactsPath,
      createdAt: now,
      updatedAt: now,
      activeSessionId: null,
      archivedAt: null,
      deletedAt: null,
    }
    const nextThreads = visibleThreads([thread, ...get().threads])

    set({
      threads: nextThreads,
      activeThreadId: thread.id,
    })
    await persistState(nextThreads, thread.id)

    return thread
  },

  selectThread: async (threadId) => {
    if (!get().isInitialized) {
      await get().initialize()
    }

    const nextThreadId =
      threadId && get().threads.some((thread) => thread.id === threadId) ? threadId : null
    set({ activeThreadId: nextThreadId })
    await persistState(get().threads, nextThreadId)
  },

  setThreadActiveSession: async (threadId, sessionId) => {
    const now = Date.now()
    const nextThreads = visibleThreads(
      get().threads.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              activeSessionId: sessionId,
              updatedAt: now,
            }
          : thread
      )
    )

    set({ threads: nextThreads })
    await persistState(nextThreads, get().activeThreadId)
  },

  touchThread: async (threadId, updates) => {
    const now = Date.now()
    const nextThreads = visibleThreads(
      get().threads.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              ...updates,
              updatedAt: now,
            }
          : thread
      )
    )

    set({ threads: nextThreads })
    await persistState(nextThreads, get().activeThreadId)
  },

  archiveThread: async (threadId) => {
    const now = Date.now()
    const nextThreads = visibleThreads(
      get().threads.map((thread) =>
        thread.id === threadId ? { ...thread, archivedAt: now, updatedAt: now } : thread
      )
    )
    const nextActiveThreadId = get().activeThreadId === threadId ? nextThreads[0]?.id ?? null : get().activeThreadId

    set({
      threads: nextThreads,
      activeThreadId: nextActiveThreadId,
    })
    await persistState(nextThreads, nextActiveThreadId)
  },
}))
