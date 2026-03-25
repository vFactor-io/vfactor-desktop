import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import readline from "node:readline"
import { EVENT_CHANNELS } from "../ipc/channels"

type EventSender = (channel: string, payload: unknown) => void

export class CodexServerService {
  private process: ChildProcessWithoutNullStreams | null = null

  constructor(private readonly sendEvent: EventSender) {}

  async ensureServer(): Promise<string> {
    if (this.process && this.process.exitCode == null && !this.process.killed) {
      return "Codex App Server already running"
    }

    const child = spawn("codex", ["app-server"], {
      stdio: "pipe",
      env: process.env,
    })

    child.on("error", (error) => {
      console.error("[codex] Failed to spawn Codex App Server:", error)
      this.sendEvent(EVENT_CHANNELS.codexStatus, "closed")
      this.process = null
    })

    child.on("exit", () => {
      this.sendEvent(EVENT_CHANNELS.codexStatus, "closed")
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

    this.process.kill()
    this.process = null
  }
}
