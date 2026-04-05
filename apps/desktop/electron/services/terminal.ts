import os from "node:os"
import { accessSync, constants, existsSync, statSync } from "node:fs"
import pty, { type IPty } from "node-pty"
import type {
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalStartResponse,
} from "../../src/desktop/contracts"
import { EVENT_CHANNELS } from "../ipc/channels"
import { capture } from "./analytics"

const TERMINAL_SCROLLBACK_LIMIT = 200_000

type EventSender = (channel: string, payload: unknown) => void

interface TerminalSession {
  pty: IPty
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
        existing.pty.resize(Math.max(1, cols), Math.max(1, rows))
        return { initialData: existing.buffer, shellKind: existing.shellKind }
      }

      existing.suppressExitEvent = true
      existing.exited = true
      existing.pty.kill()
      this.sessions.delete(sessionId)
    }

    const { terminal, shellKind } = createTerminalPty(
      cols,
      rows,
      trimmedCwd,
      environment
    )

    const session: TerminalSession = {
      pty: terminal,
      buffer: "",
      cwd: trimmedCwd,
      exited: false,
      suppressExitEvent: false,
      shellKind,
    }

    terminal.onData((data) => {
      session.buffer = trimScrollback(`${session.buffer}${data}`)

      const payload: TerminalDataEvent = {
        sessionId,
        data,
      }

      this.sendEvent(EVENT_CHANNELS.terminalData, payload)
    })

    terminal.onExit((event) => {
      session.exited = true
      if (session.suppressExitEvent) {
        return
      }

      const payload: TerminalExitEvent = {
        sessionId,
        exitCode: event.exitCode,
      }
      this.sendEvent(EVENT_CHANNELS.terminalExit, payload)
    })

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
