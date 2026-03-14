import { invoke } from "@tauri-apps/api/core"

const CODEX_WS_URL = "ws://127.0.0.1:4500"
const CONNECT_RETRY_ATTEMPTS = 20
const CONNECT_RETRY_DELAY_MS = 300

interface JsonRpcRequest {
  jsonrpc: "2.0"
  id: number
  method: string
  params?: unknown
}

export interface JsonRpcServerRequest<T = unknown> {
  jsonrpc?: "2.0"
  id: number | string
  method: string
  params?: T
}

interface JsonRpcSuccess<T = unknown> {
  jsonrpc?: "2.0"
  id: number
  result: T
}

interface JsonRpcError {
  jsonrpc?: "2.0"
  id: number
  error: {
    code: number
    message: string
    data?: unknown
  }
}

export interface JsonRpcNotification<T = unknown> {
  jsonrpc?: "2.0"
  method: string
  params?: T
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

type NotificationListener = (notification: JsonRpcNotification) => void
type ServerRequestListener = (request: JsonRpcServerRequest) => void

const OPTED_OUT_NOTIFICATION_METHODS = [
  "codex/event/agent_message_content_delta",
  "codex/event/agent_message_delta",
  "codex/event/agent_reasoning_delta",
  "codex/event/reasoning_content_delta",
  "codex/event/reasoning_raw_content_delta",
  "codex/event/exec_command_output_delta",
  "codex/event/exec_command_begin",
  "codex/event/exec_command_end",
  "codex/event/exec_output",
  "codex/event/item_started",
  "codex/event/item_completed",
]

function isJsonRpcResponse(
  value: JsonRpcSuccess | JsonRpcError | JsonRpcNotification | JsonRpcServerRequest
): value is JsonRpcSuccess | JsonRpcError {
  return "id" in value && !("method" in value)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class CodexRpcClient {
  private socket: WebSocket | null = null
  private connectPromise: Promise<void> | null = null
  private nextRequestId = 1
  private pendingRequests = new Map<number, PendingRequest>()
  private listeners = new Set<NotificationListener>()
  private serverRequestListeners = new Set<ServerRequestListener>()

  async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return
    }

    if (this.connectPromise) {
      return this.connectPromise
    }

    this.connectPromise = this.connectInternal()

    try {
      await this.connectPromise
    } finally {
      this.connectPromise = null
    }
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    await this.connect()

    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Codex App Server is not connected")
    }

    const id = this.nextRequestId++
    const payload: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    }

    const responsePromise = new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject })
    })

    this.socket.send(JSON.stringify(payload))
    return responsePromise
  }

  notify(method: string, params?: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return
    }

    this.socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method,
        params,
      })
    )
  }

  respond(id: number | string, result: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return
    }

    this.socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        result,
      })
    )
  }

  onNotification(listener: NotificationListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  onServerRequest(listener: ServerRequestListener): () => void {
    this.serverRequestListeners.add(listener)
    return () => {
      this.serverRequestListeners.delete(listener)
    }
  }

  waitForNotification<TParams = unknown>(
    predicate: (notification: JsonRpcNotification<TParams>) => boolean,
    timeoutMs: number
  ): Promise<JsonRpcNotification<TParams>> {
    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        unsubscribe()
        reject(new Error("Timed out waiting for Codex App Server notification"))
      }, timeoutMs)

      const unsubscribe = this.onNotification((notification) => {
        if (predicate(notification as JsonRpcNotification<TParams>)) {
          window.clearTimeout(timeoutId)
          unsubscribe()
          resolve(notification as JsonRpcNotification<TParams>)
        }
      })
    })
  }

  private async connectInternal(): Promise<void> {
    if (await this.tryOpenSocket()) {
      return
    }

    await invoke<string>("start_codex_server")

    for (let attempt = 0; attempt < CONNECT_RETRY_ATTEMPTS; attempt += 1) {
      if (await this.tryOpenSocket()) {
        return
      }
      await sleep(CONNECT_RETRY_DELAY_MS)
    }

    throw new Error("Unable to connect to Codex App Server")
  }

  private async tryOpenSocket(): Promise<boolean> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return true
    }

    try {
      const socket = await this.openSocket(CODEX_WS_URL)
      this.socket = socket
      this.attachSocket(socket)

      await this.request("initialize", {
        clientInfo: {
          name: "nucleus-desktop",
          title: "Nucleus Desktop",
          version: "0.1.0",
        },
        capabilities: {
          experimentalApi: true,
          optOutNotificationMethods: OPTED_OUT_NOTIFICATION_METHODS,
        },
      })
      this.notify("initialized")
      return true
    } catch {
      this.resetSocket()
      return false
    }
  }

  private openSocket(url: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url)

      const cleanup = () => {
        socket.removeEventListener("open", handleOpen)
        socket.removeEventListener("error", handleError)
      }

      const handleOpen = () => {
        cleanup()
        resolve(socket)
      }

      const handleError = () => {
        cleanup()
        try {
          socket.close()
        } catch {
          // Ignore close failures during connection attempts.
        }
        reject(new Error("Failed to open Codex App Server WebSocket"))
      }

      socket.addEventListener("open", handleOpen)
      socket.addEventListener("error", handleError)
    })
  }

  private attachSocket(socket: WebSocket): void {
    socket.addEventListener("message", (event) => {
      const payload = JSON.parse(String(event.data)) as
        | JsonRpcSuccess
        | JsonRpcError
        | JsonRpcNotification
        | JsonRpcServerRequest

      if (isJsonRpcResponse(payload)) {
        const pending = this.pendingRequests.get(payload.id)
        if (!pending) {
          return
        }

        this.pendingRequests.delete(payload.id)

        if ("error" in payload) {
          pending.reject(new Error(payload.error.message))
        } else {
          pending.resolve(payload.result)
        }

        return
      }

      if ("id" in payload && "method" in payload) {
        for (const listener of this.serverRequestListeners) {
          listener(payload)
        }
        return
      }

      for (const listener of this.listeners) {
        listener(payload)
      }
    })

    socket.addEventListener("close", () => {
      this.rejectPendingRequests("Codex App Server connection closed")
      this.resetSocket()
    })

    socket.addEventListener("error", () => {
      this.rejectPendingRequests("Codex App Server connection error")
    })
  }

  private rejectPendingRequests(message: string): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(new Error(message))
    }
    this.pendingRequests.clear()
  }

  private resetSocket(): void {
    this.socket = null
  }
}

let codexRpcClient: CodexRpcClient | null = null

export function getCodexRpcClient(): CodexRpcClient {
  if (!codexRpcClient) {
    codexRpcClient = new CodexRpcClient()
  }

  return codexRpcClient
}
