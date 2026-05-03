import { describe, expect, test } from "bun:test"

import type { MessageWithParts, RuntimeMessage } from "../types"
import { getTurnCollapsedMessagesByFooterId } from "./chatTimelineCollapse"
import { getChatScrollStateFromMetrics } from "./chatScrollState"

function createMessage(input: {
  id: string
  role?: RuntimeMessage["role"]
  itemType?: RuntimeMessage["itemType"]
  text?: string
  title?: string
}): MessageWithParts {
  return {
    info: {
      id: input.id,
      sessionId: "session-1",
      role: input.role ?? "assistant",
      createdAt: 1,
      itemType: input.itemType,
      title: input.title,
    },
    parts: [
      {
        id: `${input.id}:text`,
        type: "text",
        text: input.text ?? "message",
      },
    ],
  }
}

describe("getTurnCollapsedMessagesByFooterId", () => {
  test("keeps provider notices visible instead of folding them into completed turn steps", () => {
    const footer = createMessage({
      id: "assistant-final",
      itemType: "agentMessage",
      text: "Done",
    })
    const collapsedMessages = getTurnCollapsedMessagesByFooterId(
      [
        createMessage({
          id: "user-1",
          role: "user",
          text: "Ping",
        }),
        createMessage({
          id: "notice-1",
          itemType: "providerNotice",
          text: "Codex could not authenticate one MCP connector.",
        }),
        createMessage({
          id: "plan-1",
          itemType: "plan",
          text: "Plan",
        }),
        footer,
      ],
      "idle"
    )

    expect(collapsedMessages.get(footer.info.id)?.map((message) => message.info.id)).toEqual([
      "plan-1",
    ])
  })

  test("keeps the final assistant response as the collapse footer when reasoning arrives after it", () => {
    const footer = createMessage({
      id: "assistant-final",
      itemType: "agentMessage",
      text: "Here is the actual answer.",
    })
    const laterReasoning = createMessage({
      id: "reasoning-after-final",
      itemType: "reasoning",
      title: "Checking pull request status",
      text: "Reviewing the pull request state before wrapping up.",
    })
    const collapsedMessages = getTurnCollapsedMessagesByFooterId(
      [
        createMessage({
          id: "user-1",
          role: "user",
          text: "Ping",
        }),
        createMessage({
          id: "reasoning-before-final",
          itemType: "reasoning",
          title: "Reading context",
          text: "Reading the current workspace state.",
        }),
        footer,
        laterReasoning,
      ],
      "idle"
    )

    expect(collapsedMessages.has(laterReasoning.info.id)).toBe(false)
    expect(collapsedMessages.get(footer.info.id)?.map((message) => message.info.id)).toEqual([
      "reasoning-before-final",
      "reasoning-after-final",
    ])
  })
})

describe("getChatScrollStateFromMetrics", () => {
  test("treats non-overflowing content as both edges to hide fades and scroll button", () => {
    expect(
      getChatScrollStateFromMetrics({
        scrollOffset: 0,
        contentSize: 480,
        viewportSize: 600,
      })
    ).toEqual({
      isScrollable: false,
      isAtTop: true,
      isAtBottom: true,
      distanceFromBottom: 0,
    })
  })

  test("keeps the top fade hidden while showing that overflowing content is not at bottom", () => {
    expect(
      getChatScrollStateFromMetrics({
        scrollOffset: 0,
        contentSize: 900,
        viewportSize: 600,
      })
    ).toEqual({
      isScrollable: true,
      isAtTop: true,
      isAtBottom: false,
      distanceFromBottom: 300,
    })
  })

  test("shows detached state only when the user is away from both edges", () => {
    expect(
      getChatScrollStateFromMetrics({
        scrollOffset: 160,
        contentSize: 900,
        viewportSize: 600,
      })
    ).toEqual({
      isScrollable: true,
      isAtTop: false,
      isAtBottom: false,
      distanceFromBottom: 140,
    })
  })

  test("treats near-bottom scroll positions as bottom to avoid jitter", () => {
    expect(
      getChatScrollStateFromMetrics({
        scrollOffset: 294,
        contentSize: 900,
        viewportSize: 600,
      })
    ).toEqual({
      isScrollable: true,
      isAtTop: false,
      isAtBottom: true,
      distanceFromBottom: 6,
    })
  })
})
