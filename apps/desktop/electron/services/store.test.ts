import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { JsonStoreService } from "./store"

describe("JsonStoreService", () => {
  let userDataPath = ""

  beforeEach(async () => {
    userDataPath = await mkdtemp(join(tmpdir(), "nucleus-store-test-"))
  })

  afterEach(async () => {
    if (userDataPath) {
      await rm(userDataPath, { recursive: true, force: true })
    }
  })

  test("treats empty store files as empty records", async () => {
    await writeFile(join(userDataPath, "runtime-sessions.json"), "", "utf8")
    const store = new JsonStoreService(userDataPath)

    await expect(store.get("runtime-sessions.json", "sessions")).resolves.toBeNull()
  })

  test("treats malformed JSON store files as empty records", async () => {
    await writeFile(join(userDataPath, "runtime-sessions.json"), "{", "utf8")
    const store = new JsonStoreService(userDataPath)

    await expect(store.get("runtime-sessions.json", "sessions")).resolves.toBeNull()
  })
})
