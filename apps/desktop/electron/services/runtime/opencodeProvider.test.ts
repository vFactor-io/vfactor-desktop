import { beforeEach, describe, expect, mock, test } from "bun:test"
import type { RuntimeTurnUpdateEvent } from "@/desktop/contracts"
import type { RuntimePrompt, RuntimeSession } from "@/features/chat/types"

class AsyncEventStream<T> implements AsyncGenerator<T, void> {
  private queue: T[] = []
  private resolvers: Array<(result: IteratorResult<T>) => void> = []
  private closed = false

  emit(value: T): void {
    const resolver = this.resolvers.shift()
    if (resolver) {
      resolver({ done: false, value })
      return
    }

    this.queue.push(value)
  }

  close(): void {
    this.closed = true
    while (this.resolvers.length > 0) {
      this.resolvers.shift()?.({ done: true, value: undefined })
    }
  }

  async next(): Promise<IteratorResult<T>> {
    const value = this.queue.shift()
    if (value !== undefined) {
      return { done: false, value }
    }

    if (this.closed) {
      return { done: true, value: undefined }
    }

    return new Promise((resolve) => {
      this.resolvers.push(resolve)
    })
  }

  async return(): Promise<IteratorResult<T>> {
    this.close()
    return { done: true, value: undefined }
  }

  async throw(error?: unknown): Promise<IteratorResult<T>> {
    this.close()
    throw error
  }

  [Symbol.asyncIterator](): AsyncGenerator<T, void> {
    return this
  }
}

const eventStream = new AsyncEventStream<any>()
const sessionCreateMock = mock(async () => ({
  data: {
    id: "session-1",
    title: "tmp-project",
    time: {
      created: 1,
      updated: 2,
    },
  },
}))
const sessionPromptMock = mock(async () => ({
  data: {
    info: {
      id: "assistant-1",
      sessionID: "session-1",
      role: "assistant",
      time: {
        created: 10,
        completed: 20,
      },
      parentID: "user-1",
      modelID: "gpt-5.4",
      providerID: "openai",
      mode: "build",
      agent: "build",
      path: {
        cwd: "/tmp/project",
        root: "/tmp/project",
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
      finish: "stop",
    },
    parts: [
      {
        id: "assistant-1-text",
        sessionID: "session-1",
        messageID: "assistant-1",
        type: "text",
        text: "Final answer",
      },
    ],
  },
}))
const sessionPromptAsyncMock = mock(async () => ({ data: undefined }))
const permissionReplyMock = mock(async () => ({ data: true }))
const questionReplyMock = mock(async () => ({ data: true }))
const sessionAbortMock = mock(async () => ({ data: true }))
const providerListMock = mock(async () => ({
  data: {
    all: [],
    default: {},
    connected: [],
  },
}))
const agentsMock = mock(async () => ({ data: [] }))
const commandsMock = mock(async () => ({ data: [] }))
const findFilesMock = mock(async () => ({ data: [] }))

mock.module("@opencode-ai/sdk/v2/client", () => ({
  createOpencodeClient: () => ({
    global: {
      event: async () => ({
        stream: eventStream,
      }),
    },
    session: {
      create: sessionCreateMock,
      prompt: sessionPromptMock,
      promptAsync: sessionPromptAsyncMock,
      abort: sessionAbortMock,
    },
    permission: {
      reply: permissionReplyMock,
    },
    question: {
      reply: questionReplyMock,
    },
    provider: {
      list: providerListMock,
    },
    app: {
      agents: agentsMock,
    },
    command: {
      list: commandsMock,
    },
    find: {
      files: findFilesMock,
    },
  }),
}))

describe("OpenCodeRuntimeProvider", () => {
  let persistence = new Map<string, any>()
  let updates: RuntimeTurnUpdateEvent[] = []

  const context = {
    emitUpdate: (
      remoteId: string,
      harnessId: RuntimeSession["harnessId"],
      result: RuntimeTurnUpdateEvent["result"]
    ) => {
      updates.push({ remoteId, harnessId, result })
    },
    persistence: {
      load: async (remoteId: string) => persistence.get(remoteId) ?? null,
      save: async (remoteId: string, metadata: any) => {
        persistence.set(remoteId, metadata)
      },
      delete: async (remoteId: string) => {
        persistence.delete(remoteId)
      },
    },
  }

  beforeEach(() => {
    persistence = new Map()
    updates = []
    eventStream.close()
    sessionCreateMock.mockClear()
    sessionPromptMock.mockClear()
    sessionPromptAsyncMock.mockClear()
    permissionReplyMock.mockClear()
    questionReplyMock.mockClear()
    sessionAbortMock.mockClear()
    providerListMock.mockClear()
    agentsMock.mockClear()
    commandsMock.mockClear()
    findFilesMock.mockClear()
  })

  test("creates and persists an OpenCode session shell", async () => {
    const { OpenCodeRuntimeProvider } = await import("./opencodeProvider")
    const provider = new OpenCodeRuntimeProvider(context, {
      getBaseUrl: async () => "http://127.0.0.1:4096",
    } as never)

    const session = await provider.createSession("/tmp/project")

    expect(session.harnessId).toBe("opencode")
    expect(session.remoteId).toBe("session-1")
    expect(persistence.get("session-1")).toEqual(
      expect.objectContaining({
        harnessId: "opencode",
        projectPath: "/tmp/project",
        state: {
          runtimeMode: "full-access",
        },
      })
    )
  })

  test("does not expose OpenCode command templates as inline input hints", async () => {
    commandsMock.mockResolvedValueOnce({
      data: [
        {
          name: "/review",
          description: "Review the current changes",
          template: "Review this repository and produce a detailed report with findings.",
          agent: "build",
          model: "gpt-5.5",
        },
      ],
    })

    const { OpenCodeRuntimeProvider } = await import("./opencodeProvider")
    const provider = new OpenCodeRuntimeProvider(context, {
      getBaseUrl: async () => "http://127.0.0.1:4096",
    } as never)

    const commands = await provider.listCommands("/tmp/project")

    expect(commands).toEqual([
      {
        name: "review",
        description: "Review the current changes",
        kind: "builtin",
        agent: "build",
        model: "gpt-5.5",
      },
    ])
    expect(commands[0]?.inputHint).toBeUndefined()
  })

  test("normalizes provider retry status events into runtime notices", async () => {
    const liveEventStream = new AsyncEventStream<any>()
    mock.module("@opencode-ai/sdk/v2/client", () => ({
      createOpencodeClient: () => ({
        global: {
          event: async () => ({
            stream: liveEventStream,
          }),
        },
        session: {
          create: sessionCreateMock,
          prompt: sessionPromptMock,
          promptAsync: sessionPromptAsyncMock,
          abort: sessionAbortMock,
        },
        permission: {
          reply: permissionReplyMock,
        },
        question: {
          reply: questionReplyMock,
        },
        provider: {
          list: providerListMock,
        },
        app: {
          agents: agentsMock,
        },
        command: {
          list: commandsMock,
        },
        find: {
          files: findFilesMock,
        },
      }),
    }))

    const { OpenCodeRuntimeProvider } = await import("./opencodeProvider")
    const provider = new OpenCodeRuntimeProvider(context, {
      getBaseUrl: async () => "http://127.0.0.1:4096",
    } as never)

    const session = await provider.createSession("/tmp/project")
    const streamingUpdates: Array<RuntimeTurnUpdateEvent["result"]> = []

    const sendPromise = provider.sendTurn({
      turnId: "turn-test",
      session,
      projectPath: "/tmp/project",
      text: "Ping",
      model: "opencode-go/kimi-k2.6",
      onUpdate: (result) => {
        streamingUpdates.push(result)
      },
    })
    await Bun.sleep(0)

    liveEventStream.emit({
      directory: "/tmp/project",
      payload: {
        type: "session.status",
        properties: {
          sessionID: "session-1",
          status: {
            type: "retry",
            attempt: 2,
            message: "Error from provider: Provider returned error",
            next: 12345,
          },
        },
      },
    })

    await Bun.sleep(20)

    const noticeUpdate = updates.find((event) => event.result.notices?.length)
    const notice = noticeUpdate?.result.notices?.[0]
    expect(notice).toMatchObject({
      harnessId: "opencode",
      providerId: "opencode-go",
      providerName: "OpenCode Go",
      modelId: "kimi-k2.6",
      modelName: "Kimi K2.6",
      kind: "retrying",
      severity: "warning",
      message: "Error from provider: Provider returned error",
      attempt: 2,
      retryAt: 12345,
    })
    expect(streamingUpdates.at(-1)?.notices?.[0]).toMatchObject({
      kind: "retrying",
      attempt: 2,
    })

    liveEventStream.emit({
      directory: "/tmp/project",
      payload: {
        type: "session.idle",
        properties: {
          sessionID: "session-1",
        },
      },
    })

    const result = await sendPromise

    expect(result.notices?.[0]).toMatchObject({
      kind: "recovered",
      severity: "info",
      attempt: 2,
    })
  })

  test("streams assistant text updates and clears approval prompts after reply", async () => {
    const liveEventStream = new AsyncEventStream<any>()
    mock.module("@opencode-ai/sdk/v2/client", () => ({
      createOpencodeClient: () => ({
        global: {
          event: async () => ({
            stream: liveEventStream,
          }),
        },
        session: {
          create: sessionCreateMock,
          prompt: sessionPromptMock,
          promptAsync: sessionPromptAsyncMock,
          abort: sessionAbortMock,
        },
        permission: {
          reply: permissionReplyMock,
        },
        question: {
          reply: questionReplyMock,
        },
        provider: {
          list: providerListMock,
        },
        app: {
          agents: agentsMock,
        },
        command: {
          list: commandsMock,
        },
        find: {
          files: findFilesMock,
        },
      }),
    }))

    const { OpenCodeRuntimeProvider } = await import("./opencodeProvider")
    const provider = new OpenCodeRuntimeProvider(context, {
      getBaseUrl: async () => "http://127.0.0.1:4096",
    } as never)

    const session = await provider.createSession("/tmp/project")
    const streamingUpdates: Array<RuntimeTurnUpdateEvent["result"]> = []

    const sendPromise = provider.sendTurn({
      turnId: "turn-test",
      session,
      projectPath: "/tmp/project",
      text: "Build this",
      modelVariant: "high",
      onUpdate: (result) => {
        streamingUpdates.push(result)
      },
    })
    await Bun.sleep(0)
    expect(sessionPromptAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "high",
      })
    )

    liveEventStream.emit({
      directory: "/tmp/project",
      payload: {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-1",
            sessionID: "session-1",
            role: "assistant",
            time: {
              created: 10,
            },
            parentID: "user-1",
            modelID: "gpt-5.4",
            providerID: "openai",
            mode: "build",
            agent: "build",
            path: {
              cwd: "/tmp/project",
              root: "/tmp/project",
            },
            cost: 0,
            tokens: {
              input: 0,
              output: 0,
              reasoning: 0,
              cache: {
                read: 0,
                write: 0,
              },
            },
          },
        },
      },
    })
    liveEventStream.emit({
      directory: "/tmp/project",
      payload: {
        type: "message.part.updated",
        properties: {
          part: {
            id: "assistant-1-text",
            sessionID: "session-1",
            messageID: "assistant-1",
            type: "text",
            text: "Streaming answer",
          },
        },
      },
    })
    liveEventStream.emit({
      directory: "/tmp/project",
      payload: {
        type: "permission.asked",
        properties: {
          id: "permission-1",
          sessionID: "session-1",
          permission: "bash",
          patterns: ["npm run build"],
          metadata: {},
          always: [],
          tool: {
            messageID: "assistant-1",
            callID: "tool-1",
          },
        },
      },
    })

    await Bun.sleep(20)

    const promptUpdate = updates.find((event) => event.result.prompt)!.result.prompt as RuntimePrompt
    expect(promptUpdate.kind).toBe("approval")
    expect(streamingUpdates.some((result) =>
      result.messages?.some((message) =>
        message.parts.some((part) => part.type === "text" && part.text === "Streaming answer")
      )
    )).toBe(true)

    await provider.answerPrompt({
      session,
      projectPath: "/tmp/project",
      prompt: promptUpdate,
      response: {
        kind: "approval",
        promptId: promptUpdate.id,
        decision: "approve",
        text: "Approve it",
      },
    })

    expect(permissionReplyMock).toHaveBeenCalledWith({
      requestID: "permission-1",
      directory: "/tmp/project",
      reply: "once",
    })
    expect(updates.at(-1)?.result.prompt).toBeNull()

    liveEventStream.emit({
      directory: "/tmp/project",
      payload: {
        type: "message.part.updated",
        properties: {
          part: {
            id: "assistant-1-text",
            sessionID: "session-1",
            messageID: "assistant-1",
            type: "text",
            text: "Final answer",
          },
        },
      },
    })
    liveEventStream.emit({
      directory: "/tmp/project",
      payload: {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-1",
            sessionID: "session-1",
            role: "assistant",
            time: {
              created: 10,
              completed: 20,
            },
            parentID: "user-1",
            modelID: "gpt-5.4",
            providerID: "openai",
            mode: "build",
            agent: "build",
            path: {
              cwd: "/tmp/project",
              root: "/tmp/project",
            },
            cost: 0,
            tokens: {
              input: 0,
              output: 0,
              reasoning: 0,
              cache: {
                read: 0,
                write: 0,
              },
            },
            finish: "stop",
          },
        },
      },
    })
    liveEventStream.emit({
      directory: "/tmp/project",
      payload: {
        type: "session.idle",
        properties: {
          sessionID: "session-1",
        },
      },
    })

    const result = await sendPromise

    expect(result.messages?.some((message) =>
      message.parts.some((part) => part.type === "text" && part.text === "Final answer")
    )).toBe(true)
    expect(result.messages?.find((message) =>
      message.parts.some((part) => part.type === "text" && part.text === "Final answer")
    )?.info.turnId).toBe("turn-test")
  })

  test("streams text from message.part.delta events before the final snapshot arrives", async () => {
    const liveEventStream = new AsyncEventStream<any>()
    mock.module("@opencode-ai/sdk/v2/client", () => ({
      createOpencodeClient: () => ({
        global: {
          event: async () => ({
            stream: liveEventStream,
          }),
        },
        session: {
          create: sessionCreateMock,
          prompt: sessionPromptMock,
          promptAsync: sessionPromptAsyncMock,
          abort: sessionAbortMock,
        },
        permission: {
          reply: permissionReplyMock,
        },
        question: {
          reply: questionReplyMock,
        },
        provider: {
          list: providerListMock,
        },
        app: {
          agents: agentsMock,
        },
        command: {
          list: commandsMock,
        },
        find: {
          files: findFilesMock,
        },
      }),
    }))

    const { OpenCodeRuntimeProvider } = await import("./opencodeProvider")
    const provider = new OpenCodeRuntimeProvider(context, {
      getBaseUrl: async () => "http://127.0.0.1:4096",
    } as never)

    const session = await provider.createSession("/tmp/project")
    const streamingUpdates: Array<RuntimeTurnUpdateEvent["result"]> = []

    const sendPromise = provider.sendTurn({
      turnId: "turn-test",
      session,
      projectPath: "/tmp/project",
      text: "Build this",
      onUpdate: (result) => {
        streamingUpdates.push(result)
      },
    })

    liveEventStream.emit({
      directory: "/tmp/project",
      payload: {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-1",
            sessionID: "session-1",
            role: "assistant",
            time: {
              created: 10,
            },
            parentID: "user-1",
            modelID: "gpt-5.4",
            providerID: "openai",
            mode: "build",
            agent: "build",
            path: {
              cwd: "/tmp/project",
              root: "/tmp/project",
            },
            cost: 0,
            tokens: {
              input: 0,
              output: 0,
              reasoning: 0,
              cache: {
                read: 0,
                write: 0,
              },
            },
          },
        },
      },
    })
    liveEventStream.emit({
      directory: "/tmp/project",
      payload: {
        type: "message.part.delta",
        properties: {
          sessionID: "session-1",
          messageID: "assistant-1",
          partID: "assistant-1-text",
          field: "text",
          delta: "Streaming ",
        },
      },
    })
    liveEventStream.emit({
      directory: "/tmp/project",
      payload: {
        type: "message.part.delta",
        properties: {
          sessionID: "session-1",
          messageID: "assistant-1",
          partID: "assistant-1-text",
          field: "text",
          delta: "answer",
        },
      },
    })

    await Bun.sleep(20)

    expect(updates.some((event) =>
      event.result.messages?.some((message) =>
        message.parts.some((part) => part.type === "text" && part.text === "Streaming answer")
      )
    )).toBe(true)

    liveEventStream.emit({
      directory: "/tmp/project",
      payload: {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-1",
            sessionID: "session-1",
            role: "assistant",
            time: {
              created: 10,
              completed: 20,
            },
            parentID: "user-1",
            modelID: "gpt-5.4",
            providerID: "openai",
            mode: "build",
            agent: "build",
            path: {
              cwd: "/tmp/project",
              root: "/tmp/project",
            },
            cost: 0,
            tokens: {
              input: 0,
              output: 0,
              reasoning: 0,
              cache: {
                read: 0,
                write: 0,
              },
            },
            finish: "stop",
          },
        },
      },
    })
    liveEventStream.emit({
      directory: "/tmp/project",
      payload: {
        type: "session.status",
        properties: {
          sessionID: "session-1",
          status: {
            type: "idle",
          },
        },
      },
    })

    await sendPromise
  })
})
