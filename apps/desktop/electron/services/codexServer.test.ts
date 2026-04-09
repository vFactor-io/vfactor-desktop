import { PassThrough } from "node:stream"
import { EventEmitter } from "node:events"
import { beforeEach, describe, expect, mock, test } from "bun:test"

const executablePaths = new Set<string>()
const spawnCalls: Array<{ command: string; args: string[]; options: { env?: NodeJS.ProcessEnv } }> = []
const pendingChildren: FakeChildProcess[] = []

const accessSyncMock = mock((filePath: string) => {
  if (!executablePaths.has(filePath)) {
    throw new Error(`ENOENT: ${filePath}`)
  }
})

const statSyncMock = mock((_filePath: string) => ({
  isFile: () => true,
}))

const spawnMock = mock(
  (command: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
    spawnCalls.push({ command, args, options })
    const child = new FakeChildProcess()
    pendingChildren.push(child)
    queueMicrotask(() => child.emit("spawn"))
    return child as unknown as import("node:child_process").ChildProcessWithoutNullStreams
  }
)

const execFileMock = mock(async () => ({
  stdout: "",
  stderr: "",
}))

const captureMock = mock(() => {})
const captureExceptionMock = mock(() => {})
const homedirMock = mock(() => "/Users/tester")

mock.module("node:fs", () => ({
  accessSync: accessSyncMock,
  constants: { X_OK: 1 },
  statSync: statSyncMock,
}))

mock.module("node:os", () => ({
  default: { homedir: homedirMock },
  homedir: homedirMock,
}))

mock.module("node:child_process", () => ({
  execFile: execFileMock,
  spawn: spawnMock,
}))

mock.module("./analytics", () => ({
  capture: captureMock,
  captureException: captureExceptionMock,
}))

class FakeChildProcess extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  stdin = {
    write: (_chunk: string, callback?: (error?: Error | null) => void) => {
      callback?.(null)
      return true
    },
  }
  exitCode: number | null = null
  killed = false

  kill() {
    this.killed = true
    this.emit("exit", 0, null)
    return true
  }
}

const { CodexServerService } = await import("./codexServer")

describe("CodexServerService", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    executablePaths.clear()
    spawnCalls.length = 0
    pendingChildren.length = 0
    accessSyncMock.mockClear()
    statSyncMock.mockClear()
    spawnMock.mockClear()
    execFileMock.mockClear()
    execFileMock.mockImplementation(async () => ({ stdout: "", stderr: "" }))
    captureMock.mockClear()
    captureExceptionMock.mockClear()
    homedirMock.mockClear()
    homedirMock.mockReturnValue("/Users/tester")

    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key]
      }
    }

    Object.assign(process.env, originalEnv)
    process.env.PATH = "/usr/bin:/bin:/usr/sbin:/sbin"
    delete process.env.NUCLEUS_CODEX_PATH
    delete process.env.SHELL
  })

  test("resolves codex from common packaged-app install locations", async () => {
    executablePaths.add("/opt/homebrew/bin/codex")

    const service = new CodexServerService(() => {})
    await expect(service.ensureServer()).resolves.toBe("Codex App Server started")

    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(spawnCalls[0]?.command).toBe("/opt/homebrew/bin/codex")
    expect(spawnCalls[0]?.args).toEqual(["app-server"])
    expect(spawnCalls[0]?.options.env?.PATH?.split(":")).toContain("/opt/homebrew/bin")
  })

  test("rejects startup when codex cannot be found", async () => {
    execFileMock.mockImplementation(async () => {
      throw new Error("not found")
    })

    const service = new CodexServerService(() => {})

    await expect(service.ensureServer()).rejects.toThrow(
      "Unable to find the Codex CLI"
    )
    expect(spawnMock).not.toHaveBeenCalled()
  })

  test("does not report success when the child emits a startup error", async () => {
    executablePaths.add("/Users/tester/.bun/bin/codex")
    spawnMock.mockImplementationOnce(
      (command: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
        spawnCalls.push({ command, args, options })
        const child = new FakeChildProcess()
        pendingChildren.push(child)
        queueMicrotask(() => child.emit("error", new Error("spawn failed")))
        return child as unknown as import("node:child_process").ChildProcessWithoutNullStreams
      }
    )

    const sendEvent = mock(() => {})
    const service = new CodexServerService(sendEvent)

    await expect(service.ensureServer()).rejects.toThrow("spawn failed")
    expect(sendEvent).toHaveBeenCalledWith("codex-rpc:status", "closed")
  })

  test("counts pending turn starts as active work after a successful send", async () => {
    executablePaths.add("/Users/tester/.bun/bin/codex")

    const service = new CodexServerService(() => {})
    await service.ensureServer()
    await service.send(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "turn/start" }))

    expect(service.getActiveTurnCount()).toBe(1)
  })

  test("does not count pending turn starts when stdin write fails", async () => {
    executablePaths.add("/Users/tester/.bun/bin/codex")

    const service = new CodexServerService(() => {})
    await service.ensureServer()
    const child = pendingChildren[0]

    if (!child) {
      throw new Error("Expected a spawned child process")
    }

    child.stdin.write = (_chunk: string, callback?: (error?: Error | null) => void) => {
      callback?.(new Error("write failed"))
      return false
    }

    await expect(
      service.send(JSON.stringify({ jsonrpc: "2.0", id: 9, method: "turn/start" }))
    ).rejects.toThrow("write failed")
    expect(service.getActiveTurnCount()).toBe(0)
  })
})
