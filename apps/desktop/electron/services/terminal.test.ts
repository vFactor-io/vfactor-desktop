import { beforeEach, describe, expect, mock, test } from "bun:test"
import { accessSync, constants } from "node:fs"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const spawnMock = mock((_shell: string, _args: string[], options: { cwd: string }) =>
  createFakePty(options.cwd)
)

mock.module("node-pty", () => ({
  default: {
    spawn: spawnMock,
  },
  spawn: spawnMock,
}))

const { TerminalService } = await import("./terminal")

interface FakePty {
  cwd: string
  kill: ReturnType<typeof mock>
  resize: ReturnType<typeof mock>
  write: ReturnType<typeof mock>
  onData: (listener: (data: string) => void) => { dispose: () => void }
  onExit: (listener: (event: { exitCode: number }) => void) => { dispose: () => void }
  emitData: (data: string) => void
}

const fakePtys: FakePty[] = []

function createFakePty(cwd: string): FakePty {
  let dataListener: ((data: string) => void) | null = null
  let exitListener: ((event: { exitCode: number }) => void) | null = null

  const pty: FakePty = {
    cwd,
    kill: mock(() => {
      exitListener?.({ exitCode: 0 })
    }),
    resize: mock(() => {}),
    write: mock(() => {}),
    onData: (listener) => {
      dataListener = listener
      return {
        dispose: () => {
          if (dataListener === listener) {
            dataListener = null
          }
        },
      }
    },
    onExit: (listener) => {
      exitListener = listener
      return {
        dispose: () => {
          if (exitListener === listener) {
            exitListener = null
          }
        },
      }
    },
    emitData: (data) => {
      dataListener?.(data)
    },
  }

  fakePtys.push(pty)
  return pty
}

describe("TerminalService", () => {
  beforeEach(() => {
    fakePtys.length = 0
    spawnMock.mockReset()
    spawnMock.mockImplementation((_shell: string, _args: string[], options: { cwd: string }) =>
      createFakePty(options.cwd)
    )
  })

  test("recreates an existing session when the requested cwd changes", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "vfactor-terminal-test-"))
    const firstDir = path.join(rootDir, "first")
    const secondDir = path.join(rootDir, "second")
    const sendEvent = mock(() => {})

    await mkdir(firstDir, { recursive: true })
    await mkdir(secondDir, { recursive: true })

    try {
      const service = new TerminalService(sendEvent)

      await service.createSession("session-1", firstDir, 80, 24)
      await service.createSession("session-1", secondDir, 100, 30)

      expect(spawnMock).toHaveBeenCalledTimes(2)
      expect(fakePtys[0]?.kill).toHaveBeenCalledTimes(1)
      expect(fakePtys[1]?.cwd).toBe(secondDir)
      expect(sendEvent).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        sessionId: "session-1",
        exitCode: 0,
      }))
    } finally {
      await rm(rootDir, { recursive: true, force: true })
    }
  })

  test("falls back to a standard POSIX shell when the configured shell fails to spawn", async () => {
    if (process.platform === "win32") {
      return
    }

    const rootDir = await mkdtemp(path.join(tmpdir(), "vfactor-terminal-test-"))
    const sendEvent = mock(() => {})
    const originalShell = process.env.SHELL
    const availableShells = ["/bin/zsh", "/bin/bash", "/bin/sh"].filter((candidate) => {
      try {
        accessSync(candidate, constants.X_OK)
        return true
      } catch {
        return false
      }
    })

    if (availableShells.length < 2) {
      throw new Error("Expected at least two standard POSIX shells to be available for the test.")
    }

    const [configuredShell, fallbackShell] = availableShells

    process.env.SHELL = configuredShell
    spawnMock.mockImplementation((shell: string, _args: string[], options: { cwd: string }) => {
      if (shell === configuredShell) {
        throw new Error("posix_spawnp failed")
      }

      return createFakePty(options.cwd)
    })

    try {
      const service = new TerminalService(sendEvent)

      await service.createSession("session-1", rootDir, 80, 24)

      expect(spawnMock).toHaveBeenCalledTimes(2)
      expect(spawnMock.mock.calls[0]?.[0]).toBe(configuredShell)
      expect(spawnMock.mock.calls[1]?.[0]).toBe(fallbackShell)
    } finally {
      if (originalShell === undefined) {
        delete process.env.SHELL
      } else {
        process.env.SHELL = originalShell
      }

      await rm(rootDir, { recursive: true, force: true })
    }
  })

  test("keeps terminal data callback errors from escaping through node-pty", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "vfactor-terminal-test-"))
    const sendEvent = mock(() => {
      throw new Error("renderer is unavailable")
    })

    try {
      const service = new TerminalService(sendEvent)

      await service.createSession("session-1", rootDir, 80, 24)

      expect(() => fakePtys[0]?.emitData("hello")).not.toThrow()
      expect(sendEvent).toHaveBeenCalledTimes(1)
    } finally {
      await rm(rootDir, { recursive: true, force: true })
    }
  })

  test("disposes old terminal listeners before replacing a session cwd", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "vfactor-terminal-test-"))
    const firstDir = path.join(rootDir, "first")
    const secondDir = path.join(rootDir, "second")
    const sendEvent = mock(() => {})

    await mkdir(firstDir, { recursive: true })
    await mkdir(secondDir, { recursive: true })

    try {
      const service = new TerminalService(sendEvent)

      await service.createSession("session-1", firstDir, 80, 24)
      const oldPty = fakePtys[0]
      await service.createSession("session-1", secondDir, 80, 24)

      oldPty?.emitData("stale")

      expect(sendEvent).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        sessionId: "session-1",
        data: "stale",
      }))
    } finally {
      await rm(rootDir, { recursive: true, force: true })
    }
  })
})
