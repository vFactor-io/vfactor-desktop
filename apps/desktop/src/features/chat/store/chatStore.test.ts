import { beforeEach, describe, expect, mock, test } from "bun:test"

const storeData = new Map<string, unknown>()
let pendingHarnessTurn: Promise<{ messages?: Array<{ info: { id: string; sessionId: string; role: "assistant"; createdAt: number }; parts: Array<{ id: string; type: "text"; text: string }> }> }> | null = null
let lastHarnessTurnInput: { text: string } | null = null

const desktopStore = {
  get: async <T>(key: string): Promise<T | null> =>
    storeData.has(key) ? (storeData.get(key) as T) : null,
  set: async (key: string, value: unknown) => {
    storeData.set(key, value)
  },
  delete: async (key: string) => {
    storeData.delete(key)
  },
  save: async () => {},
}

mock.module("@/desktop/client", () => ({
  desktop: {
    fs: {
      exists: async () => true,
      homeDir: async () => "/Users/tester",
    },
    git: {
      getBranches: async () => null,
      listWorktrees: async () => [],
      createWorktree: async () => ({ worktree: { branchName: "", path: "" } }),
      renameWorktree: async () => ({ worktree: { branchName: "", path: "" } }),
      removeWorktree: async () => ({ worktreePath: "" }),
      getChanges: async () => [],
    },
  },
  loadDesktopStore: async () => desktopStore,
}))

mock.module("@/features/workspace/store", () => ({
  useProjectStore: {
    getState: () => ({
      projects: [],
      isLoading: false,
      loadProjects: async () => {},
    }),
  },
}))

mock.module("../runtime/harnesses", () => ({
  DEFAULT_HARNESS_ID: "codex",
  listHarnesses: () => [],
  getHarnessDefinition: () => ({
    id: "codex",
    label: "Codex",
    description: "Codex",
    adapterStatus: "experimental",
    capabilities: {
      supportsCommands: false,
      supportsAgentMentions: false,
      supportsFileSearch: false,
      supportsSubagents: false,
      supportsArchive: true,
      supportsDelete: true,
    },
  }),
  getHarnessAdapter: () => ({
    definition: {
      id: "codex",
      label: "Codex",
      description: "Codex",
      adapterStatus: "experimental",
      capabilities: {
        supportsCommands: false,
        supportsAgentMentions: false,
        supportsFileSearch: false,
        supportsSubagents: false,
        supportsArchive: true,
        supportsDelete: true,
      },
    },
    initialize: async () => {},
    createSession: async (projectPath: string) => ({
      id: "remote-session",
      remoteId: "remote-session",
      harnessId: "codex",
      projectPath,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
    listAgents: async () => [],
    listCommands: async () => [],
    listModels: async () => [],
    searchFiles: async () => [],
    sendMessage: async (input: { text: string }) => {
      lastHarnessTurnInput = input
      return pendingHarnessTurn ?? { messages: [] }
    },
    answerPrompt: async () => ({ messages: [] }),
    executeCommand: async () => ({ messages: [] }),
    abortSession: async () => {},
  }),
}))

const { useChatStore } = await import("./chatStore")

function resetChatStore() {
  useChatStore.setState({
    chatByWorktree: {},
    messagesBySession: {},
    activePromptBySession: {},
    sessionActivityById: {},
    currentSessionId: null,
    childSessions: new Map(),
    workspaceSetupByProject: {},
    status: "idle",
    error: null,
    isLoading: false,
    isInitialized: true,
  })
}

describe("chatStore worktree scoping", () => {
  beforeEach(() => {
    storeData.clear()
    pendingHarnessTurn = null
    lastHarnessTurnInput = null
    resetChatStore()
  })

  test("keeps chat sessions isolated per worktree", async () => {
    const firstSession = useChatStore.getState().createOptimisticSession("worktree-1", "/tmp/worktree-1")
    expect(firstSession).not.toBeNull()

    await useChatStore.getState().loadSessionsForProject("worktree-2", "/tmp/worktree-2")

    const firstWorktreeChat = useChatStore.getState().getProjectChat("worktree-1")
    const secondWorktreeChat = useChatStore.getState().getProjectChat("worktree-2")

    expect(firstWorktreeChat.sessions.map((session) => session.id)).toEqual([firstSession!.id])
    expect(secondWorktreeChat.sessions).toEqual([])
    expect(secondWorktreeChat.activeSessionId).toBeNull()
    expect(secondWorktreeChat.worktreePath).toBe("/tmp/worktree-2")
  })

  test("removes only the deleted worktree chat bucket", async () => {
    const firstSession = useChatStore.getState().createOptimisticSession("worktree-1", "/tmp/worktree-1")
    const secondSession = useChatStore.getState().createOptimisticSession("worktree-2", "/tmp/worktree-2")

    expect(firstSession).not.toBeNull()
    expect(secondSession).not.toBeNull()

    await useChatStore.getState().removeWorktreeData("worktree-1")

    expect(useChatStore.getState().chatByWorktree["worktree-1"]).toBeUndefined()
    expect(useChatStore.getState().chatByWorktree["worktree-2"]?.sessions.map((session) => session.id)).toEqual([
      secondSession!.id,
    ])
  })

  test("persists the selected model on a chat session", async () => {
    const session = useChatStore.getState().createOptimisticSession("worktree-1", "/tmp/worktree-1")

    expect(session).not.toBeNull()

    await useChatStore.getState().setSessionModel(session!.id, "gpt-5.4")

    const persisted = storeData.get("chatState") as {
      chatByWorktree: Record<string, { sessions: Array<{ model?: string | null }> }>
    }

    expect(
      useChatStore.getState().chatByWorktree["worktree-1"]?.sessions.find(
        (candidate) => candidate.id === session!.id
      )?.model
    ).toBe("gpt-5.4")
    expect(persisted.chatByWorktree["worktree-1"]?.sessions[0]?.model).toBe("gpt-5.4")
  })

  test("clears transient session state when deleting the active session", async () => {
    const firstSession = useChatStore.getState().createOptimisticSession("worktree-1", "/tmp/worktree-1")
    const secondSession = useChatStore.getState().createOptimisticSession("worktree-1", "/tmp/worktree-1")

    expect(firstSession).not.toBeNull()
    expect(secondSession).not.toBeNull()

    useChatStore.setState({
      currentSessionId: firstSession!.id,
      childSessions: new Map([
        [
          "child-1",
          {
            session: {
              id: "child-1",
              harnessId: "codex",
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
            toolParts: [],
            isActive: true,
          },
        ],
      ]),
      status: "streaming",
      error: "Boom",
    })

    await useChatStore.getState().deleteSession("worktree-1", firstSession!.id)

    expect(useChatStore.getState().getProjectChat("worktree-1").activeSessionId).toBe(secondSession!.id)
    expect(useChatStore.getState().currentSessionId).toBe(secondSession!.id)
    expect(useChatStore.getState().childSessions.size).toBe(0)
    expect(useChatStore.getState().status).toBe("idle")
    expect(useChatStore.getState().error).toBeNull()
  })

  test("ignores selecting a session that is not present in the worktree", async () => {
    await useChatStore.getState().loadSessionsForProject("worktree-1", "/tmp/worktree-1")

    await useChatStore.getState().selectSession("worktree-1", "missing-session")

    const persisted = storeData.get("chatState") as {
      chatByWorktree: Record<string, { sessions: Array<{ id: string }>; activeSessionId: string | null }>
      messagesBySession: Record<string, unknown[]>
    }

    expect(useChatStore.getState().chatByWorktree["worktree-1"]?.activeSessionId).toBeNull()
    expect(useChatStore.getState().currentSessionId).toBeNull()
    expect(persisted.chatByWorktree["worktree-1"]?.activeSessionId).toBeNull()
    expect(persisted.chatByWorktree["worktree-1"]?.sessions).toEqual([])
    expect(persisted.messagesBySession).toEqual({})
  })

  test("loads persisted chat state before adding a worktree bucket", async () => {
    storeData.set("chatState", {
      chatByWorktree: {
        "worktree-1": {
          sessions: [
            {
              id: "draft-session-1",
              harnessId: "codex",
              projectPath: "/tmp/worktree-1",
              title: "Ping",
              createdAt: 100,
              updatedAt: 200,
            },
          ],
          activeSessionId: "draft-session-1",
          worktreePath: "/tmp/worktree-1",
          archivedSessionIds: [],
          selectedHarnessId: "codex",
        },
      },
      messagesBySession: {
        "draft-session-1": [
          {
            info: {
              id: "message-1",
              sessionId: "draft-session-1",
              role: "user",
              createdAt: 150,
            },
            parts: [
              {
                id: "part-1",
                type: "text",
                text: "Ping",
              },
            ],
          },
        ],
      },
      activePromptBySession: {},
    })

    useChatStore.setState({
      chatByWorktree: {},
      messagesBySession: {},
      activePromptBySession: {},
      sessionActivityById: {},
      currentSessionId: null,
      childSessions: new Map(),
      workspaceSetupByProject: {},
      status: "idle",
      error: null,
      isLoading: false,
      isInitialized: false,
    })

    await useChatStore.getState().loadSessionsForProject("worktree-1", "/tmp/worktree-1")

    expect(useChatStore.getState().isInitialized).toBe(true)
    expect(useChatStore.getState().chatByWorktree["worktree-1"]?.sessions.map((session) => session.id)).toEqual([
      "draft-session-1",
    ])
    expect(useChatStore.getState().chatByWorktree["worktree-1"]?.activeSessionId).toBe("draft-session-1")
    const restoredMessagePart = useChatStore.getState().messagesBySession["draft-session-1"]?.[0]?.parts[0]
    expect(restoredMessagePart && "text" in restoredMessagePart ? restoredMessagePart.text : undefined).toBe(
      "Ping"
    )

    const persisted = storeData.get("chatState") as {
      chatByWorktree: Record<string, { sessions: Array<{ id: string }>; activeSessionId: string | null }>
      messagesBySession: Record<string, Array<{ parts: Array<{ text?: string }> }>>
    }

    expect(persisted.chatByWorktree["worktree-1"]?.sessions.map((session) => session.id)).toEqual([
      "draft-session-1",
    ])
    expect(persisted.chatByWorktree["worktree-1"]?.activeSessionId).toBe("draft-session-1")
    const persistedMessagePart = persisted.messagesBySession["draft-session-1"]?.[0]?.parts[0]
    expect(persistedMessagePart && "text" in persistedMessagePart ? persistedMessagePart.text : undefined).toBe(
      "Ping"
    )
  })

  test("does not create an optimistic session before initialization", () => {
    useChatStore.setState({
      chatByWorktree: {},
      messagesBySession: {},
      activePromptBySession: {},
      sessionActivityById: {},
      currentSessionId: null,
      childSessions: new Map(),
      workspaceSetupByProject: {},
      status: "idle",
      error: null,
      isLoading: false,
      isInitialized: false,
    })

    const session = useChatStore.getState().createOptimisticSession("worktree-1", "/tmp/worktree-1")

    expect(session).toBeNull()
    expect(useChatStore.getState().chatByWorktree).toEqual({})
    expect(storeData.get("chatState")).toBeUndefined()
  })

  test("persists the pending user turn before the harness finishes", async () => {
    type HarnessTurnValue = {
      messages: Array<{
        info: { id: string; sessionId: string; role: "assistant"; createdAt: number }
        parts: Array<{ id: string; type: "text"; text: string }>
      }>
    }

    let resolveHarnessTurn: ((value: HarnessTurnValue) => void) | null = null
    pendingHarnessTurn = new Promise((resolve) => {
      resolveHarnessTurn = resolve
    })

    const session = useChatStore.getState().createOptimisticSession("worktree-1", "/tmp/worktree-1")

    expect(session).not.toBeNull()

    const sendPromise = useChatStore.getState().sendMessage(session!.id, "Ping")

    await new Promise((resolve) => setTimeout(resolve, 0))

    const persisted = storeData.get("chatState") as {
      chatByWorktree: Record<string, { sessions: Array<{ id: string; title?: string; remoteId?: string }>; activeSessionId: string | null }>
      messagesBySession: Record<string, Array<{ parts: Array<{ type: string; text?: string }> }>>
    }

    expect(persisted.chatByWorktree["worktree-1"]?.sessions.map((candidate) => candidate.id)).toEqual([
      session!.id,
    ])
    expect(persisted.chatByWorktree["worktree-1"]?.sessions[0]?.title).toBe("Ping")
    expect(persisted.chatByWorktree["worktree-1"]?.sessions[0]?.remoteId).toBeUndefined()
    expect(persisted.chatByWorktree["worktree-1"]?.activeSessionId).toBe(session!.id)
    expect(persisted.messagesBySession[session!.id]?.[0]?.parts[0]?.text).toBe("Ping")

    resolveHarnessTurn!({
      messages: [
        {
          info: {
            id: "assistant-message",
            sessionId: session!.id,
            role: "assistant",
            createdAt: Date.now(),
          },
          parts: [
            {
              id: "assistant-text",
              type: "text",
              text: "Pong",
            },
          ],
        },
      ],
    })

    await sendPromise
  })

  test("marks a finished background session as unread until it is reselected", async () => {
    type HarnessTurnValue = {
      messages: Array<{
        info: { id: string; sessionId: string; role: "assistant"; createdAt: number }
        parts: Array<{ id: string; type: "text"; text: string }>
      }>
    }

    let resolveHarnessTurn: ((value: HarnessTurnValue) => void) | null = null
    pendingHarnessTurn = new Promise((resolve) => {
      resolveHarnessTurn = resolve
    })

    const firstSession = useChatStore.getState().createOptimisticSession("worktree-1", "/tmp/worktree-1")
    const secondSession = useChatStore.getState().createOptimisticSession("worktree-1", "/tmp/worktree-1")

    expect(firstSession).not.toBeNull()
    expect(secondSession).not.toBeNull()

    await useChatStore.getState().selectSession("worktree-1", firstSession!.id)
    const sendPromise = useChatStore.getState().sendMessage(firstSession!.id, "Ping")

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(useChatStore.getState().sessionActivityById[firstSession!.id]).toEqual({
      status: "connecting",
      unread: false,
    })

    await useChatStore.getState().selectSession("worktree-1", secondSession!.id)

    resolveHarnessTurn!({
      messages: [
        {
          info: {
            id: "assistant-message",
            sessionId: firstSession!.id,
            role: "assistant",
            createdAt: Date.now(),
          },
          parts: [
            {
              id: "assistant-text",
              type: "text",
              text: "Pong",
            },
          ],
        },
      ],
    })

    await sendPromise

    expect(useChatStore.getState().sessionActivityById[firstSession!.id]).toEqual({
      status: "idle",
      unread: true,
    })

    const persisted = storeData.get("chatState") as {
      sessionActivityById: Record<string, { status: string; unread: boolean }>
    }

    expect(persisted.sessionActivityById[firstSession!.id]).toEqual({
      status: "idle",
      unread: true,
    })

    await useChatStore.getState().selectSession("worktree-1", firstSession!.id)

    expect(useChatStore.getState().sessionActivityById[firstSession!.id]).toEqual({
      status: "idle",
      unread: false,
    })
  })

  test("sends attachment context through text transport while persisting local attachment parts", async () => {
    const session = useChatStore.getState().createOptimisticSession("worktree-1", "/tmp/worktree-1")

    expect(session).not.toBeNull()

    await useChatStore.getState().sendMessage(session!.id, "", {
      attachments: [
        {
          id: "attachment-1",
          type: "attachment",
          kind: "image",
          label: "diagram.png",
          relativePath: ".nucleus/chat-inputs/2026-04-07/attachment-1-diagram.png",
          absolutePath: "/tmp/worktree-1/.nucleus/chat-inputs/2026-04-07/attachment-1-diagram.png",
          mediaType: "image/png",
          sizeBytes: 128,
        },
      ],
    })

    expect(lastHarnessTurnInput?.text).toContain("Attached local context:")
    expect(lastHarnessTurnInput?.text).toContain(
      '- image "diagram.png": .nucleus/chat-inputs/2026-04-07/attachment-1-diagram.png'
    )

    const persisted = storeData.get("chatState") as {
      chatByWorktree: Record<string, { sessions: Array<{ title?: string }> }>
      messagesBySession: Record<
        string,
        Array<{
          parts: Array<{ type: string; label?: string; relativePath?: string }>
        }>
      >
    }

    expect(persisted.chatByWorktree["worktree-1"]?.sessions[0]?.title).toBe("diagram.png")
    expect(persisted.messagesBySession[session!.id]?.[0]?.parts).toEqual([
      expect.objectContaining({
        type: "attachment",
        label: "diagram.png",
        relativePath: ".nucleus/chat-inputs/2026-04-07/attachment-1-diagram.png",
      }),
    ])
  })

  test("normalizes persisted running session badges back to idle on startup", async () => {
    storeData.set("chatState", {
      chatByWorktree: {
        "worktree-1": {
          sessions: [
            {
              id: "draft-session-1",
              harnessId: "codex",
              projectPath: "/tmp/worktree-1",
              title: "Ping",
              createdAt: 100,
              updatedAt: 200,
            },
          ],
          activeSessionId: "draft-session-1",
          worktreePath: "/tmp/worktree-1",
          archivedSessionIds: [],
          selectedHarnessId: "codex",
        },
      },
      messagesBySession: {},
      activePromptBySession: {},
      sessionActivityById: {
        "draft-session-1": {
          status: "streaming",
          unread: true,
        },
      },
    })

    useChatStore.setState({
      chatByWorktree: {},
      messagesBySession: {},
      activePromptBySession: {},
      sessionActivityById: {},
      currentSessionId: null,
      childSessions: new Map(),
      workspaceSetupByProject: {},
      status: "idle",
      error: null,
      isLoading: false,
      isInitialized: false,
    })

    await useChatStore.getState().loadSessionsForProject("worktree-1", "/tmp/worktree-1")

    expect(useChatStore.getState().sessionActivityById["draft-session-1"]).toEqual({
      status: "idle",
      unread: true,
    })
  })
})
