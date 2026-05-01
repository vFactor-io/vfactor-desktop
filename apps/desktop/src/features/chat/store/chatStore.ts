import { create } from "zustand"
import { nanoid } from "nanoid"
import { loadDesktopStore, type DesktopStoreHandle } from "@/desktop/client"
import { useProjectStore } from "@/features/workspace/store"
import { buildHarnessAttachmentText } from "../components/composer/attachments"
import {
  createUserMessage,
  createTextMessage,
  dedupeMessages,
  emitFileChanges,
  preserveExistingMessageMetadata,
  shouldRecreateRemoteSession,
} from "./messageState"
import {
  createAnsweredPromptState,
  createDismissedPromptState,
  getNormalizedPromptState,
} from "./promptState"
import {
  createRuntimeApprovalResponse,
  isRuntimeApprovalPrompt,
} from "../domain/runtimePrompts"
import { createRuntimeNoticeMessages } from "../domain/runtimeNotices"
import {
  createDefaultProjectChat,
  createOptimisticRuntimeSession,
  deriveSessionTitle,
  findProjectForSession,
  hasProjectChatSession,
  normalizeProjectChat,
  replaceSession,
  sortSessions,
  touchSession,
} from "./sessionState"
import {
  DEFAULT_HARNESS_ID,
  getHarnessAdapter,
  getHarnessDefinition,
  listHarnesses,
} from "../runtime/harnesses"
import {
  DEFAULT_RUNTIME_MODE,
  type ChatStatus,
  type CollaborationModeKind,
  type ChildSessionState,
  type HarnessDefinition,
  type HarnessId,
  type MessageWithParts,
  type RuntimeAgent,
  type RuntimeAttachmentPart,
  type RuntimeCommand,
  type RuntimeFileSearchResult,
  type RuntimeModel,
  type RuntimeNotice,
  type QueuedChatMessage,
  type RuntimePrompt,
  type RuntimePromptResponse,
  type RuntimePromptState,
  type RuntimeModeKind,
  type RuntimeSession,
  type SessionActivityState,
} from "../types"
import type {
  FileChangeEvent,
  PersistedChatState,
  ProjectChatState,
  WorkspaceSetupIntent,
  WorkspaceSetupState,
} from "./storeTypes"

const STORE_FILE = "chat.json"
const STREAM_PERSIST_DEBOUNCE_MS = 250

interface ChatState {
  chatByWorktree: Record<string, ProjectChatState>
  messagesBySession: Record<string, MessageWithParts[]>
  activePromptBySession: Record<string, RuntimePromptState>
  queuedMessagesBySession: Record<string, QueuedChatMessage[]>
  sessionActivityById: Record<string, SessionActivityState>
  currentSessionId: string | null
  childSessions: Map<string, ChildSessionState>
  workspaceSetupByProject: Record<string, WorkspaceSetupState>
  workspaceSetupIntentByProject: Record<string, WorkspaceSetupIntent>
  status: ChatStatus
  error: string | null
  isLoading: boolean
  isInitialized: boolean
  harnesses: HarnessDefinition[]
  fileChangeListeners: Set<(event: FileChangeEvent) => void>
  initialize: () => Promise<void>
  getProjectChat: (worktreeId: string) => ProjectChatState
  getHarnessDefinition: (harnessId: HarnessId) => HarnessDefinition
  loadSessionsForProject: (worktreeId: string, projectPath: string) => Promise<void>
  openDraftSession: (worktreeId: string, projectPath: string) => Promise<void>
  createSession: (
    worktreeId: string,
    projectPath: string,
    options?: { harnessId?: HarnessId; runtimeMode?: RuntimeModeKind }
  ) => Promise<RuntimeSession | null>
  createOptimisticSession: (
    worktreeId: string,
    projectPath: string,
    options?: { harnessId?: HarnessId; runtimeMode?: RuntimeModeKind }
  ) => RuntimeSession | null
  removeProjectData: (projectId: string) => Promise<void>
  removeWorktreeData: (worktreeId: string) => Promise<void>
  selectSession: (worktreeId: string, sessionId: string) => Promise<void>
  deleteSession: (worktreeId: string, sessionId: string) => Promise<void>
  archiveSession: (worktreeId: string, sessionId: string) => Promise<void>
  selectHarness: (worktreeId: string, harnessId: HarnessId) => Promise<void>
  setSessionHarness: (sessionId: string, harnessId: HarnessId) => Promise<void>
  setSessionModel: (sessionId: string, model: string | null) => Promise<void>
  setSessionModelPreferences: (
    sessionId: string,
    preferences: {
      model?: string | null
      reasoningEffort?: string | null
      modelVariant?: string | null
      fastMode?: boolean | null
    }
  ) => Promise<void>
  setSessionRuntimeMode: (sessionId: string, runtimeMode: RuntimeModeKind) => Promise<void>
  listAgents: (worktreeId: string) => Promise<RuntimeAgent[]>
  listCommands: (worktreeId: string) => Promise<RuntimeCommand[]>
  listModels: (worktreeId: string) => Promise<RuntimeModel[]>
  searchFiles: (worktreeId: string, query: string, directory?: string) => Promise<RuntimeFileSearchResult[]>
  onFileChange: (listener: (event: FileChangeEvent) => void) => () => void
  setActivePrompt: (sessionId: string, prompt: RuntimePrompt) => void
  clearActivePrompt: (sessionId: string) => void
  removeQueuedMessage: (sessionId: string, queuedMessageId: string) => void
  setWorkspaceSetupState: (projectId: string, setupState: WorkspaceSetupState | null) => void
  setWorkspaceSetupIntent: (projectId: string, intent: WorkspaceSetupIntent | null) => void
  dismissPrompt: (sessionId: string) => Promise<void>
  answerPrompt: (sessionId: string, response: RuntimePromptResponse) => Promise<void>
  sendMessage: (
    sessionId: string,
    text: string,
    options?: {
      attachments?: RuntimeAttachmentPart[]
      harnessId?: HarnessId
      agent?: string
      collaborationMode?: CollaborationModeKind
      runtimeMode?: RuntimeModeKind
      model?: string
      reasoningEffort?: string | null
      modelVariant?: string | null
      fastMode?: boolean
    }
  ) => Promise<void>
  abortSession: (sessionId: string) => Promise<void>
  executeCommand: (sessionId: string, command: string, args?: string) => Promise<void>
  _persistState: () => Promise<void>
}

let storeInstance: DesktopStoreHandle | null = null
let scheduledPersistTimeoutId: ReturnType<typeof setTimeout> | null = null
let initializationPromise: Promise<void> | null = null
const pendingSendQueueBySession = new Map<string, Promise<void>>()

function isExpiredApprovalPromptError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  return (
    error.message.includes("Approval request is no longer pending") ||
    error.message.includes("Approval server request is missing a request id")
  )
}

async function getStore(): Promise<DesktopStoreHandle> {
  if (!storeInstance) {
    storeInstance = await loadDesktopStore(STORE_FILE)
  }
  return storeInstance
}

function clearScheduledPersist(): void {
  if (scheduledPersistTimeoutId == null) {
    return
  }

  clearTimeout(scheduledPersistTimeoutId)
  scheduledPersistTimeoutId = null
}

function schedulePersistState(persist: () => Promise<void>): void {
  clearScheduledPersist()
  scheduledPersistTimeoutId = setTimeout(() => {
    scheduledPersistTimeoutId = null
    void persist().catch((error) => {
      console.error("[chatStore] Failed to persist partial streamed state:", error)
    })
  }, STREAM_PERSIST_DEBOUNCE_MS)
}

function enqueueSessionSend(sessionId: string, send: () => Promise<void>): Promise<void> {
  const queuedSend = (pendingSendQueueBySession.get(sessionId) ?? Promise.resolve())
    .catch(() => undefined)
    .then(send)

  pendingSendQueueBySession.set(sessionId, queuedSend)

  return queuedSend.finally(() => {
    if (pendingSendQueueBySession.get(sessionId) === queuedSend) {
      pendingSendQueueBySession.delete(sessionId)
    }
  })
}

function normalizeProjectChatState(
  chatByWorktree: Record<string, ProjectChatState> | undefined
): Record<string, ProjectChatState> {
  return Object.fromEntries(
    Object.entries(chatByWorktree ?? {}).map(([worktreeId, projectChat]) => [
      worktreeId,
      normalizeProjectChat({
        ...projectChat,
        selectedHarnessId: projectChat.selectedHarnessId ?? DEFAULT_HARNESS_ID,
      }),
    ])
  )
}

function isLocalDraftSession(session: RuntimeSession): boolean {
  return session.remoteId == null && session.id.startsWith("draft-")
}

async function abortPersistedSession(session: RuntimeSession): Promise<void> {
  if (isLocalDraftSession(session)) {
    return
  }

  await getHarnessAdapter(session.harnessId).abortSession(session)
}

function dedupeSessions(sessions: RuntimeSession[]): RuntimeSession[] {
  const seenSessionIds = new Set<string>()
  const dedupedSessions: RuntimeSession[] = []

  for (const session of sortSessions(sessions)) {
    if (seenSessionIds.has(session.id)) {
      continue
    }

    seenSessionIds.add(session.id)
    dedupedSessions.push(session)
  }

  return dedupedSessions
}

async function migratePersistedChatState(
  persisted: PersistedChatState | null
): Promise<Record<string, ProjectChatState>> {
  if (!persisted?.chatByProject && !persisted?.chatByWorktree) {
    return {}
  }

  const projectStore = useProjectStore.getState()
  if (!projectStore.projects.length && projectStore.isLoading) {
    await projectStore.loadProjects()
  }

  const projects = useProjectStore.getState().projects
  const projectById = new Map(projects.map((project) => [project.id, project]))
  const worktreeById = new Map(
    projects.flatMap((project) => project.worktrees.map((worktree) => [worktree.id, worktree] as const))
  )

  if (persisted.chatByWorktree) {
    return normalizeProjectChatState(
      Object.fromEntries(
        Object.entries(persisted.chatByWorktree).flatMap(([worktreeId, projectChat]) => {
          const worktree = worktreeById.get(worktreeId)
          if (!worktree) {
            return []
          }

          return [[
            worktreeId,
            {
              ...projectChat,
              worktreePath: projectChat.worktreePath ?? worktree?.path,
            },
          ]]
        })
      )
    )
  }

  if (!persisted.chatByProject) {
    return {}
  }

  return normalizeProjectChatState(
    Object.fromEntries(
      Object.entries(persisted.chatByProject).flatMap(([projectId, projectChat]) => {
        const project = projectById.get(projectId)
        const selectedWorktree =
          project?.worktrees.find((worktree) => worktree.id === project.selectedWorktreeId) ??
          project?.worktrees[0]
        if (!selectedWorktree) {
          return []
        }

        return [[
          selectedWorktree.id,
          {
            ...projectChat,
            sessions: dedupeSessions(projectChat.sessions),
            worktreePath: projectChat.worktreePath ?? selectedWorktree.path,
          },
        ]]
      })
    )
  )
}

function normalizeMessagesBySession(
  messagesBySession: PersistedChatState["messagesBySession"] | undefined
): Record<string, MessageWithParts[]> {
  return Object.fromEntries(
    Object.entries(messagesBySession ?? {}).map(([sessionId, messages]) => [
      sessionId,
      dedupeMessages(messages ?? []),
    ])
  )
}

function getKnownSessionIds(
  chatByWorktree: Record<string, ProjectChatState>
): Set<string> {
  return new Set(
    Object.values(chatByWorktree).flatMap((projectChat) =>
      projectChat.sessions.map((session) => session.id)
    )
  )
}

function getSessionActivityState(
  sessionActivityById: Record<string, SessionActivityState>,
  sessionId: string
): SessionActivityState {
  return sessionActivityById[sessionId] ?? { status: "idle", unread: false }
}

function getActiveWorkStartedAt(
  previousActivity: SessionActivityState | undefined,
  nextStatus: ChatStatus,
  fallbackStartedAt = Date.now()
): number | undefined {
  if (nextStatus !== "connecting" && nextStatus !== "streaming") {
    return undefined
  }

  return previousActivity?.workStartedAt ?? fallbackStartedAt
}

function replaceSessionActivity(
  sessionActivityById: Record<string, SessionActivityState>,
  sessionId: string,
  nextActivity: SessionActivityState
): Record<string, SessionActivityState> {
  const previousActivity = sessionActivityById[sessionId]
  const workStartedAt = getActiveWorkStartedAt(previousActivity, nextActivity.status)
  const resolvedActivity = {
    ...nextActivity,
    ...(workStartedAt == null ? {} : { workStartedAt }),
  }

  if (
    previousActivity &&
    previousActivity.status === resolvedActivity.status &&
    previousActivity.unread === resolvedActivity.unread &&
    previousActivity.workStartedAt === resolvedActivity.workStartedAt
  ) {
    return sessionActivityById
  }

  return {
    ...sessionActivityById,
    [sessionId]: resolvedActivity,
  }
}

function removeSessionActivity(
  sessionActivityById: Record<string, SessionActivityState>,
  sessionIds: Iterable<string>
): Record<string, SessionActivityState> {
  const nextSessionActivityById = { ...sessionActivityById }

  for (const sessionId of sessionIds) {
    delete nextSessionActivityById[sessionId]
  }

  return nextSessionActivityById
}

function removeQueuedMessages(
  queuedMessagesBySession: Record<string, QueuedChatMessage[]>,
  sessionIds: Iterable<string>
): Record<string, QueuedChatMessage[]> {
  const nextQueuedMessagesBySession = { ...queuedMessagesBySession }

  for (const sessionId of sessionIds) {
    delete nextQueuedMessagesBySession[sessionId]
  }

  return nextQueuedMessagesBySession
}

function normalizeSessionActivityState(
  sessionActivityById: PersistedChatState["sessionActivityById"] | undefined,
  chatByWorktree: Record<string, ProjectChatState>
): Record<string, SessionActivityState> {
  const knownSessionIds = getKnownSessionIds(chatByWorktree)

  return Object.fromEntries(
    Object.entries(sessionActivityById ?? {})
      .filter(([sessionId]) => knownSessionIds.has(sessionId))
      .map(([sessionId, activity]) => [
        sessionId,
        {
          status: "idle",
          unread: activity?.unread ?? false,
        } satisfies SessionActivityState,
      ])
  )
}

function getProjectSessionMatch(
  chatByWorktree: Record<string, ProjectChatState>,
  worktreeId: string,
  sessionId: string
): { projectChat: ProjectChatState; session: RuntimeSession } | null {
  const projectChat = chatByWorktree[worktreeId]
  if (!projectChat || !hasProjectChatSession(projectChat, sessionId)) {
    return null
  }

  const session = projectChat.sessions.find((candidate) => candidate.id === sessionId)
  if (!session) {
    return null
  }

  return { projectChat, session }
}

function getSessionMessages(
  messagesBySession: Record<string, MessageWithParts[]>,
  sessionId: string
): MessageWithParts[] {
  return messagesBySession[sessionId] ?? []
}

function mergeSessionMessages(
  previousMessages: MessageWithParts[],
  incomingMessages: MessageWithParts[] | undefined
): MessageWithParts[] {
  if (!incomingMessages?.length) {
    return dedupeMessages(previousMessages)
  }

  return dedupeMessages(
    preserveExistingMessageMetadata(previousMessages, [
      ...previousMessages,
      ...incomingMessages,
    ])
  )
}

function stampMessagesWithTurnId(
  messages: MessageWithParts[] | undefined,
  turnId: string
): MessageWithParts[] | undefined {
  if (!messages?.length) {
    return messages
  }

  return messages.map((message) => {
    if (message.info.role !== "assistant" || message.info.turnId) {
      return message
    }

    return {
      ...message,
      info: {
        ...message.info,
        turnId,
      },
    }
  })
}

function createTurnUpdateMessages(
  sessionId: string,
  turnId: string,
  result: { messages?: MessageWithParts[]; notices?: RuntimeNotice[] }
): MessageWithParts[] | undefined {
  const messages = stampMessagesWithTurnId(result.messages, turnId) ?? []
  const notices = createRuntimeNoticeMessages(sessionId, turnId, result.notices)

  if (messages.length === 0 && notices.length === 0) {
    return undefined
  }

  return [...notices, ...messages]
}

function replacePromptState(
  activePromptBySession: Record<string, RuntimePromptState>,
  sessionId: string,
  promptState: RuntimePromptState | null
): Record<string, RuntimePromptState> {
  const nextPromptState = Object.fromEntries(
    Object.entries(activePromptBySession).filter(([key]) => key !== sessionId)
  )

  if (!promptState) {
    return nextPromptState
  }

  return {
    ...nextPromptState,
    [sessionId]: promptState,
  }
}

function createChildSessionMap(
  childSessions: ChildSessionState[] | undefined
): Map<string, ChildSessionState> {
  return new Map((childSessions ?? []).map((childState) => [childState.session.id, childState]))
}

export const useChatStore = create<ChatState>((set, get) => ({
  chatByWorktree: {},
  messagesBySession: {},
  activePromptBySession: {},
  queuedMessagesBySession: {},
  sessionActivityById: {},
  currentSessionId: null,
  childSessions: new Map<string, ChildSessionState>(),
  workspaceSetupByProject: {},
  workspaceSetupIntentByProject: {},
  status: "idle",
  error: null,
  isLoading: true,
  isInitialized: false,
  harnesses: listHarnesses(),
  fileChangeListeners: new Set(),

  initialize: async () => {
    if (get().isInitialized) {
      return
    }

    if (initializationPromise) {
      await initializationPromise
      return
    }

    initializationPromise = (async () => {
      try {
        const store = await getStore()
        const persisted = await store.get<PersistedChatState>("chatState")
        const normalizedChatByWorktree = await migratePersistedChatState(persisted)
        const normalizedMessagesBySession = normalizeMessagesBySession(persisted?.messagesBySession)
        const normalizedSessionActivityById = normalizeSessionActivityState(
          persisted?.sessionActivityById,
          normalizedChatByWorktree
        )

        set({
          chatByWorktree: normalizedChatByWorktree,
          messagesBySession: normalizedMessagesBySession,
          // Prompt requests are only resumable while the in-memory harness adapter
          // still tracks the corresponding pending request. After a reload they
          // become stale UI, so we intentionally drop them on startup.
          activePromptBySession: {},
          queuedMessagesBySession: {},
          sessionActivityById: normalizedSessionActivityById,
          isLoading: false,
          isInitialized: true,
        })

        const uniqueHarnessIds = new Set<HarnessId>()
        for (const projectChat of Object.values(normalizedChatByWorktree)) {
          uniqueHarnessIds.add(projectChat.selectedHarnessId ?? DEFAULT_HARNESS_ID)
          for (const session of projectChat.sessions) {
            uniqueHarnessIds.add(session.harnessId ?? DEFAULT_HARNESS_ID)
          }
        }

        await Promise.all(
          Array.from(uniqueHarnessIds).map((harnessId) =>
            getHarnessAdapter(harnessId).initialize()
          )
        )
      } catch (error) {
        console.error("[chatStore] Failed to initialize:", error)
        set({
          isLoading: false,
          isInitialized: true,
          error: String(error),
        })
      } finally {
        initializationPromise = null
      }
    })()

    await initializationPromise
  },

  getProjectChat: (worktreeId: string) => {
    const { chatByWorktree } = get()
    return chatByWorktree[worktreeId] ?? createDefaultProjectChat()
  },

  getHarnessDefinition: (harnessId: HarnessId) => getHarnessDefinition(harnessId),

  loadSessionsForProject: async (worktreeId: string, projectPath: string) => {
    if (!get().isInitialized) {
      await get().initialize()
    }

    const { chatByWorktree } = get()
    const projectChat = chatByWorktree[worktreeId] ?? createDefaultProjectChat(projectPath)
    const hasExistingProjectChat = chatByWorktree[worktreeId] != null

    if (hasExistingProjectChat && projectChat.worktreePath === projectPath) {
      return
    }

    set({
      chatByWorktree: {
        ...chatByWorktree,
        [worktreeId]: {
          ...projectChat,
          worktreePath: projectPath,
        },
      },
    })

    void get()._persistState()
  },

  openDraftSession: async (worktreeId: string, projectPath: string) => {
    if (!get().isInitialized) {
      await get().initialize()
    }

    const { chatByWorktree } = get()
    const projectChat = chatByWorktree[worktreeId] ?? createDefaultProjectChat(projectPath)

    set({
      chatByWorktree: {
        ...chatByWorktree,
        [worktreeId]: {
          ...projectChat,
          worktreePath: projectPath,
          activeSessionId: null,
        },
      },
      currentSessionId: null,
      childSessions: new Map<string, ChildSessionState>(),
      status: "idle",
      error: null,
    })

    await get()._persistState()
  },

  createSession: async (worktreeId: string, projectPath: string, options) => {
    if (!get().isInitialized) {
      await get().initialize()
    }

    const { chatByWorktree } = get()
    const projectChat = chatByWorktree[worktreeId] ?? createDefaultProjectChat(projectPath)
    const harnessId = options?.harnessId ?? projectChat.selectedHarnessId
    const runtimeMode = options?.runtimeMode ?? DEFAULT_RUNTIME_MODE
    const adapter = getHarnessAdapter(harnessId)
    const session = await adapter.createSession(projectPath, {
      runtimeMode,
    })

    set({
      chatByWorktree: {
        ...chatByWorktree,
        [worktreeId]: {
          ...projectChat,
          selectedHarnessId: harnessId,
          worktreePath: projectPath,
          sessions: sortSessions([session, ...projectChat.sessions]),
          activeSessionId: session.id,
        },
      },
      sessionActivityById: replaceSessionActivity(get().sessionActivityById, session.id, {
        status: "idle",
        unread: false,
      }),
      currentSessionId: session.id,
      childSessions: new Map<string, ChildSessionState>(),
      status: "idle",
      error: null,
    })

    await get()._persistState()
    return session
  },

  createOptimisticSession: (worktreeId: string, projectPath: string, options) => {
    if (!get().isInitialized) {
      return null
    }

    const { chatByWorktree } = get()
    const projectChat = chatByWorktree[worktreeId] ?? createDefaultProjectChat(projectPath)
    const harnessId = options?.harnessId ?? projectChat.selectedHarnessId
    const runtimeMode = options?.runtimeMode ?? DEFAULT_RUNTIME_MODE
    const session = createOptimisticRuntimeSession(
      harnessId,
      projectPath,
      runtimeMode
    )

    set({
      chatByWorktree: {
        ...chatByWorktree,
        [worktreeId]: {
          ...projectChat,
          selectedHarnessId: harnessId,
          worktreePath: projectPath,
          sessions: sortSessions([session, ...projectChat.sessions]),
          activeSessionId: session.id,
        },
      },
      sessionActivityById: replaceSessionActivity(get().sessionActivityById, session.id, {
        status: "idle",
        unread: false,
      }),
      currentSessionId: session.id,
      childSessions: new Map<string, ChildSessionState>(),
      status: "idle",
      error: null,
    })

    void get()._persistState()
    return session
  },

  removeProjectData: async (projectId: string) => {
    const project = useProjectStore.getState().projects.find((candidate) => candidate.id === projectId) ?? null
    if (!project) {
      return
    }

    const candidatePaths = new Set([
      project.path,
      project.repoRootPath,
      ...(project.hiddenWorktreePaths ?? []),
      ...project.worktrees.map((worktree) => worktree.path),
    ])
    const matchingWorktreeEntries = Object.entries(get().chatByWorktree).filter(([, projectChat]) =>
      projectChat.worktreePath ? candidatePaths.has(projectChat.worktreePath) : false
    )

    if (!matchingWorktreeEntries.length) {
      return
    }

    await Promise.allSettled(
      matchingWorktreeEntries.flatMap(([, projectChat]) =>
        projectChat.sessions.map((session) => abortPersistedSession(session))
      )
    )

    set((state) => {
      const worktreeIdsToRemove = new Set(matchingWorktreeEntries.map(([worktreeId]) => worktreeId))
      const sessionIdsToRemove = new Set(
        matchingWorktreeEntries.flatMap(([, projectChat]) => projectChat.sessions.map((session) => session.id))
      )

      const nextChatByWorktree = { ...state.chatByWorktree }
      const nextWorkspaceSetupByProject = { ...state.workspaceSetupByProject }
      for (const worktreeId of worktreeIdsToRemove) {
        delete nextChatByWorktree[worktreeId]
      }
      delete nextWorkspaceSetupByProject[projectId]

      const nextMessagesBySession = { ...state.messagesBySession }
      const nextActivePromptBySession = { ...state.activePromptBySession }

      for (const sessionId of sessionIdsToRemove) {
        delete nextMessagesBySession[sessionId]
        delete nextActivePromptBySession[sessionId]
      }

      const isRemovingCurrentSession =
        state.currentSessionId != null && sessionIdsToRemove.has(state.currentSessionId)

      return {
        chatByWorktree: nextChatByWorktree,
        messagesBySession: nextMessagesBySession,
        activePromptBySession: nextActivePromptBySession,
        queuedMessagesBySession: removeQueuedMessages(
          state.queuedMessagesBySession,
          sessionIdsToRemove
        ),
        sessionActivityById: removeSessionActivity(state.sessionActivityById, sessionIdsToRemove),
        workspaceSetupByProject: nextWorkspaceSetupByProject,
        currentSessionId: isRemovingCurrentSession ? null : state.currentSessionId,
        childSessions: isRemovingCurrentSession
          ? new Map<string, ChildSessionState>()
          : state.childSessions,
        status: isRemovingCurrentSession ? "idle" : state.status,
        error: isRemovingCurrentSession ? null : state.error,
      }
    })

    await get()._persistState()
  },

  removeWorktreeData: async (worktreeId: string) => {
    const projectChat = get().chatByWorktree[worktreeId]
    if (!projectChat) {
      return
    }

    await Promise.allSettled(
      projectChat.sessions.map((session) => abortPersistedSession(session))
    )

    set((state) => {
      const sessionIdsToRemove = new Set(projectChat.sessions.map((session) => session.id))
      const nextChatByWorktree = { ...state.chatByWorktree }
      const nextWorkspaceSetupByProject = { ...state.workspaceSetupByProject }
      const nextMessagesBySession = { ...state.messagesBySession }
      const nextActivePromptBySession = { ...state.activePromptBySession }

      delete nextChatByWorktree[worktreeId]

      for (const sessionId of sessionIdsToRemove) {
        delete nextMessagesBySession[sessionId]
        delete nextActivePromptBySession[sessionId]
      }

      const isRemovingCurrentSession =
        state.currentSessionId != null && sessionIdsToRemove.has(state.currentSessionId)

      return {
        chatByWorktree: nextChatByWorktree,
        messagesBySession: nextMessagesBySession,
        activePromptBySession: nextActivePromptBySession,
        queuedMessagesBySession: removeQueuedMessages(
          state.queuedMessagesBySession,
          sessionIdsToRemove
        ),
        sessionActivityById: removeSessionActivity(state.sessionActivityById, sessionIdsToRemove),
        workspaceSetupByProject: nextWorkspaceSetupByProject,
        currentSessionId: isRemovingCurrentSession ? null : state.currentSessionId,
        childSessions: isRemovingCurrentSession
          ? new Map<string, ChildSessionState>()
          : state.childSessions,
        status: isRemovingCurrentSession ? "idle" : state.status,
        error: isRemovingCurrentSession ? null : state.error,
      }
    })

    await get()._persistState()
  },

  selectSession: async (worktreeId: string, sessionId: string) => {
    const { chatByWorktree, isInitialized, sessionActivityById } = get()
    if (!isInitialized) {
      return
    }

    const projectChat = chatByWorktree[worktreeId]
    if (!projectChat) {
      return
    }

    const sessionExists = projectChat.sessions.some((candidate) => candidate.id === sessionId)

    if (!sessionExists) {
      return
    }

    if (projectChat.activeSessionId === sessionId && get().currentSessionId === sessionId) {
      return
    }

    set({
      chatByWorktree: {
        ...chatByWorktree,
        [worktreeId]: {
          ...projectChat,
          activeSessionId: sessionId,
        },
      },
      sessionActivityById: replaceSessionActivity(
        sessionActivityById,
        sessionId,
        {
          ...getSessionActivityState(sessionActivityById, sessionId),
          unread: false,
        }
      ),
      currentSessionId: sessionId,
      childSessions: new Map<string, ChildSessionState>(),
      status: getSessionActivityState(sessionActivityById, sessionId).status,
      error: null,
    })

    void get()._persistState()
  },

  deleteSession: async (worktreeId: string, sessionId: string) => {
    const {
      chatByWorktree,
      messagesBySession,
      activePromptBySession,
      sessionActivityById,
      currentSessionId,
    } = get()
    const projectChat = chatByWorktree[worktreeId]
    if (!projectChat) {
      return
    }

    const updatedSessions = projectChat.sessions.filter((session) => session.id !== sessionId)
    const nextMessages = { ...messagesBySession }
    const nextPromptState = { ...activePromptBySession }
    delete nextMessages[sessionId]
    delete nextPromptState[sessionId]

    const wasActive = projectChat.activeSessionId === sessionId
    const nextActiveSessionId = wasActive ? updatedSessions[0]?.id ?? null : projectChat.activeSessionId

    set({
      chatByWorktree: {
        ...chatByWorktree,
        [worktreeId]: {
          ...projectChat,
          archivedSessionIds: (projectChat.archivedSessionIds ?? []).filter(
            (candidateId) => candidateId !== sessionId
          ),
          sessions: updatedSessions,
          activeSessionId: nextActiveSessionId,
        },
      },
      messagesBySession: nextMessages,
      activePromptBySession: nextPromptState,
      queuedMessagesBySession: removeQueuedMessages(get().queuedMessagesBySession, [sessionId]),
      sessionActivityById: removeSessionActivity(sessionActivityById, [sessionId]),
      currentSessionId: currentSessionId === sessionId ? nextActiveSessionId : currentSessionId,
      childSessions: currentSessionId === sessionId ? new Map<string, ChildSessionState>() : get().childSessions,
      status: currentSessionId === sessionId ? "idle" : get().status,
      error: currentSessionId === sessionId ? null : get().error,
    })

    await get()._persistState()
  },

  archiveSession: async (worktreeId: string, sessionId: string) => {
    const { chatByWorktree, activePromptBySession, sessionActivityById, currentSessionId } = get()
    const projectChat = chatByWorktree[worktreeId]
    if (!projectChat) {
      return
    }

    const archivedSessionIds = new Set(projectChat.archivedSessionIds ?? [])
    archivedSessionIds.add(sessionId)
    const nextPromptState = { ...activePromptBySession }
    delete nextPromptState[sessionId]

    const remainingSessions = projectChat.sessions.filter(
      (session) => !archivedSessionIds.has(session.id)
    )
    const nextActiveSessionId =
      projectChat.activeSessionId === sessionId
        ? remainingSessions[0]?.id ?? null
        : projectChat.activeSessionId

    set({
      chatByWorktree: {
        ...chatByWorktree,
        [worktreeId]: {
          ...projectChat,
          archivedSessionIds: Array.from(archivedSessionIds),
          activeSessionId: nextActiveSessionId,
        },
      },
      activePromptBySession: nextPromptState,
      queuedMessagesBySession: removeQueuedMessages(get().queuedMessagesBySession, [sessionId]),
      sessionActivityById: removeSessionActivity(sessionActivityById, [sessionId]),
      currentSessionId: currentSessionId === sessionId ? nextActiveSessionId : currentSessionId,
      childSessions: currentSessionId === sessionId ? new Map<string, ChildSessionState>() : get().childSessions,
      status: currentSessionId === sessionId ? "idle" : get().status,
      error: currentSessionId === sessionId ? null : get().error,
    })

    await get()._persistState()
  },

  selectHarness: async (worktreeId: string, harnessId: HarnessId) => {
    if (!get().isInitialized) {
      await get().initialize()
    }

    const { chatByWorktree } = get()
    const projectChat = chatByWorktree[worktreeId] ?? createDefaultProjectChat()

    set({
      chatByWorktree: {
        ...chatByWorktree,
        [worktreeId]: {
          ...projectChat,
          selectedHarnessId: harnessId,
        },
      },
    })

    await getHarnessAdapter(harnessId).initialize()
    await get()._persistState()
  },

  setSessionHarness: async (sessionId, harnessId) => {
    const sessionMatch = findProjectForSession(get().chatByWorktree, sessionId)
    if (!sessionMatch) {
      return
    }

    const { session } = sessionMatch
    if (session.harnessId === harnessId || session.remoteId) {
      return
    }

    set((state) => {
      const liveSessionMatch = findProjectForSession(state.chatByWorktree, sessionId)
      if (!liveSessionMatch) {
        return {}
      }

      const nextSession: RuntimeSession = {
        ...liveSessionMatch.session,
        harnessId,
        model: null,
        reasoningEffort: null,
        modelVariant: undefined,
        fastMode: null,
      }

      return {
        chatByWorktree: {
          ...state.chatByWorktree,
          [liveSessionMatch.worktreeId]: {
            ...liveSessionMatch.projectChat,
            sessions: replaceSession(liveSessionMatch.projectChat.sessions, nextSession),
          },
        },
      }
    })

    await getHarnessAdapter(harnessId).initialize()
    await get()._persistState()
  },

  setSessionModel: async (sessionId, model) => {
    await get().setSessionModelPreferences(sessionId, { model })
  },

  setSessionModelPreferences: async (sessionId, preferences) => {
    const sessionMatch = findProjectForSession(get().chatByWorktree, sessionId)
    if (!sessionMatch) {
      return
    }

    const hasModel = Object.prototype.hasOwnProperty.call(preferences, "model")
    const hasReasoningEffort = Object.prototype.hasOwnProperty.call(preferences, "reasoningEffort")
    const hasModelVariant = Object.prototype.hasOwnProperty.call(preferences, "modelVariant")
    const hasFastMode = Object.prototype.hasOwnProperty.call(preferences, "fastMode")
    const normalizedModel = preferences.model?.trim() || null
    const normalizedReasoningEffort = preferences.reasoningEffort?.trim() || null
    const normalizedModelVariant = preferences.modelVariant?.trim() || null
    const normalizedFastMode = preferences.fastMode ?? null

    if (
      (!hasModel || (sessionMatch.session.model?.trim() || null) === normalizedModel) &&
      (!hasReasoningEffort ||
        (sessionMatch.session.reasoningEffort?.trim() || null) === normalizedReasoningEffort) &&
      (!hasModelVariant ||
        (sessionMatch.session.modelVariant?.trim() || null) === normalizedModelVariant) &&
      (!hasFastMode || (sessionMatch.session.fastMode ?? null) === normalizedFastMode)
    ) {
      return
    }

    set((state) => {
      const liveSessionMatch = findProjectForSession(state.chatByWorktree, sessionId)
      if (!liveSessionMatch) {
        return {}
      }

      const nextSession: RuntimeSession = {
        ...liveSessionMatch.session,
        ...(hasModel ? { model: normalizedModel } : {}),
        ...(hasReasoningEffort ? { reasoningEffort: normalizedReasoningEffort } : {}),
        ...(hasModelVariant ? { modelVariant: normalizedModelVariant } : {}),
        ...(hasFastMode ? { fastMode: normalizedFastMode } : {}),
      }

      return {
        chatByWorktree: {
          ...state.chatByWorktree,
          [liveSessionMatch.worktreeId]: {
            ...liveSessionMatch.projectChat,
            sessions: replaceSession(liveSessionMatch.projectChat.sessions, nextSession),
          },
        },
      }
    })

    await get()._persistState()
  },

  setSessionRuntimeMode: async (sessionId, runtimeMode) => {
    const sessionMatch = findProjectForSession(get().chatByWorktree, sessionId)
    if (!sessionMatch) {
      return
    }

    if ((sessionMatch.session.runtimeMode ?? DEFAULT_RUNTIME_MODE) === runtimeMode) {
      return
    }

    set((state) => {
      const liveSessionMatch = findProjectForSession(state.chatByWorktree, sessionId)
      if (!liveSessionMatch) {
        return {}
      }

      const nextSession: RuntimeSession = {
        ...liveSessionMatch.session,
        runtimeMode,
      }

      return {
        chatByWorktree: {
          ...state.chatByWorktree,
          [liveSessionMatch.worktreeId]: {
            ...liveSessionMatch.projectChat,
            sessions: replaceSession(liveSessionMatch.projectChat.sessions, nextSession),
          },
        },
      }
    })

    await get()._persistState()
  },

  listAgents: async (worktreeId: string) => {
    const projectChat = get().getProjectChat(worktreeId)
    const adapter = getHarnessAdapter(projectChat.selectedHarnessId)
    return adapter.listAgents()
  },

  listCommands: async (worktreeId: string) => {
    const projectChat = get().getProjectChat(worktreeId)
    const adapter = getHarnessAdapter(projectChat.selectedHarnessId)
    return adapter.listCommands(projectChat.worktreePath)
  },

  listModels: async (worktreeId: string) => {
    const projectChat = get().getProjectChat(worktreeId)
    const adapter = getHarnessAdapter(projectChat.selectedHarnessId)
    return adapter.listModels()
  },

  searchFiles: async (worktreeId: string, query: string, directory?: string) => {
    const projectChat = get().getProjectChat(worktreeId)
    const adapter = getHarnessAdapter(projectChat.selectedHarnessId)
    return adapter.searchFiles(query, directory)
  },

  onFileChange: (listener) => {
    const listeners = get().fileChangeListeners
    listeners.add(listener)

    return () => {
      listeners.delete(listener)
    }
  },

  setActivePrompt: (sessionId, prompt) => {
    const normalizedPromptState = getNormalizedPromptState(prompt)
    if (!normalizedPromptState) {
      return
    }

    set((state) => ({
      activePromptBySession: {
        ...state.activePromptBySession,
        [sessionId]: normalizedPromptState,
      },
    }))

    void get()._persistState()
  },

  clearActivePrompt: (sessionId) => {
    set((state) => {
      if (!state.activePromptBySession[sessionId]) {
        return state
      }

      const nextPromptState = { ...state.activePromptBySession }
      delete nextPromptState[sessionId]

      return {
        activePromptBySession: nextPromptState,
      }
    })

    void get()._persistState()
  },

  removeQueuedMessage: (sessionId, queuedMessageId) => {
    set((state) => {
      const queuedMessages = state.queuedMessagesBySession[sessionId] ?? []
      if (queuedMessages.length === 0) {
        return {}
      }

      const nextQueuedMessages = queuedMessages.filter((message) => message.id !== queuedMessageId)
      if (nextQueuedMessages.length === queuedMessages.length) {
        return {}
      }

      return {
        queuedMessagesBySession:
          nextQueuedMessages.length > 0
            ? {
                ...state.queuedMessagesBySession,
                [sessionId]: nextQueuedMessages,
              }
            : removeQueuedMessages(state.queuedMessagesBySession, [sessionId]),
      }
    })
  },

  setWorkspaceSetupState: (projectId, setupState) => {
    set((state) => {
      const nextSetupByProject = { ...state.workspaceSetupByProject }

      if (setupState == null) {
        delete nextSetupByProject[projectId]
      } else {
        nextSetupByProject[projectId] = setupState
      }

      return {
        workspaceSetupByProject: nextSetupByProject,
      }
    })
  },

  setWorkspaceSetupIntent: (projectId, intent) => {
    set((state) => {
      const nextIntentByProject = { ...state.workspaceSetupIntentByProject }

      if (intent == null) {
        delete nextIntentByProject[projectId]
      } else {
        nextIntentByProject[projectId] = intent
      }

      return {
        workspaceSetupIntentByProject: nextIntentByProject,
      }
    })
  },

  dismissPrompt: async (sessionId) => {
    const activePrompt = get().activePromptBySession[sessionId]
    if (!activePrompt) {
      return
    }

    if (isRuntimeApprovalPrompt(activePrompt.prompt)) {
      await get().answerPrompt(
        sessionId,
        createRuntimeApprovalResponse(activePrompt.prompt, "deny")
      )
      return
    }

    void createDismissedPromptState(activePrompt.prompt)
    get().clearActivePrompt(sessionId)
    await get()._persistState()
  },

  answerPrompt: async (sessionId, response) => {
    const sessionMatch = findProjectForSession(get().chatByWorktree, sessionId)
    if (!sessionMatch) {
      return
    }

    const activePrompt = get().activePromptBySession[sessionId]
    if (!activePrompt || activePrompt.prompt.id !== response.promptId) {
      return
    }

    const { worktreeId, projectChat, session } = sessionMatch
    const adapter = getHarnessAdapter(session.harnessId)
    const answeredPromptState = createAnsweredPromptState(activePrompt.prompt, response)

    set((state) => {
      return {
        activePromptBySession: {
          ...state.activePromptBySession,
          [sessionId]: answeredPromptState,
        },
        status: "streaming",
        error: null,
      }
    })

    try {
      const result = await adapter.answerPrompt({
        session,
        projectPath: projectChat.worktreePath,
        prompt: answeredPromptState.prompt,
        response,
      })
      const didReceiveContinuation =
        Boolean(result.messages?.length) ||
        Boolean(result.childSessions?.length) ||
        result.prompt !== undefined

      if (!getProjectSessionMatch(get().chatByWorktree, worktreeId, sessionId)) {
        return
      }

      const sessionMessages = mergeSessionMessages(
        getSessionMessages(get().messagesBySession, sessionId),
        result.messages
      )

      set((state) => {
        if (!getProjectSessionMatch(state.chatByWorktree, worktreeId, sessionId)) {
          return {}
        }

        const normalizedPromptState = getNormalizedPromptState(result.prompt)
        const nextPromptState = normalizedPromptState
          ? replacePromptState(state.activePromptBySession, sessionId, normalizedPromptState)
          : isRuntimeApprovalPrompt(answeredPromptState.prompt)
            ? {
                ...state.activePromptBySession,
                [sessionId]: answeredPromptState,
              }
            : replacePromptState(state.activePromptBySession, sessionId, null)

        return {
          messagesBySession: {
            ...state.messagesBySession,
            [sessionId]: sessionMessages,
          },
          activePromptBySession: nextPromptState,
          childSessions: createChildSessionMap(result.childSessions),
          status: "idle",
          error: null,
        }
      })
    } catch (error) {
      if (!getProjectSessionMatch(get().chatByWorktree, worktreeId, sessionId)) {
        return
      }

      console.error("[chatStore] Failed to answer prompt:", error)
      if (
        isRuntimeApprovalPrompt(activePrompt.prompt) &&
        isExpiredApprovalPromptError(error)
      ) {
        set((state) => {
          if (!getProjectSessionMatch(state.chatByWorktree, worktreeId, sessionId)) {
            return {}
          }

          return {
            activePromptBySession: replacePromptState(
              state.activePromptBySession,
              sessionId,
              null
            ),
            status: "idle",
            error: null,
          }
        })

        await get()._persistState()
        return
      }

      set((state) => {
        if (!getProjectSessionMatch(state.chatByWorktree, worktreeId, sessionId)) {
          return {}
        }

        return {
          activePromptBySession: {
            ...state.activePromptBySession,
            [sessionId]: activePrompt,
          },
          status: "error",
          error: String(error),
        }
      })
    }

    if (!getProjectSessionMatch(get().chatByWorktree, worktreeId, sessionId)) {
      return
    }

    await get()._persistState()
  },

  sendMessage: async (sessionId: string, text: string, options) => {
    const attachments = options?.attachments ?? []
    const trimmedText = text.trim()

    if (!trimmedText && attachments.length === 0) {
      return
    }

    const queuedMessageId = pendingSendQueueBySession.has(sessionId) ? `queued-${nanoid()}` : null
    if (queuedMessageId) {
      set((state) => ({
        queuedMessagesBySession: {
          ...state.queuedMessagesBySession,
          [sessionId]: [
            ...(state.queuedMessagesBySession[sessionId] ?? []),
            {
              id: queuedMessageId,
              sessionId,
              text: trimmedText,
              attachments,
              createdAt: Date.now(),
            },
          ],
        },
      }))
    }

    await enqueueSessionSend(sessionId, async () => {
      if (queuedMessageId) {
        const queuedMessageStillExists = (get().queuedMessagesBySession[sessionId] ?? []).some(
          (message) => message.id === queuedMessageId
        )
        if (!queuedMessageStillExists) {
          return
        }

        get().removeQueuedMessage(sessionId, queuedMessageId)
      }

      const sessionMatch = findProjectForSession(get().chatByWorktree, sessionId)
      if (!sessionMatch) {
        return
      }

      const { worktreeId, projectChat, session } = sessionMatch
      const transportText = buildHarnessAttachmentText(trimmedText, attachments)
      const userMessage = createUserMessage(sessionId, trimmedText, attachments)
      const nextSessionTitle =
        session.title?.trim() ? session.title : deriveSessionTitle(trimmedText, attachments)
      const nextSessionHarnessId = options?.harnessId ?? session.harnessId
      const nextSessionModel = options?.model?.trim() || session.model?.trim() || null
      const nextSessionReasoningEffort =
        options?.reasoningEffort?.trim() || session.reasoningEffort?.trim() || null
      const nextSessionModelVariant =
        options && Object.prototype.hasOwnProperty.call(options, "modelVariant")
          ? options.modelVariant?.trim() || null
          : session.modelVariant
      const nextSessionFastMode =
        options && Object.prototype.hasOwnProperty.call(options, "fastMode")
          ? options.fastMode ?? null
          : session.fastMode
      const nextSessionRuntimeMode =
        options?.runtimeMode ?? session.runtimeMode ?? DEFAULT_RUNTIME_MODE
      let nextSession: RuntimeSession = {
        ...touchSession(session, nextSessionTitle),
        harnessId: nextSessionHarnessId,
        model: nextSessionModel,
        reasoningEffort: nextSessionReasoningEffort,
        modelVariant: nextSessionModelVariant,
        fastMode: nextSessionFastMode,
        runtimeMode: nextSessionRuntimeMode,
      }
      const adapter = getHarnessAdapter(nextSession.harnessId)
      const turnId = `turn-${nanoid()}`
      const nextTurnStatus =
        nextSession.harnessId === "codex" || nextSession.harnessId === "opencode"
          ? "connecting"
          : "streaming"
      const nextMessages = [...(get().messagesBySession[sessionId] ?? []), userMessage]

      set({
        chatByWorktree: {
          ...get().chatByWorktree,
          [worktreeId]: {
            ...projectChat,
            selectedHarnessId: nextSession.harnessId,
            sessions: replaceSession(projectChat.sessions, nextSession),
            activeSessionId: sessionId,
          },
        },
        messagesBySession: {
          ...get().messagesBySession,
          [sessionId]: nextMessages,
        },
        sessionActivityById: replaceSessionActivity(get().sessionActivityById, sessionId, {
          status: nextTurnStatus,
          unread: false,
        }),
        currentSessionId: sessionId,
        childSessions: new Map<string, ChildSessionState>(),
        status: nextTurnStatus,
        error: null,
      })

      try {
        await get()._persistState()
      } catch (error) {
        console.error("[chatStore] Failed to persist pending turn state:", error)
      }

      const syncLiveSession = (sessionToSync: RuntimeSession) => {
        set((state) => {
          const liveSessionMatch = getProjectSessionMatch(
            state.chatByWorktree,
            worktreeId,
            sessionId
          )
          if (!liveSessionMatch) {
            return {}
          }

          return {
            chatByWorktree: {
              ...state.chatByWorktree,
              [worktreeId]: {
                ...liveSessionMatch.projectChat,
                sessions: replaceSession(liveSessionMatch.projectChat.sessions, sessionToSync),
                activeSessionId: sessionId,
              },
            },
            currentSessionId: sessionId,
          }
        })
      }

      const handleStreamingUpdate = (partialResult: {
        messages?: MessageWithParts[]
        prompt?: RuntimePrompt | null
        notices?: RuntimeNotice[]
      }) => {
        set((state) => {
          if (!getProjectSessionMatch(state.chatByWorktree, worktreeId, sessionId)) {
            return {}
          }

          const previousMessages = getSessionMessages(state.messagesBySession, sessionId)
          const turnUpdateMessages = createTurnUpdateMessages(sessionId, turnId, partialResult)
          const sessionMessages = turnUpdateMessages?.length
            ? mergeSessionMessages(previousMessages, turnUpdateMessages)
            : previousMessages
          const nextMessagesBySession =
            sessionMessages === previousMessages
              ? state.messagesBySession
              : {
                  ...state.messagesBySession,
                  [sessionId]: sessionMessages,
                }
          const nextPromptState =
            partialResult.prompt === undefined
              ? state.activePromptBySession
              : replacePromptState(
                  state.activePromptBySession,
                  sessionId,
                  getNormalizedPromptState(partialResult.prompt)
                )
          const nextSessionActivityById = replaceSessionActivity(
            state.sessionActivityById,
            sessionId,
            {
              status: "streaming",
              unread: false,
            }
          )

          if (
            nextMessagesBySession === state.messagesBySession &&
            nextPromptState === state.activePromptBySession &&
            nextSessionActivityById === state.sessionActivityById &&
            state.status === "streaming" &&
            state.error === null
          ) {
            return {}
          }

          return {
            messagesBySession: nextMessagesBySession,
            activePromptBySession: nextPromptState,
            sessionActivityById: nextSessionActivityById,
            status: "streaming",
            error: null,
          }
        })

        if (getProjectSessionMatch(get().chatByWorktree, worktreeId, sessionId)) {
          schedulePersistState(() => get()._persistState())
        }
      }

      const finalizeSendResult = (result: {
        messages?: MessageWithParts[]
        childSessions?: ChildSessionState[]
        prompt?: RuntimePrompt | null
        notices?: RuntimeNotice[]
      }) => {
        const sessionMessages = mergeSessionMessages(
          getSessionMessages(get().messagesBySession, sessionId),
          createTurnUpdateMessages(sessionId, turnId, result)
        )
        const normalizedPromptState = getNormalizedPromptState(result.prompt)

        set((state) => {
          if (!getProjectSessionMatch(state.chatByWorktree, worktreeId, sessionId)) {
            return {}
          }

          return {
            messagesBySession: {
              ...state.messagesBySession,
              [sessionId]: sessionMessages,
            },
            activePromptBySession: replacePromptState(
              state.activePromptBySession,
              sessionId,
              normalizedPromptState
            ),
            sessionActivityById: replaceSessionActivity(state.sessionActivityById, sessionId, {
              status: "idle",
              unread: state.currentSessionId !== sessionId,
            }),
            childSessions: createChildSessionMap(result.childSessions),
            status: "idle",
            error: null,
          }
        })

        emitFileChanges(get().fileChangeListeners, result.messages ?? [])
      }

      const runSend = async (sessionToSend: RuntimeSession) =>
        adapter.sendMessage({
          session: sessionToSend,
          turnId,
          projectPath: projectChat.worktreePath,
          text: transportText,
          agent: options?.agent,
          collaborationMode: options?.collaborationMode,
          runtimeMode: options?.runtimeMode ?? sessionToSend.runtimeMode ?? DEFAULT_RUNTIME_MODE,
          model: options?.model,
          reasoningEffort: options?.reasoningEffort,
          modelVariant: options?.modelVariant,
          fastMode: options?.fastMode,
          onUpdate: handleStreamingUpdate,
        })

      try {
        if (!nextSession.remoteId) {
          const remoteSession = await adapter.createSession(
            projectChat.worktreePath ?? nextSession.projectPath ?? "",
            { runtimeMode: nextSession.runtimeMode ?? DEFAULT_RUNTIME_MODE }
          )

          if (!getProjectSessionMatch(get().chatByWorktree, worktreeId, sessionId)) {
            return
          }

          nextSession = {
            ...nextSession,
            remoteId: remoteSession.remoteId ?? remoteSession.id,
            projectPath: remoteSession.projectPath ?? nextSession.projectPath,
            title: nextSession.title ?? remoteSession.title,
            updatedAt: Date.now(),
          }

          syncLiveSession(nextSession)
        }

        const result = await runSend(nextSession)

        if (!getProjectSessionMatch(get().chatByWorktree, worktreeId, sessionId)) {
          return
        }

        finalizeSendResult(result)
      } catch (error) {
        if (shouldRecreateRemoteSession(session, error)) {
          try {
            set({
              currentSessionId: sessionId,
              sessionActivityById: replaceSessionActivity(get().sessionActivityById, sessionId, {
                status: "connecting",
                unread: false,
              }),
              status: "connecting",
              error: null,
            })

            const recreatedRemoteSession = await adapter.createSession(
              projectChat.worktreePath ?? session.projectPath ?? "",
              { runtimeMode: nextSession.runtimeMode ?? DEFAULT_RUNTIME_MODE }
            )

            const recoveredSession: RuntimeSession = {
              ...nextSession,
              remoteId: recreatedRemoteSession.remoteId ?? recreatedRemoteSession.id,
              title: nextSession.title ?? recreatedRemoteSession.title,
              projectPath: projectChat.worktreePath ?? recreatedRemoteSession.projectPath,
              updatedAt: Date.now(),
            }

            if (!getProjectSessionMatch(get().chatByWorktree, worktreeId, sessionId)) {
              return
            }

            syncLiveSession(recoveredSession)

            const retriedResult = await runSend(recoveredSession)
            if (!getProjectSessionMatch(get().chatByWorktree, worktreeId, sessionId)) {
              return
            }

            finalizeSendResult(retriedResult)
            await get()._persistState()
            return
          } catch (retryError) {
            console.error("[chatStore] sendMessage:recreate-session:failed", {
              sessionId,
              previousRemoteId: session.remoteId ?? session.id,
              error: String(retryError),
            })
            error = retryError
          }
        }

        if (!getProjectSessionMatch(get().chatByWorktree, worktreeId, sessionId)) {
          return
        }

        const failureMessage = createTextMessage(
          sessionId,
          "assistant",
          `Failed to send this turn to ${adapter.definition.label}: ${String(error)}`
        )
        const sessionMessages = [...(get().messagesBySession[sessionId] ?? nextMessages), failureMessage]

        set((state) => {
          if (!getProjectSessionMatch(state.chatByWorktree, worktreeId, sessionId)) {
            return {}
          }

          return {
            messagesBySession: {
              ...state.messagesBySession,
              [sessionId]: sessionMessages,
            },
            sessionActivityById: replaceSessionActivity(state.sessionActivityById, sessionId, {
              status: "error",
              unread: state.currentSessionId !== sessionId,
            }),
            status: "error",
            error: String(error),
          }
        })
      }

      if (!getProjectSessionMatch(get().chatByWorktree, worktreeId, sessionId)) {
        return
      }

      await get()._persistState()
    })
  },

  abortSession: async (sessionId: string) => {
    const sessionMatch = findProjectForSession(get().chatByWorktree, sessionId)
    if (!sessionMatch) {
      return
    }

    await abortPersistedSession(sessionMatch.session)
    set({
      sessionActivityById: replaceSessionActivity(get().sessionActivityById, sessionId, {
        status: "idle",
        unread: false,
      }),
      status: "idle",
    })
  },

  executeCommand: async (sessionId: string, command: string, args: string = "") => {
    const sessionMatch = findProjectForSession(get().chatByWorktree, sessionId)
    if (!sessionMatch) {
      return
    }

    const { worktreeId, projectChat, session } = sessionMatch
    const adapter = getHarnessAdapter(session.harnessId)
    const nextSession = touchSession(session)

    set({
      chatByWorktree: {
        ...get().chatByWorktree,
        [worktreeId]: {
          ...projectChat,
          sessions: replaceSession(projectChat.sessions, nextSession),
          activeSessionId: sessionId,
        },
      },
      sessionActivityById: replaceSessionActivity(get().sessionActivityById, sessionId, {
        status: "streaming",
        unread: false,
      }),
      currentSessionId: sessionId,
      status: "streaming",
      error: null,
    })

    try {
      const result = await adapter.executeCommand({
        session: nextSession,
        projectPath: projectChat.worktreePath,
        command,
        args,
      })

      if (!getProjectSessionMatch(get().chatByWorktree, worktreeId, sessionId)) {
        return
      }

      const sessionMessages = mergeSessionMessages(
        getSessionMessages(get().messagesBySession, sessionId),
        result.messages
      )
      const normalizedPromptState = getNormalizedPromptState(result.prompt)

      set((state) => {
        if (!getProjectSessionMatch(state.chatByWorktree, worktreeId, sessionId)) {
          return {}
        }

        return {
          messagesBySession: {
            ...state.messagesBySession,
            [sessionId]: sessionMessages,
          },
          activePromptBySession: replacePromptState(
            state.activePromptBySession,
            sessionId,
            normalizedPromptState
          ),
          sessionActivityById: replaceSessionActivity(state.sessionActivityById, sessionId, {
            status: "idle",
            unread: state.currentSessionId !== sessionId,
          }),
          status: "idle",
        }
      })
    } catch (error) {
      if (!getProjectSessionMatch(get().chatByWorktree, worktreeId, sessionId)) {
        return
      }

      set((state) => {
        if (!getProjectSessionMatch(state.chatByWorktree, worktreeId, sessionId)) {
          return {}
        }

        return {
          sessionActivityById: replaceSessionActivity(state.sessionActivityById, sessionId, {
            status: "error",
            unread: state.currentSessionId !== sessionId,
          }),
          status: "error",
          error: String(error),
        }
      })
    }

    if (!getProjectSessionMatch(get().chatByWorktree, worktreeId, sessionId)) {
      return
    }

    await get()._persistState()
  },

  _persistState: async () => {
    if (!get().isInitialized) {
      return
    }

    clearScheduledPersist()
    const { chatByWorktree, messagesBySession, sessionActivityById } = get()
    const store = await getStore()
    await store.set("chatState", {
      chatByWorktree,
      messagesBySession,
      activePromptBySession: {},
      sessionActivityById,
    } satisfies PersistedChatState)
    await store.save()
  },
}))

export type { MessageWithParts, ChildSessionState, RuntimeSession as Session } from "../types"
