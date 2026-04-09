import { describe, expect, test } from "bun:test"

import type { MessageWithParts, RuntimeMessage, RuntimeToolPart } from "../types"
import { buildTimelineBlocks } from "./timelineActivity"

function createToolMessage({
  id,
  turnId,
  itemType,
  status = "completed",
  input = {},
  output,
}: {
  id: string
  turnId?: string
  itemType: RuntimeMessage["itemType"]
  status?: RuntimeToolPart["state"]["status"]
  input?: Record<string, unknown>
  output?: unknown
}): MessageWithParts {
  return {
    info: {
      id,
      sessionId: "session-1",
      role: "assistant",
      createdAt: 1,
      turnId,
      itemType,
    },
    parts: [
      {
        id: `${id}:tool`,
        type: "tool",
        messageId: id,
        sessionId: "session-1",
        tool: itemType ?? "tool",
        state: {
          status,
          input,
          output,
        },
      },
    ],
  }
}

function createTextMessage({
  id,
  turnId,
  itemType = "agentMessage",
  text = "hello",
}: {
  id: string
  turnId?: string
  itemType?: RuntimeMessage["itemType"]
  text?: string
}): MessageWithParts {
  return {
    info: {
      id,
      sessionId: "session-1",
      role: "assistant",
      createdAt: 1,
      turnId,
      itemType,
    },
    parts: [
      {
        id: `${id}:text`,
        type: "text",
        text,
      },
    ],
  }
}

describe("buildTimelineBlocks", () => {
  test("keeps consecutive tool messages as standalone rows", () => {
    const blocks = buildTimelineBlocks([
      createToolMessage({
        id: "cmd-1",
        turnId: "turn-1",
        itemType: "commandExecution",
        input: {
          commandActions: [{ type: "read", path: "src/a.ts" }],
        },
      }),
      createToolMessage({
        id: "search-1",
        turnId: "turn-1",
        itemType: "webSearch",
        input: { query: "timeline grouping" },
      }),
    ])

    expect(blocks).toEqual([
      expect.objectContaining({ type: "message", key: "cmd-1" }),
      expect.objectContaining({ type: "message", key: "search-1" }),
    ])
  })

  test("preserves message order across tools and assistant text", () => {
    const blocks = buildTimelineBlocks([
      createToolMessage({
        id: "cmd-1",
        turnId: "turn-1",
        itemType: "commandExecution",
        input: {
          commandActions: [{ type: "read", path: "src/a.ts" }],
        },
      }),
      createTextMessage({
        id: "text-1",
        turnId: "turn-1",
      }),
      createToolMessage({
        id: "cmd-2",
        turnId: "turn-1",
        itemType: "commandExecution",
        input: {
          commandActions: [{ type: "search", query: "ChatMessages" }],
        },
      }),
    ])

    expect(blocks).toEqual([
      expect.objectContaining({ type: "message", key: "cmd-1" }),
      expect.objectContaining({ type: "message", key: "text-1" }),
      expect.objectContaining({ type: "message", key: "cmd-2" }),
    ])
  })

  test("keeps approval surrogate rows standalone", () => {
    const blocks = buildTimelineBlocks([
      createToolMessage({
        id: "approval:item-1",
        turnId: "turn-1",
        itemType: "commandExecution",
        status: "pending",
        input: {
          commandActions: [{ type: "read", path: "src/a.ts" }],
        },
      }),
    ])

    expect(blocks).toEqual([
      expect.objectContaining({
        type: "message",
        key: "approval:item-1",
      }),
    ])
  })

  test("dedupes repeated message ids using the latest instance", () => {
    const blocks = buildTimelineBlocks([
      createTextMessage({
        id: "msg-1",
        text: "old",
      }),
      createTextMessage({
        id: "msg-1",
        text: "new",
      }),
    ])

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ type: "message", key: "msg-1" })
    expect(blocks[0]?.message.parts[0]).toMatchObject({ type: "text", text: "new" })
  })
})
