import { beforeEach, describe, expect, mock, test } from "bun:test"
import type { RuntimeTurnUpdateEvent } from "@/desktop/contracts"
import type { RuntimeSession } from "@/features/chat/types"

type QueryParams = {
  prompt: string | AsyncIterable<unknown>
  options?: Record<string, unknown>
}

class FakeQuery implements AsyncGenerator<any, void> {
  private queue: Array<any> = []
  private resolvers: Array<(result: IteratorResult<any>) => void> = []
  private closed = false
  private supportedModelsResult: Array<Record<string, unknown>> = []
  private initializationResultValue: Record<string, unknown> = { commands: [] }

  constructor(
    private readonly params: QueryParams,
    private readonly runner: (query: FakeQuery, params: QueryParams) => Promise<void> | void
  ) {
    queueMicrotask(() => {
      void this.runner(this, params)
    })
  }

  emit(value: any): void {
    const resolver = this.resolvers.shift()
    if (resolver) {
      resolver({ done: false, value })
      return
    }

    this.queue.push(value)
  }

  setSupportedModels(models: Array<Record<string, unknown>>): void {
    this.supportedModelsResult = models
  }

  setInitializationResult(result: Record<string, unknown>): void {
    this.initializationResultValue = result
  }

  finish(): void {
    this.closed = true
    while (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift()
      resolver?.({ done: true, value: undefined })
    }
  }

  async next(): Promise<IteratorResult<any>> {
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

  async return(): Promise<IteratorResult<any>> {
    this.finish()
    return { done: true, value: undefined }
  }

  async throw(error?: unknown): Promise<IteratorResult<any>> {
    this.finish()
    throw error
  }

  [Symbol.asyncIterator](): AsyncGenerator<any, void> {
    return this
  }

  async interrupt(): Promise<void> {
    this.finish()
  }

  async setModel(): Promise<void> {}

  async setPermissionMode(): Promise<void> {}

  async supportedModels(): Promise<Array<Record<string, unknown>>> {
    return this.supportedModelsResult
  }

  async initializationResult(): Promise<Record<string, unknown>> {
    return this.initializationResultValue
  }

  close(): void {
    this.finish()
  }
}

const queryMock = mock((_params: QueryParams) => {
  throw new Error("Missing FakeQuery runner")
})

mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  query: queryMock,
}))

describe("ClaudeRuntimeProvider", () => {
  let persistence = new Map<string, any>()
  let updates: RuntimeTurnUpdateEvent[] = []

  const context = {
    emitUpdate: (remoteId: string, harnessId: RuntimeSession["harnessId"], result: RuntimeTurnUpdateEvent["result"]) => {
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
    queryMock.mockReset()
  })

  test("creates a persisted Claude session shell", async () => {
    const { ClaudeRuntimeProvider } = await import("./claudeProvider")
    const provider = new ClaudeRuntimeProvider(context)

    const session = await provider.createSession("/tmp/project")

    expect(session.harnessId).toBe("claude-code")
    expect(session.remoteId).toStartWith("claude-")
    expect(persistence.get(session.remoteId!)).toEqual(
      expect.objectContaining({
        harnessId: "claude-code",
        projectPath: "/tmp/project",
      })
    )
  })

  test("loads Claude models from the SDK", async () => {
    queryMock.mockImplementation(
      (params: QueryParams) => {
        const fakeQuery = new FakeQuery(params, () => {}) as any
        fakeQuery.setSupportedModels([
          {
            value: "sonnet[1m]",
            displayName: "Claude Sonnet[1m]",
            description: "Balanced model",
            supportedEffortLevels: ["low", "medium", "high", "max"],
            supportsFastMode: false,
          },
          {
            value: "default",
            displayName: "Claude Default",
            description: "Default alias",
            supportedEffortLevels: ["low", "medium", "high", "max"],
            supportsFastMode: false,
          },
          {
            value: "claude-opus-4-6",
            displayName: "Claude Opus 4.6",
            description: "Power model",
            supportedEffortLevels: ["low", "medium", "high", "max"],
            supportsFastMode: true,
          },
          {
            value: "haiku",
            displayName: "Claude Haiku",
            description: "Fast model",
            supportedEffortLevels: [],
            supportsFastMode: false,
          },
        ])
        return fakeQuery
      }
    )

    const { ClaudeRuntimeProvider } = await import("./claudeProvider")
    const provider = new ClaudeRuntimeProvider(context)

    const models = await provider.listModels()

    expect(models).toHaveLength(3)
    expect(models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "claude-sonnet-4-6",
          displayName: "Claude Sonnet 4.6",
          isDefault: true,
          supportedReasoningEfforts: ["low", "medium", "high", "max"],
          defaultReasoningEffort: "high",
          supportsFastMode: false,
        }),
        expect.objectContaining({
          id: "claude-opus-4-6",
          displayName: "Claude Opus 4.6",
          isDefault: false,
          supportedReasoningEfforts: ["low", "medium", "high", "max"],
          defaultReasoningEffort: "high",
          supportsFastMode: true,
        }),
        expect.objectContaining({
          id: "claude-haiku-4-5",
          displayName: "Claude Haiku 4.5",
          isDefault: false,
          supportedReasoningEfforts: [],
        }),
      ])
    )
  })

  test("loads Claude slash commands from the SDK initialization result", async () => {
    queryMock.mockImplementation(
      (params: QueryParams) => {
        const fakeQuery = new FakeQuery(params, () => {}) as any
        fakeQuery.setInitializationResult({
          commands: [
            {
              name: "review",
              description: "Review a pull request",
              argumentHint: "<pr-or-branch>",
            },
            {
              name: "/review",
              description: "",
              argumentHint: "",
            },
            {
              name: "ui",
              description: "Refine a UI flow",
              argumentHint: "<screen>",
            },
          ],
        })
        return fakeQuery
      }
    )

    const { ClaudeRuntimeProvider } = await import("./claudeProvider")
    const provider = new ClaudeRuntimeProvider(context)

    const commands = await provider.listCommands()

    expect(commands).toEqual([
      {
        name: "review",
        description: "Review a pull request",
        kind: "builtin",
        inputHint: "<pr-or-branch>",
      },
      {
        name: "ui",
        description: "Refine a UI flow",
        kind: "builtin",
        inputHint: "<screen>",
      },
    ])
  })

  test("loads Claude slash commands from the requested project path", async () => {
    queryMock.mockImplementation(
      (params: QueryParams) => {
        const fakeQuery = new FakeQuery(params, () => {}) as any
        fakeQuery.setInitializationResult({
          commands: [
            {
              name: "review",
              description: "Review this project",
              argumentHint: "<target>",
            },
          ],
        })
        return fakeQuery
      }
    )

    const { ClaudeRuntimeProvider } = await import("./claudeProvider")
    const provider = new ClaudeRuntimeProvider(context)

    await provider.listCommands("/tmp/project-a")
    await provider.listCommands("/tmp/project-b")

    expect(queryMock.mock.calls.at(0)?.[0]?.options?.cwd).toBe("/tmp/project-a")
    expect(queryMock.mock.calls.at(1)?.[0]?.options?.cwd).toBe("/tmp/project-b")
  })

  test("streams assistant text and resolves the final turn", async () => {
    queryMock.mockImplementation(
      (params: QueryParams) =>
        new FakeQuery(params, async (query) => {
          query.emit({
            type: "system",
            subtype: "init",
            session_id: "claude-session-1",
          })
          query.emit({
            type: "stream_event",
            event: {
              type: "content_block_delta",
              delta: {
                type: "text_delta",
                text: "Hello",
              },
            },
            session_id: "claude-session-1",
          })
          query.emit({
            type: "assistant",
            message: {
              content: [{ type: "text", text: "Hello world" }],
            },
            parent_tool_use_id: null,
            session_id: "claude-session-1",
            uuid: "assistant-1",
          })
          query.emit({
            type: "result",
            subtype: "success",
            result: "Hello world",
            session_id: "claude-session-1",
          })
          query.finish()
        }) as any
    )

    const { ClaudeRuntimeProvider } = await import("./claudeProvider")
    const provider = new ClaudeRuntimeProvider(context)
    const session = await provider.createSession("/tmp/project")

    const result = await provider.sendTurn({
      session,
      projectPath: "/tmp/project",
      text: "Say hello",
    })

    expect(updates.length).toBeGreaterThan(0)
    expect(result.messages?.[0]?.parts[0]).toEqual(
      expect.objectContaining({
        type: "text",
        text: "Hello world",
      })
    )
    expect(persistence.get(session.remoteId!)?.state?.claudeSessionId).toBe("claude-session-1")
  })

  test("forwards Claude fast mode for Opus sessions", async () => {
    queryMock.mockImplementation(
      (params: QueryParams) =>
        new FakeQuery(params, async (query) => {
          query.emit({
            type: "system",
            subtype: "init",
            session_id: "claude-session-fast",
          })
          query.emit({
            type: "result",
            subtype: "success",
            result: "",
            session_id: "claude-session-fast",
          })
          query.finish()
        }) as any
    )

    const { ClaudeRuntimeProvider } = await import("./claudeProvider")
    const provider = new ClaudeRuntimeProvider(context)
    const session = await provider.createSession("/tmp/project")

    await provider.sendTurn({
      session,
      projectPath: "/tmp/project",
      text: "Use fast mode",
      model: "claude-opus-4-6",
      fastMode: true,
    })

    expect(queryMock.mock.calls.at(-1)?.[0]?.options?.settings).toEqual({
      fastMode: true,
    })
  })

  test("ignores Claude fast mode for non-Opus sessions", async () => {
    queryMock.mockImplementation(
      (params: QueryParams) =>
        new FakeQuery(params, async (query) => {
          query.emit({
            type: "system",
            subtype: "init",
            session_id: "claude-session-standard",
          })
          query.emit({
            type: "result",
            subtype: "success",
            result: "",
            session_id: "claude-session-standard",
          })
          query.finish()
        }) as any
    )

    const { ClaudeRuntimeProvider } = await import("./claudeProvider")
    const provider = new ClaudeRuntimeProvider(context)
    const session = await provider.createSession("/tmp/project")

    await provider.sendTurn({
      session,
      projectPath: "/tmp/project",
      text: "Do not use fast mode",
      model: "claude-sonnet-4-6",
      fastMode: true,
    })

    expect(queryMock.mock.calls.at(-1)?.[0]?.options?.settings).toBeUndefined()
  })

  test("emits approval prompts and continues after approval", async () => {
    queryMock.mockImplementation(
      (params: QueryParams) =>
        new FakeQuery(params, async (query, runtimeParams) => {
          query.emit({
            type: "system",
            subtype: "init",
            session_id: "claude-session-2",
          })

          const canUseTool = runtimeParams.options?.canUseTool as
            | ((...args: any[]) => Promise<unknown>)
            | undefined
          await canUseTool?.(
            "Bash",
            { command: "echo hi" },
            {
              signal: AbortSignal.timeout(1_000),
              title: "Approve Bash",
              decisionReason: "Claude wants to run a shell command.",
            }
          )

          query.emit({
            type: "result",
            subtype: "success",
            result: "Done",
            session_id: "claude-session-2",
          })
          query.finish()
        }) as any
    )

    const { ClaudeRuntimeProvider } = await import("./claudeProvider")
    const provider = new ClaudeRuntimeProvider(context)
    const session = await provider.createSession("/tmp/project")

    const sendPromise = provider.sendTurn({
      session,
      projectPath: "/tmp/project",
      text: "Run bash",
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    const promptEvent = updates.find((event) => event.result.prompt)
    expect(promptEvent?.result.prompt?.kind).toBe("approval")

    await provider.answerPrompt({
      session,
      projectPath: "/tmp/project",
      prompt: promptEvent!.result.prompt!,
      response: {
        kind: "approval",
        promptId: promptEvent!.result.prompt!.id,
        decision: "approve",
        text: "approved",
      },
    })

    const result = await sendPromise
    expect(result.messages?.[0]?.parts[0]).toEqual(
      expect.objectContaining({
        type: "text",
        text: "Done",
      })
    )
  })

  test("settles interrupted turns without leaving the session blocked", async () => {
    queryMock.mockImplementation(
      (params: QueryParams) =>
        new FakeQuery(params, async (query) => {
          query.emit({
            type: "system",
            subtype: "init",
            session_id: "claude-session-interrupt",
          })
          query.emit({
            type: "stream_event",
            event: {
              type: "content_block_delta",
              delta: {
                type: "text_delta",
                text: "Partial",
              },
            },
            session_id: "claude-session-interrupt",
          })
        }) as any
    )

    const { ClaudeRuntimeProvider } = await import("./claudeProvider")
    const provider = new ClaudeRuntimeProvider(context)
    const session = await provider.createSession("/tmp/project")

    const sendPromise = provider.sendTurn({
      session,
      projectPath: "/tmp/project",
      text: "Start and interrupt",
    })

    await new Promise((resolve) => setTimeout(resolve, 10))
    await provider.interruptTurn(session)

    const result = await sendPromise

    expect(provider.getActiveTurnCount()).toBe(0)
    expect(result.messages?.[0]?.parts[0]).toEqual(
      expect.objectContaining({
        type: "text",
        text: "Partial",
      })
    )
  })
})
