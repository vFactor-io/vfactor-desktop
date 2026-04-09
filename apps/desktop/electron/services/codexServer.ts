import { accessSync, constants, statSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import readline from "node:readline"
import { promisify } from "node:util"
import { EVENT_CHANNELS } from "../ipc/channels"
import { capture, captureException } from "./analytics"

type EventSender = (channel: string, payload: unknown) => void

const execFileAsync = promisify(execFile)
const PATH_SEPARATOR = process.platform === "win32" ? ";" : ":"
const CODEX_EXECUTABLE_NAME = process.platform === "win32" ? "codex.exe" : "codex"

function isExecutableFile(filePath: string | null | undefined): filePath is string {
  if (!filePath) {
    return false
  }

  try {
    accessSync(filePath, constants.X_OK)
    return statSync(filePath).isFile()
  } catch {
    return false
  }
}

function getShellCandidates(): string[] {
  if (process.platform === "win32") {
    return []
  }

  const candidates = [process.env.SHELL?.trim(), "/bin/zsh", "/bin/bash", "/bin/sh"]

  return Array.from(
    new Set(
      candidates.filter(
        (candidate): candidate is string =>
          Boolean(candidate) && candidate.startsWith("/") && isExecutableFile(candidate)
      )
    )
  )
}

function getCommonPathEntries(): string[] {
  const homeDirectory = os.homedir()

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA?.trim()
    return [
      process.env.USERPROFILE?.trim(),
      localAppData ? path.join(localAppData, "Programs") : null,
      localAppData ? path.join(localAppData, "Microsoft", "WinGet", "Links") : null,
    ].filter((entry): entry is string => Boolean(entry))
  }

  return [
    path.join(homeDirectory, ".bun", "bin"),
    path.join(homeDirectory, ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/opt/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ]
}

function splitPathEntries(pathValue: string | null | undefined): string[] {
  return (pathValue ?? "")
    .split(PATH_SEPARATOR)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function buildLaunchPath(additionalEntries: string[] = []): string {
  return Array.from(
    new Set([
      ...splitPathEntries(process.env.PATH),
      ...additionalEntries,
      ...getCommonPathEntries(),
    ])
  ).join(PATH_SEPARATOR)
}

function findExecutableInPath(pathValue: string): string | null {
  for (const directory of splitPathEntries(pathValue)) {
    const candidate = path.join(directory, CODEX_EXECUTABLE_NAME)
    if (isExecutableFile(candidate)) {
      return candidate
    }
  }

  return null
}

async function resolveCodexFromShell(): Promise<string | null> {
  for (const shell of getShellCandidates()) {
    try {
      const { stdout } = await execFileAsync(shell, ["-lc", `command -v ${CODEX_EXECUTABLE_NAME}`], {
        env: {
          ...process.env,
          HOME: os.homedir(),
        },
      })
      const candidate = stdout.trim().split(/\r?\n/).find((line) => line.trim().length > 0) ?? null

      if (isExecutableFile(candidate)) {
        return candidate
      }
    } catch {
      // Ignore shell lookup failures and continue to the next candidate.
    }
  }

  return null
}

export async function resolveCodexLaunchConfig(): Promise<{
  command: string
  env: NodeJS.ProcessEnv
}> {
  const configuredExecutable = process.env.NUCLEUS_CODEX_PATH?.trim() ?? null
  if (configuredExecutable && !isExecutableFile(configuredExecutable)) {
    throw new Error(
      `NUCLEUS_CODEX_PATH points to a non-executable Codex binary: ${configuredExecutable}`
    )
  }

  const mergedPath = buildLaunchPath(
    configuredExecutable ? [path.dirname(configuredExecutable)] : []
  )
  const resolvedExecutable =
    configuredExecutable ??
    findExecutableInPath(mergedPath) ??
    (await resolveCodexFromShell())

  if (!resolvedExecutable) {
    throw new Error(
      "Unable to find the Codex CLI. Install `codex`, add it to your PATH, or set NUCLEUS_CODEX_PATH to the full executable path."
    )
  }

  return {
    command: resolvedExecutable,
    env: {
      ...process.env,
      HOME: os.homedir(),
      PATH: buildLaunchPath([path.dirname(resolvedExecutable)]),
    },
  }
}

function waitForSpawn(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      child.removeListener("spawn", handleSpawn)
      child.removeListener("error", handleError)
    }

    const handleSpawn = () => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve()
    }

    const handleError = (error: Error) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      reject(error)
    }

    child.once("spawn", handleSpawn)
    child.once("error", handleError)
  })
}

export class CodexServerService {
  private process: ChildProcessWithoutNullStreams | null = null
  private isDisposingProcess = false
  private readonly pendingTurnStartRequestIds = new Set<number | string>()
  private readonly activeTurnIds = new Set<string>()

  constructor(private readonly sendEvent: EventSender) {}

  async ensureServer(): Promise<string> {
    if (this.process && this.process.exitCode == null && !this.process.killed) {
      return "Codex App Server already running"
    }

    let hasReportedUnexpectedExit = false
    this.isDisposingProcess = false

    const { command, env } = await resolveCodexLaunchConfig()
    const child = spawn(command, ["app-server"], {
      stdio: "pipe",
      env,
    })

    capture("agent_server_start_requested")

    child.on("error", (error) => {
      console.error("[codex] Failed to spawn Codex App Server:", error)
      captureException(error, { context: "agent_server_spawn" })
      capture("agent_server_error", { reason: "spawn_failed" })
      this.sendEvent(EVENT_CHANNELS.codexStatus, "closed")
      this.isDisposingProcess = false
      this.process = null
    })

    child.on("exit", (code, signal) => {
      const wasIntentionalExit = this.isDisposingProcess
      this.pendingTurnStartRequestIds.clear()
      this.activeTurnIds.clear()

      if (!hasReportedUnexpectedExit && !wasIntentionalExit && (code !== 0 || signal !== null)) {
        hasReportedUnexpectedExit = true
        capture("agent_server_error", {
          reason: "process_exited",
          exit_code: code,
          signal,
        })
      }

      this.sendEvent(EVENT_CHANNELS.codexStatus, "closed")
      this.isDisposingProcess = false
      this.process = null
    })

    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      const payload = line.trim()
      if (!payload) {
        return
      }

      this.trackIncomingMessage(payload)
      this.sendEvent(EVENT_CHANNELS.codexMessage, payload)
    })

    readline.createInterface({ input: child.stderr }).on("line", (line) => {
      const payload = line.trim()
      if (payload) {
        console.warn("[codex]", payload)
      }
    })

    this.process = child
    await waitForSpawn(child)
    return "Codex App Server started"
  }

  async send(message: string): Promise<void> {
    if (!this.process || this.process.exitCode != null || this.process.killed) {
      throw new Error("Codex App Server is not connected")
    }

    await new Promise<void>((resolve, reject) => {
      this.process?.stdin.write(`${message}\n`, (error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })

    this.trackOutgoingMessage(message)
  }

  dispose(): void {
    if (!this.process || this.process.killed) {
      return
    }

    this.isDisposingProcess = true
    this.pendingTurnStartRequestIds.clear()
    this.activeTurnIds.clear()
    this.process.kill()
    this.process = null
  }

  getActiveTurnCount(): number {
    return this.activeTurnIds.size + this.pendingTurnStartRequestIds.size
  }

  private trackOutgoingMessage(rawMessage: string): void {
    const payload = this.parseJsonMessage(rawMessage)
    if (!payload || typeof payload !== "object" || !("method" in payload)) {
      return
    }

    if (payload.method === "turn/start" && "id" in payload) {
      this.pendingTurnStartRequestIds.add(payload.id)
      return
    }

    if (payload.method === "turn/interrupt") {
      const params =
        "params" in payload && payload.params && typeof payload.params === "object"
          ? payload.params
          : null
      const turnId = params && "turnId" in params && typeof params.turnId === "string"
        ? params.turnId
        : null

      if (turnId) {
        this.activeTurnIds.delete(turnId)
      }
    }
  }

  private trackIncomingMessage(rawMessage: string): void {
    const payload = this.parseJsonMessage(rawMessage)
    if (!payload || typeof payload !== "object") {
      return
    }

    if ("id" in payload && !("method" in payload)) {
      if (this.pendingTurnStartRequestIds.has(payload.id)) {
        this.pendingTurnStartRequestIds.delete(payload.id)
        const turnId =
          "result" in payload &&
            payload.result &&
            typeof payload.result === "object" &&
            "turn" in payload.result &&
            payload.result.turn &&
            typeof payload.result.turn === "object" &&
            "id" in payload.result.turn &&
            typeof payload.result.turn.id === "string"
            ? payload.result.turn.id
            : null

        if (turnId) {
          this.activeTurnIds.add(turnId)
        }
      }

      return
    }

    if (!("method" in payload) || payload.method !== "turn/completed") {
      return
    }

    const params =
      "params" in payload && payload.params && typeof payload.params === "object"
        ? payload.params
        : null
    const turnId =
      params &&
        "turn" in params &&
        params.turn &&
        typeof params.turn === "object" &&
        "id" in params.turn &&
        typeof params.turn.id === "string"
        ? params.turn.id
        : null

    if (turnId) {
      this.activeTurnIds.delete(turnId)
    }
  }

  private parseJsonMessage(rawMessage: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(rawMessage) as unknown
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
}
