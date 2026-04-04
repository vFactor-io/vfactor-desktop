import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import readline from "node:readline"
import { EVENT_CHANNELS } from "../ipc/channels"
import { capture, captureException } from "./analytics"

type EventSender = (channel: string, payload: unknown) => void

export class CodexServerService {
  private process: ChildProcessWithoutNullStreams | null = null
  private isDisposingProcess = false

  constructor(private readonly sendEvent: EventSender) {}

  async ensureServer(): Promise<string> {
    if (this.process && this.process.exitCode == null && !this.process.killed) {
      return "Codex App Server already running"
    }

    let hasReportedUnexpectedExit = false
    this.isDisposingProcess = false

    const child = spawn("codex", ["app-server"], {
      stdio: "pipe",
      env: process.env,
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

      this.sendEvent(EVENT_CHANNELS.codexMessage, payload)
    })

    readline.createInterface({ input: child.stderr }).on("line", (line) => {
      const payload = line.trim()
      if (payload) {
        console.warn("[codex]", payload)
      }
    })

    this.process = child
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
  }

  dispose(): void {
    if (!this.process || this.process.killed) {
      return
    }

    this.isDisposingProcess = true
    this.process.kill()
    this.process = null
  }
}
