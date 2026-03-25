import { desktop } from "@/desktop/client"

type UnlistenFn = () => void

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
  resolve: (value: any) => void
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

function isAlreadyInitializedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  return error.message.toLowerCase().includes("already initialized")
}

export class CodexRpcClient {
  private connectPromise: Promise<void> | null = null
  private isConnected = false
  private messageUnlisten: UnlistenFn | null = null
  private statusUnlisten: UnlistenFn | null = null
  private nextRequestId = 1
  private pendingRequests = new Map<number, PendingRequest>()
  private listeners = new Set<NotificationListener>()
  private serverRequestListeners = new Set<ServerRequestListener>()

  async connect(): Promise<void> {
    if (this.isConnected) {
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

    if (!this.isConnected) {
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

    try {
      await this.send(payload)
    } catch (error) {
      this.pendingRequests.delete(id)
      throw error
    }

    return responsePromise
  }

  notify(method: string, params?: unknown): void {
    void this.send({
      jsonrpc: "2.0",
      method,
      params,
    }).catch(() => {
      // Ignore best-effort notification failures.
    })
  }

  respond(id: number | string, result: unknown): void {
    void this.send({
      jsonrpc: "2.0",
      id,
      result,
    }).catch(() => {
      // Ignore best-effort response failures.
    })
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
    await this.attachTransportListeners()
    await desktop.codex.ensureServer()

    this.isConnected = true

    try {
      await this.sendInitialize()
    } catch (error) {
      this.resetConnection()
      throw error
    }
  }

  private async attachTransportListeners(): Promise<void> {
    if (!this.messageUnlisten) {
      this.messageUnlisten = desktop.codex.onMessage((message) => {
        this.handleMessage(message)
      })
    }

    if (!this.statusUnlisten) {
      this.statusUnlisten = desktop.codex.onStatus((status) => {
        if (status === "closed") {
          this.rejectPendingRequests("Codex App Server connection closed")
          this.resetConnection()
        }
      })
    }
  }

  private async sendInitialize(): Promise<void> {
    try {
      await this.sendRequestWithoutReconnect("initialize", {
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
    } catch (error) {
      if (isAlreadyInitializedError(error)) {
        return
      }

      throw error
    }
  }

  private async sendRequestWithoutReconnect<T>(method: string, params?: unknown): Promise<T> {
    if (!this.isConnected) {
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

    try {
      await this.send(payload)
    } catch (error) {
      this.pendingRequests.delete(id)
      throw error
    }

    return responsePromise
  }

  private async send(payload: JsonRpcRequest | JsonRpcNotification | { jsonrpc: "2.0"; id: number | string; result: unknown }): Promise<void> {
    try {
      await desktop.codex.send(JSON.stringify(payload))
    } catch (error) {
      this.resetConnection()
      throw error
    }
  }

  private handleMessage(rawPayload: string): void {
    const payload = JSON.parse(rawPayload) as
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
  }

  private rejectPendingRequests(message: string): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(new Error(message))
    }
    this.pendingRequests.clear()
  }

  private resetConnection(): void {
    this.isConnected = false
  }
}

let codexRpcClient: CodexRpcClient | null = null

export function getCodexRpcClient(): CodexRpcClient {
  if (!codexRpcClient) {
    codexRpcClient = new CodexRpcClient()
  }

  return codexRpcClient
}
