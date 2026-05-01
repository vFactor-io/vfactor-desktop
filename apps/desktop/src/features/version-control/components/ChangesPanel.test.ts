import { describe, expect, test } from "bun:test"

import type { FileChange } from "../types"
import {
  getChangeKeys,
  pruneCollapsedFileKeys,
  toggleCollapsedFileKey,
} from "./changesPanelState"

function change(path: string): FileChange {
  return {
    path,
    status: "modified",
    additions: 1,
    deletions: 1,
  }
}

describe("ChangesPanel change keys", () => {
  test("keeps stable file keys for change signatures", () => {
    expect(
      getChangeKeys([
        change("apps/desktop/src/features/chat/components/ChatMessages.tsx"),
        change("bun.lock"),
      ])
    ).toEqual([
      "->apps/desktop/src/features/chat/components/ChatMessages.tsx",
      "->bun.lock",
    ])
  })

  test("toggles file-level diff collapse state by stable file key", () => {
    const collapsed = toggleCollapsedFileKey(new Set<string>(), "src/app.ts")
    expect([...collapsed]).toEqual(["src/app.ts"])

    const expanded = toggleCollapsedFileKey(collapsed, "src/app.ts")
    expect([...expanded]).toEqual([])
  })

  test("prunes collapsed diff keys that are no longer renderable", () => {
    const collapsed = new Set(["src/app.ts", "src/old.ts"])

    expect([...pruneCollapsedFileKeys(collapsed, ["src/app.ts"])]).toEqual(["src/app.ts"])
  })
})
