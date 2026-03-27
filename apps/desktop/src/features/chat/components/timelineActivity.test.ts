import { describe, expect, test } from "bun:test"

import type { MessageWithParts, RuntimeMessage, RuntimeToolPart } from "../types"
import {
  buildTimelineBlocks,
  getActivityGroupSummary,
  isActivityGroupActive,
  type TimelineActivityGroupBlock,
} from "./timelineActivity"

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

function getOnlyGroup(messages: MessageWithParts[]): TimelineActivityGroupBlock {
  const blocks = buildTimelineBlocks(messages)
  expect(blocks).toHaveLength(1)
  expect(blocks[0]?.type).toBe("activityGroup")
  return blocks[0] as TimelineActivityGroupBlock
}

describe("buildTimelineBlocks", () => {
  test("groups consecutive exploration rows within one turn", () => {
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

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      type: "activityGroup",
      family: "exploration",
      key: "activity:turn-1:exploration:cmd-1",
    })
  })

  test("splits adjacent groups when tool family changes", () => {
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
        id: "mcp-1",
        turnId: "turn-1",
        itemType: "mcpToolCall",
      }),
    ])

    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ type: "activityGroup", family: "exploration" })
    expect(blocks[1]).toMatchObject({ type: "activityGroup", family: "mcp" })
  })

  test("does not group across turns", () => {
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
        id: "cmd-2",
        turnId: "turn-2",
        itemType: "commandExecution",
        input: {
          commandActions: [{ type: "read", path: "src/b.ts" }],
        },
      }),
    ])

    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ type: "activityGroup", turnId: "turn-1" })
    expect(blocks[1]).toMatchObject({ type: "activityGroup", turnId: "turn-2" })
  })

  test("flushes a group when assistant text appears", () => {
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

    expect(blocks).toHaveLength(3)
    expect(blocks[0]).toMatchObject({ type: "activityGroup" })
    expect(blocks[1]).toMatchObject({ type: "message", key: "text-1" })
    expect(blocks[2]).toMatchObject({ type: "activityGroup" })
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
})

describe("getActivityGroupSummary", () => {
  test("counts unique files and raw searches for exploration groups", () => {
    const group = getOnlyGroup([
      createToolMessage({
        id: "cmd-1",
        turnId: "turn-1",
        itemType: "commandExecution",
        input: {
          commandActions: [
            { type: "read", path: "src/features/chat/types.ts" },
            { type: "search", query: "currentMessages" },
          ],
        },
      }),
      createToolMessage({
        id: "cmd-2",
        turnId: "turn-1",
        itemType: "commandExecution",
        input: {
          commandActions: [{ type: "read", path: "src/features/chat/types.ts" }],
        },
      }),
      createToolMessage({
        id: "search-1",
        turnId: "turn-1",
        itemType: "webSearch",
        input: { query: "ChatMessages timeline" },
      }),
    ])

    expect(getActivityGroupSummary(group)).toBe("Explored 1 file, 2 searches")
  })

  test("counts unique changed files for edit groups", () => {
    const group = getOnlyGroup([
      createToolMessage({
        id: "edit-1",
        turnId: "turn-1",
        itemType: "fileChange",
        output: {
          changes: [
            { path: "src/a.ts", kind: { type: "update" } },
            { path: "src/a.ts", kind: { type: "update" } },
            { path: "src/b.ts", kind: { type: "add" } },
          ],
        },
      }),
    ])

    expect(getActivityGroupSummary(group)).toBe("Edited 2 files")
  })

  test("uses active tense when any row is unsettled", () => {
    const group = getOnlyGroup([
      createToolMessage({
        id: "cmd-1",
        turnId: "turn-1",
        itemType: "commandExecution",
        status: "running",
        input: {
          commandActions: [{ type: "search", query: "ChatTimelineItem" }],
        },
      }),
    ])

    expect(isActivityGroupActive(group)).toBe(true)
    expect(getActivityGroupSummary(group)).toBe("Exploring 1 search")
  })

  test("matches the current-thread exploration acceptance example", () => {
    const group = getOnlyGroup([
      createToolMessage({
        id: "read-types",
        turnId: "turn-acceptance",
        itemType: "commandExecution",
        input: {
          commandActions: [{ type: "read", path: "src/features/chat/types.ts" }],
        },
      }),
      createToolMessage({
        id: "search-1",
        turnId: "turn-acceptance",
        itemType: "commandExecution",
        input: {
          commandActions: [{ type: "search", query: "currentMessages|messagesBySession|ChatTimelineItem" }],
        },
      }),
      createToolMessage({
        id: "search-2",
        turnId: "turn-acceptance",
        itemType: "commandExecution",
        input: {
          commandActions: [{ type: "search", query: "webSearch|imageGeneration|commandExecution|fileChange" }],
        },
      }),
      createToolMessage({
        id: "read-chat-messages",
        turnId: "turn-acceptance",
        itemType: "commandExecution",
        input: {
          commandActions: [{ type: "read", path: "src/features/chat/components/ChatMessages.tsx" }],
        },
      }),
      createToolMessage({
        id: "read-adapter",
        turnId: "turn-acceptance",
        itemType: "commandExecution",
        input: {
          commandActions: [{ type: "read", path: "src/features/chat/runtime/codexAdapter.ts" }],
        },
      }),
    ])

    expect(getActivityGroupSummary(group)).toBe("Explored 3 files, 2 searches")
  })
})
