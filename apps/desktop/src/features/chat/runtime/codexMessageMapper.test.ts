import { describe, expect, test } from "bun:test"

import type { CodexTurn } from "./codexProtocol"
import { mapTurnItemsToMessages } from "./codexMessageMapper"

describe("mapTurnItemsToMessages", () => {
  test("preserves reasoning titles on runtime messages", () => {
    const turn: CodexTurn = {
      id: "turn-1",
      status: "completed",
      items: [
        {
          type: "reasoning",
          id: "reasoning-1",
          title: "Inspecting files",
          summary: ["Checking the likely component."],
          content: [],
        },
      ],
    }

    expect(mapTurnItemsToMessages(turn, "session-1")[0]?.info.title).toBe(
      "Inspecting files"
    )
  })
})
