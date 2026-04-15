export interface CodexRpcClient {
  request: <T>(method: string, params?: unknown) => Promise<T>
  notify: (method: string, params?: unknown) => void
  respond: (id: number | string, result: unknown) => void
  onNotification: (
    listener: (notification: { method: string; params?: unknown }) => void
  ) => () => void
  onServerRequest: (
    listener: (request: { id: number | string; method: string; params?: unknown }) => void
  ) => () => void
  waitForNotification: <TParams = unknown>(
    predicate: (notification: { method: string; params?: TParams }) => boolean,
    timeoutMs: number
  ) => Promise<{ method: string; params?: TParams }>
}
