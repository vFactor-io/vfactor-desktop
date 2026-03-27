import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

type StoreRecord = Record<string, unknown>

interface StoreCacheEntry {
  data: StoreRecord
}

function isStoreRecord(value: unknown): value is StoreRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export class JsonStoreService {
  private readonly cache = new Map<string, StoreCacheEntry>()

  constructor(private readonly userDataPath: string) {}

  async get<T>(file: string, key: string): Promise<T | null> {
    const store = await this.loadStore(file)
    return (store.data[key] as T | undefined) ?? null
  }

  async set(file: string, key: string, value: unknown): Promise<void> {
    const store = await this.loadStore(file)
    store.data[key] = value
  }

  async delete(file: string, key: string): Promise<void> {
    const store = await this.loadStore(file)
    delete store.data[key]
  }

  async save(file: string): Promise<void> {
    const filePath = this.resolveStorePath(file)
    const store = await this.loadStore(file)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, `${JSON.stringify(store.data, null, 2)}\n`, "utf8")
  }

  private resolveStorePath(file: string): string {
    return join(this.userDataPath, file)
  }

  private async loadStore(file: string): Promise<StoreCacheEntry> {
    const cached = this.cache.get(file)
    if (cached) {
      return cached
    }

    const filePath = this.resolveStorePath(file)

    let nextData: StoreRecord = {}

    try {
      const raw = await readFile(filePath, "utf8")
      const parsed = JSON.parse(raw) as unknown
      nextData = isStoreRecord(parsed) ? parsed : {}
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException
      if (nodeError.code !== "ENOENT") {
        throw error
      }
    }

    const entry = { data: nextData }
    this.cache.set(file, entry)
    return entry
  }
}
