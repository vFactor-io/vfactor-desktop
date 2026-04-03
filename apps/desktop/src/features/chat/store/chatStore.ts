import { create } from "zustand"
import { loadDesktopStore, type DesktopStoreHandle } from "@/desktop/client"
import { useProjectStore } from "@/features/workspace/store"
import {
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
import {
  createDefaultProjectChat,
  createOptimisticRuntimeSession,
  deriveSessionTitle,
  findProjectForSession,
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
import type {
  ChatStatus,
  ChildSessionState,
  HarnessDefinition,
  HarnessId,
  MessageWithParts,
  RuntimeAgent,
  RuntimeCommand,
  RuntimeFileSearchResult,
  RuntimeModel,
  RuntimePrompt,
  RuntimePromptResponse,
  RuntimePromptState,
  CollaborationModeKind,
  RuntimeSession,
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
  currentSessionId: string | null
  childSessions: Map<string, ChildSessionState>
  workspaceSetupByProject: Record<string, WorkspaceSetupState>
  workspaceSetupIntentByProject: Record<string, WorkspaceSetupIntent>
  status: ChatStatus | "connecting"
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
  createSession: (worktreeId: string, projectPath: string) => Promise<RuntimeSession | null>
  createOptimisticSession: (worktreeId: string, projectPath: string) => RuntimeSession | null
  removeProjectData: (projectId: string) => Promise<void>
  removeWorktreeData: (worktreeId: string) => Promise<void>
  selectSession: (worktreeId: string, sessionId: string) => Promise<void>
  deleteSession: (worktreeId: string, sessionId: string) => Promise<void>
  archiveSession: (worktreeId: string, sessionId: string) => Promise<void>
  selectHarness: (worktreeId: string, harnessId: HarnessId) => Promise<void>
  listAgents: (worktreeId: string) => Promise<RuntimeAgent[]>
  listCommands: (worktreeId: string) => Promise<RuntimeCommand[]>
  listModels: (worktreeId: string) => Promise<RuntimeModel[]>
  searchFiles: (worktreeId: string, query: string, directory?: string) => Promise<RuntimeFileSearchResult[]>
  onFileChange: (listener: (event: FileChangeEvent) => void) => () => void
  setActivePrompt: (sessionId: string, prompt: RuntimePrompt) => void
  clearActivePrompt: (sessionId: string) => void
  setWorkspaceSetupState: (projectId: string, setupState: WorkspaceSetupState | null) => void
  setWorkspaceSetupIntent: (projectId: string, intent: WorkspaceSetupIntent | null) => void
  dismissPrompt: (sessionId: string) => Promise<void>
  answerPrompt: (sessionId: string, response: RuntimePromptResponse) => Promise<void>
  sendMessage: (
    sessionId: string,
    text: string,
    options?: {
      agent?: string
      collaborationMode?: CollaborationModeKind
      model?: string
      reasoningEffort?: string | null
    }
  ) => Promise<void>
  abortSession: (sessionId: string) => Promise<void>
  executeCommand: (sessionId: string, command: string, args?: string) => Promise<void>
  _persistState: () => Promise<void>
}

let storeInstance: DesktopStoreHandle | null = null
let scheduledPersistTimeoutId: ReturnType<typeof setTimeout> | null = null

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
        Object.entries(persisted.chatByWorktree).map(([worktreeId, projectChat]) => {
          const worktree = worktreeById.get(worktreeId)

          return [
            worktreeId,
            {
              ...projectChat,
              worktreePath: projectChat.worktreePath ?? worktree?.path,
            },
          ]
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

function getProjectSessionMatch(
  chatByWorktree: Record<string, ProjectChatState>,
  worktreeId: string,
  sessionId: string
): { projectChat: ProjectChatState; session: RuntimeSession } | null {
  const projectChat = chatByWorktree[worktreeId]
  if (!projectChat) {
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

    try {
      const store = await getStore()
      const persisted = await store.get<PersistedChatState>("chatState")
      const normalizedChatByWorktree = await migratePersistedChatState(persisted)
      const normalizedMessagesBySession = normalizeMessagesBySession(persisted?.messagesBySession)

      set({
        chatByWorktree: normalizedChatByWorktree,
        messagesBySession: normalizedMessagesBySession,
        // Prompt requests are only resumable while the in-memory harness adapter
        // still tracks the corresponding pending request. After a reload they
        // become stale UI, so we intentionally drop them on startup.
        activePromptBySession: {},
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
    }
  },

  getProjectChat: (worktreeId: string) => {
    const { chatByWorktree } = get()
    return chatByWorktree[worktreeId] ?? createDefaultProjectChat()
  },

  getHarnessDefinition: (harnessId: HarnessId) => getHarnessDefinition(harnessId),

  loadSessionsForProject: async (worktreeId: string, projectPath: string) => {
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

  createSession: async (worktreeId: string, projectPath: string) => {
    const { chatByWorktree } = get()
    const projectChat = chatByWorktree[worktreeId] ?? createDefaultProjectChat(projectPath)
    const adapter = getHarnessAdapter(projectChat.selectedHarnessId)
    const session = await adapter.createSession(projectPath)

    set({
      chatByWorktree: {
        ...chatByWorktree,
        [worktreeId]: {
          ...projectChat,
          worktreePath: projectPath,
          sessions: sortSessions([session, ...projectChat.sessions]),
          activeSessionId: session.id,
        },
      },
      currentSessionId: session.id,
      childSessions: new Map<string, ChildSessionState>(),
      status: "idle",
      error: null,
    })

    await get()._persistState()
    return session
  },

  createOptimisticSession: (worktreeId: string, projectPath: string) => {
    const { chatByWorktree } = get()
    const projectChat = chatByWorktree[worktreeId] ?? createDefaultProjectChat(projectPath)
    const session = createOptimisticRuntimeSession(projectChat.selectedHarnessId, projectPath)

    set({
      chatByWorktree: {
        ...chatByWorktree,
        [worktreeId]: {
          ...projectChat,
          worktreePath: projectPath,
          sessions: sortSessions([session, ...projectChat.sessions]),
          activeSessionId: session.id,
        },
      },
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
        projectChat.sessions.map((session) => getHarnessAdapter(session.harnessId).abortSession(session))
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
      projectChat.sessions.map((session) => getHarnessAdapter(session.harnessId).abortSession(session))
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
    const { chatByWorktree } = get()
    const projectChat = chatByWorktree[worktreeId]
    if (!projectChat) {
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
      currentSessionId: sessionId,
      childSessions: new Map<string, ChildSessionState>(),
      status: "idle",
      error: null,
    })

    void get()._persistState()
  },

  deleteSession: async (worktreeId: string, sessionId: string) => {
    const { chatByWorktree, messagesBySession, activePromptBySession, currentSessionId } = get()
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
          sessions: updatedSessions,
          activeSessionId: nextActiveSessionId,
        },
      },
      messagesBySession: nextMessages,
      activePromptBySession: nextPromptState,
      currentSessionId: currentSessionId === sessionId ? nextActiveSessionId : currentSessionId,
    })

    await get()._persistState()
  },

  archiveSession: async (worktreeId: string, sessionId: string) => {
    const { chatByWorktree, activePromptBySession, currentSessionId } = get()
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
      currentSessionId: currentSessionId === sessionId ? nextActiveSessionId : currentSessionId,
    })

    await get()._persistState()
  },

  selectHarness: async (worktreeId: string, harnessId: HarnessId) => {
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

  listAgents: async (worktreeId: string) => {
    const projectChat = get().getProjectChat(worktreeId)
    const adapter = getHarnessAdapter(projectChat.selectedHarnessId)
    return adapter.listAgents()
  },

  listCommands: async (worktreeId: string) => {
    const projectChat = get().getProjectChat(worktreeId)
    const adapter = getHarnessAdapter(projectChat.selectedHarnessId)
    return adapter.listCommands()
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

    console.info("[chatStore] answerPrompt:start", {
      sessionId,
      promptId: response.promptId,
      promptKind: activePrompt.prompt.kind,
      responseKind: response.kind,
      decision: response.kind === "approval" ? response.decision : null,
    })

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

      console.info("[chatStore] answerPrompt:result", {
        sessionId,
        promptId: response.promptId,
        messages: result.messages?.length ?? 0,
        childSessions: result.childSessions?.length ?? 0,
        hasPrompt: result.prompt !== undefined,
        didReceiveContinuation,
      })

      if (!didReceiveContinuation) {
        console.warn("[chatStore] answerPrompt:empty-result", {
          sessionId,
          promptId: response.promptId,
        })
      }

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
    if (!text.trim()) {
      return
    }

    const sessionMatch = findProjectForSession(get().chatByWorktree, sessionId)
    if (!sessionMatch) {
      return
    }

    const { worktreeId, projectChat, session } = sessionMatch
    const adapter = getHarnessAdapter(session.harnessId)
    const userMessage = createTextMessage(sessionId, "user", text.trim())
    const nextSessionTitle = session.title?.trim() ? session.title : deriveSessionTitle(text)
    let nextSession = touchSession(session, nextSessionTitle)
    const nextMessages = [...(get().messagesBySession[sessionId] ?? []), userMessage]

    set({
      chatByWorktree: {
        ...get().chatByWorktree,
        [worktreeId]: {
          ...projectChat,
          sessions: replaceSession(projectChat.sessions, nextSession),
          activeSessionId: sessionId,
        },
      },
      messagesBySession: {
        ...get().messagesBySession,
        [sessionId]: nextMessages,
      },
      currentSessionId: sessionId,
      childSessions: new Map<string, ChildSessionState>(),
      status: "streaming",
      error: null,
    })

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
    }) => {
      set((state) => {
        if (!getProjectSessionMatch(state.chatByWorktree, worktreeId, sessionId)) {
          return {}
        }

        const previousMessages = getSessionMessages(state.messagesBySession, sessionId)
        const sessionMessages = mergeSessionMessages(previousMessages, partialResult.messages)
        const nextPromptState =
          partialResult.prompt === undefined
            ? state.activePromptBySession
            : replacePromptState(
                state.activePromptBySession,
                sessionId,
                getNormalizedPromptState(partialResult.prompt)
              )

        return {
          messagesBySession: {
            ...state.messagesBySession,
            [sessionId]: sessionMessages,
          },
          activePromptBySession: nextPromptState,
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
    }) => {
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
        projectPath: projectChat.worktreePath,
        text: text.trim(),
        agent: options?.agent,
        collaborationMode: options?.collaborationMode,
        model: options?.model,
        reasoningEffort: options?.reasoningEffort,
        onUpdate: handleStreamingUpdate,
      })

    try {
      if (!nextSession.remoteId) {
        const remoteSession = await adapter.createSession(
          projectChat.worktreePath ?? nextSession.projectPath ?? ""
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
        console.warn("[chatStore] sendMessage:recreate-session", {
          sessionId,
          remoteId: session.remoteId ?? session.id,
          reason: String(error),
        })

        try {
          const recreatedRemoteSession = await adapter.createSession(
            projectChat.worktreePath ?? session.projectPath ?? ""
          )
          console.info("[chatStore] sendMessage:recreate-session:created", {
            sessionId,
            previousRemoteId: session.remoteId ?? session.id,
            nextRemoteId: recreatedRemoteSession.remoteId ?? recreatedRemoteSession.id,
          })

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

          set({
            currentSessionId: sessionId,
            status: "streaming",
            error: null,
          })

          const retriedResult = await runSend(recoveredSession)
          console.info("[chatStore] sendMessage:recreate-session:retried", {
            sessionId,
            remoteId: recoveredSession.remoteId ?? recoveredSession.id,
            messages: retriedResult.messages?.length ?? 0,
            childSessions: retriedResult.childSessions?.length ?? 0,
            hasPrompt: retriedResult.prompt !== undefined,
          })

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

  abortSession: async (sessionId: string) => {
    const sessionMatch = findProjectForSession(get().chatByWorktree, sessionId)
    if (!sessionMatch) {
      return
    }

    await getHarnessAdapter(sessionMatch.session.harnessId).abortSession(sessionMatch.session)
    set({ status: "idle" })
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
    clearScheduledPersist()
    const { chatByWorktree, messagesBySession } = get()
    const store = await getStore()
    await store.set("chatState", {
      chatByWorktree,
      messagesBySession,
      activePromptBySession: {},
    } satisfies PersistedChatState)
    await store.save()
  },
}))

export type { MessageWithParts, ChildSessionState, RuntimeSession as Session } from "../types"
