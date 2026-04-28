import os from "node:os"
import { accessSync, constants, existsSync, statSync } from "node:fs"
import pty, { type IPty } from "node-pty"
import type {
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalStartResponse,
} from "../../src/desktop/contracts"
import { EVENT_CHANNELS } from "../ipc/channels"
import { capture, captureException } from "./analytics"

const TERMINAL_SCROLLBACK_LIMIT = 200_000

type EventSender = (channel: string, payload: unknown) => void

interface TerminalSession {
  pty: IPty
  eventDisposables: Array<{ dispose: () => void }>
  buffer: string
  cwd: string
  exited: boolean
  suppressExitEvent: boolean
  shellKind: TerminalStartResponse["shellKind"]
}

interface ShellLaunchConfig {
  shell: string
  shellArgs: string[]
  shellKind: TerminalStartResponse["shellKind"]
}

function trimScrollback(buffer: string): string {
  if (buffer.length <= TERMINAL_SCROLLBACK_LIMIT) {
    return buffer
  }

  return buffer.slice(buffer.length - TERMINAL_SCROLLBACK_LIMIT)
}

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function resolvePosixShellCandidates(): string[] {
  const candidates = [process.env.SHELL?.trim(), "/bin/zsh", "/bin/bash", "/bin/sh"]

  const dedupedCandidates: string[] = []
  for (const candidate of candidates) {
    if (!candidate || dedupedCandidates.includes(candidate) || !candidate.startsWith("/")) {
      continue
    }

    if (isExecutableFile(candidate)) {
      dedupedCandidates.push(candidate)
    }
  }

  return dedupedCandidates
}

function resolveDefaultShell(): string {
  if (process.platform === "win32") {
    return process.env.COMSPEC || "powershell.exe"
  }

  const [shell] = resolvePosixShellCandidates()
  if (shell) {
    return shell
  }

  throw new Error("Unable to find a usable POSIX shell for the terminal session.")
}

function resolveShellKind(shell: string): TerminalStartResponse["shellKind"] {
  if (process.platform !== "win32") {
    return "posix"
  }

  const normalizedShell = shell.toLowerCase()

  if (normalizedShell.includes("powershell") || normalizedShell.endsWith("pwsh.exe")) {
    return "powershell"
  }

  return "cmd"
}

function resolveShellArgs(shell: string): string[] {
  if (process.platform === "win32") {
    return []
  }

  if (shell === "/bin/zsh" || shell === "/bin/bash" || shell.endsWith("/fish")) {
    return ["-l"]
  }

  return []
}

function createTerminalPty(
  cols: number,
  rows: number,
  cwd: string,
  environment?: Record<string, string>
): ShellLaunchConfig & { terminal: IPty } {
  const env = { ...process.env, HOME: os.homedir(), ...environment }

  if (process.platform === "win32") {
    const shell = resolveDefaultShell()
    return {
      terminal: pty.spawn(shell, resolveShellArgs(shell), {
        name: "xterm-256color",
        cols: Math.max(1, cols),
        rows: Math.max(1, rows),
        cwd,
        env,
      }),
      shell,
      shellArgs: resolveShellArgs(shell),
      shellKind: resolveShellKind(shell),
    }
  }

  const candidates = resolvePosixShellCandidates()
  const errors: string[] = []

  for (const shell of candidates) {
    const shellArgs = resolveShellArgs(shell)

    try {
      return {
        terminal: pty.spawn(shell, shellArgs, {
          name: "xterm-256color",
          cols: Math.max(1, cols),
          rows: Math.max(1, rows),
          cwd,
          env,
        }),
        shell,
        shellArgs,
        shellKind: resolveShellKind(shell),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`${shell}: ${message}`)
    }
  }

  throw new Error(
    `Unable to start a terminal shell. Tried ${candidates.join(", ")}.${errors.length > 0 ? ` Last error: ${errors.at(-1)}` : ""}`
  )
}

export class TerminalService {
  private readonly sessions = new Map<string, TerminalSession>()

  constructor(private readonly sendEvent: EventSender) {}

  private sendTerminalEvent(channel: string, payload: unknown): void {
    try {
      this.sendEvent(channel, payload)
    } catch (error) {
      console.warn("[terminal] Failed to send terminal event:", error)
      capture("terminal_event_delivery_failed", { channel })
      captureException(error, {
        context: "terminal_event_delivery",
        channel,
      })
    }
  }

  private disposeSessionEvents(session: TerminalSession): void {
    for (const disposable of session.eventDisposables.splice(0)) {
      try {
        disposable.dispose()
      } catch (error) {
        console.warn("[terminal] Failed to dispose terminal listener:", error)
        captureException(error, { context: "terminal_listener_dispose" })
      }
    }
  }

  private killSession(session: TerminalSession): void {
    this.disposeSessionEvents(session)

    try {
      session.pty.kill()
    } catch (error) {
      console.warn("[terminal] Failed to kill terminal session:", error)
      captureException(error, { context: "terminal_session_kill" })
    }
  }

  async createSession(
    sessionId: string,
    cwd: string,
    cols: number,
    rows: number,
    initialCommand?: string,
    environment?: Record<string, string>
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
      if (existing.cwd === trimmedCwd) {
        try {
          existing.pty.resize(Math.max(1, cols), Math.max(1, rows))
          return { initialData: existing.buffer, shellKind: existing.shellKind }
        } catch (error) {
          console.warn("[terminal] Failed to resize existing terminal session, recreating:", error)
          captureException(error, { context: "terminal_existing_session_resize" })
          existing.suppressExitEvent = true
          existing.exited = true
          this.killSession(existing)
          this.sessions.delete(sessionId)
        }
      } else {
        existing.suppressExitEvent = true
        existing.exited = true
        this.killSession(existing)
        this.sessions.delete(sessionId)
      }
    }

    const { terminal, shellKind } = createTerminalPty(
      cols,
      rows,
      trimmedCwd,
      environment
    )

    const session: TerminalSession = {
      pty: terminal,
      eventDisposables: [],
      buffer: "",
      cwd: trimmedCwd,
      exited: false,
      suppressExitEvent: false,
      shellKind,
    }

    const dataDisposable = terminal.onData((data) => {
      try {
        if (session.exited || this.sessions.get(sessionId) !== session) {
          return
        }

        session.buffer = trimScrollback(`${session.buffer}${data}`)

        const payload: TerminalDataEvent = {
          sessionId,
          data,
        }

        this.sendTerminalEvent(EVENT_CHANNELS.terminalData, payload)
      } catch (error) {
        console.warn("[terminal] Failed to handle terminal data:", error)
        captureException(error, { context: "terminal_data_handler" })
      }
    })

    const exitDisposable = terminal.onExit((event) => {
      try {
        if (this.sessions.get(sessionId) !== session) {
          return
        }

        session.exited = true
        this.disposeSessionEvents(session)
        if (session.suppressExitEvent) {
          return
        }

        const payload: TerminalExitEvent = {
          sessionId,
          exitCode: event.exitCode,
        }

        this.sendTerminalEvent(EVENT_CHANNELS.terminalExit, payload)
      } catch (error) {
        console.warn("[terminal] Failed to handle terminal exit:", error)
        captureException(error, { context: "terminal_exit_handler" })
      }
    })

    session.eventDisposables.push(dataDisposable, exitDisposable)
    this.sessions.set(sessionId, session)
    capture("terminal_session_created", { shell_kind: shellKind, has_initial_command: Boolean(initialCommand) })

    if (initialCommand) {
      terminal.write(initialCommand)
    }

    return { initialData: session.buffer, shellKind }
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
    this.killSession(session)
    this.sessions.delete(sessionId)
  }

  dispose(): void {
    for (const sessionId of this.sessions.keys()) {
      void this.closeSession(sessionId)
    }
  }

  getActiveSessionCount(): number {
    let count = 0

    for (const session of this.sessions.values()) {
      if (!session.exited) {
        count += 1
      }
    }

    return count
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
