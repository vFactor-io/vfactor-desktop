import os from "node:os"
import { existsSync, statSync } from "node:fs"
import pty, { type IPty } from "node-pty"
import type {
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalStartResponse,
} from "../../src/desktop/contracts"
import { EVENT_CHANNELS } from "../ipc/channels"

const TERMINAL_SCROLLBACK_LIMIT = 200_000

type EventSender = (channel: string, payload: unknown) => void

interface TerminalSession {
  pty: IPty
  buffer: string
  exited: boolean
}

function trimScrollback(buffer: string): string {
  if (buffer.length <= TERMINAL_SCROLLBACK_LIMIT) {
    return buffer
  }

  return buffer.slice(buffer.length - TERMINAL_SCROLLBACK_LIMIT)
}

function resolveDefaultShell(): string {
  if (process.platform === "win32") {
    return process.env.COMSPEC || "powershell.exe"
  }

  return process.env.SHELL || "/bin/zsh"
}

export class TerminalService {
  private readonly sessions = new Map<string, TerminalSession>()

  constructor(private readonly sendEvent: EventSender) {}

  async createSession(
    sessionId: string,
    cwd: string,
    cols: number,
    rows: number
  ): Promise<TerminalStartResponse> {
    if (!sessionId.trim()) {
      throw new Error("Terminal session id is required")
    }

    const trimmedCwd = cwd.trim()
    if (!existsSync(trimmedCwd)) {
      throw new Error(`Terminal working directory does not exist: ${trimmedCwd}`)
    }

    if (!statSync(trimmedCwd).isDirectory()) {
      throw new Error(`Terminal working directory is not a folder: ${trimmedCwd}`)
    }

    const existing = this.sessions.get(sessionId)
    if (existing && !existing.exited) {
      existing.pty.resize(Math.max(1, cols), Math.max(1, rows))
      return { initialData: existing.buffer }
    }

    const shell = resolveDefaultShell()
    const shellArgs =
      process.platform === "win32"
        ? []
        : shell === "/bin/zsh" || shell === "/bin/bash" || shell.endsWith("/fish")
          ? ["-l"]
          : []

    const terminal = pty.spawn(shell, shellArgs, {
      name: "xterm-256color",
      cols: Math.max(1, cols),
      rows: Math.max(1, rows),
      cwd: trimmedCwd,
      env: { ...process.env, HOME: os.homedir() },
    })

    const session: TerminalSession = {
      pty: terminal,
      buffer: "",
      exited: false,
    }

    terminal.onData((data) => {
      session.buffer = trimScrollback(`${session.buffer}${data}`)

      const payload: TerminalDataEvent = {
        sessionId,
        data,
      }

      this.sendEvent(EVENT_CHANNELS.terminalData, payload)
    })

    terminal.onExit(() => {
      session.exited = true
      const payload: TerminalExitEvent = { sessionId }
      this.sendEvent(EVENT_CHANNELS.terminalExit, payload)
    })

    this.sessions.set(sessionId, session)
    return { initialData: session.buffer }
  }

  async write(sessionId: string, data: string): Promise<void> {
    const session = this.requireSession(sessionId)
    session.pty.write(data)
  }

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    const session = this.requireSession(sessionId)
    session.pty.resize(Math.max(1, cols), Math.max(1, rows))
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }

    session.exited = true
    session.pty.kill()
    this.sessions.delete(sessionId)
  }

  dispose(): void {
    for (const sessionId of this.sessions.keys()) {
      void this.closeSession(sessionId)
    }
  }

  private requireSession(sessionId: string): TerminalSession {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Unknown terminal session: ${sessionId}`)
    }

    if (session.exited) {
      throw new Error("Terminal session has exited")
    }

    return session
  }
}
