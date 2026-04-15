import { JsonStoreService } from "../store"
import type { PersistedRuntimeSessionMetadata } from "./providerTypes"

const STORE_FILE = "runtime-sessions.json"
const STORE_KEY = "sessions"

type PersistedRuntimeSessionsRecord = Record<string, PersistedRuntimeSessionMetadata>

export class RuntimeSessionStore {
  constructor(private readonly storeService: JsonStoreService) {}

  async get(remoteId: string): Promise<PersistedRuntimeSessionMetadata | null> {
    const sessions = await this.getAll()
    return sessions[remoteId] ?? null
  }

  async set(remoteId: string, metadata: PersistedRuntimeSessionMetadata): Promise<void> {
    const sessions = await this.getAll()
    sessions[remoteId] = metadata
    await this.storeService.set(STORE_FILE, STORE_KEY, sessions)
    await this.storeService.save(STORE_FILE)
  }

  async delete(remoteId: string): Promise<void> {
    const sessions = await this.getAll()
    if (!(remoteId in sessions)) {
      return
    }

    delete sessions[remoteId]
    await this.storeService.set(STORE_FILE, STORE_KEY, sessions)
    await this.storeService.save(STORE_FILE)
  }

  private async getAll(): Promise<PersistedRuntimeSessionsRecord> {
    return (
      (await this.storeService.get<PersistedRuntimeSessionsRecord>(STORE_FILE, STORE_KEY)) ?? {}
    )
  }
}
