import { describe, expect, test } from "bun:test"

import type { MessageWithParts, RuntimePromptState } from "../types"
import { buildChatTimelineViewModel } from "./timelineViewModel"

function createCommandToolMessage(id: string, toolId = id): MessageWithParts {
  return {
    info: {
      id,
      sessionId: "session-1",
      role: "assistant",
      createdAt: 1,
      turnId: "turn-1",
      itemType: "commandExecution",
    },
    parts: [
      {
        id: `${id}:tool`,
        type: "tool",
        messageId: id,
        sessionId: "session-1",
        tool: "command/exec",
        state: {
          status: "pending",
          title: "pwd",
          input: {
            command: "pwd",
          },
        },
      },
      {
        id: `${id}:text`,
        type: "text",
        text: "",
      },
    ].map((part) =>
      part.type === "tool"
        ? {
            ...part,
            id: toolId,
          }
        : part
    ),
  }
}

function createApprovalPromptState(itemId?: string): RuntimePromptState {
  return {
    prompt: {
      id: "prompt-1",
      kind: "approval",
      title: "Approve command",
      approval: {
        kind: "commandExecution",
        callId: "call-1",
        turnId: "turn-1",
        conversationId: "conversation-1",
        itemId,
        command: "pwd",
      },
    },
    status: "active",
    createdAt: 10,
    updatedAt: 20,
  }
}

describe("buildChatTimelineViewModel", () => {
  test("highlights the existing tool row when the approval references a streamed tool item", () => {
    const message = createCommandToolMessage("call-1:message", "call-1")
    const viewModel = buildChatTimelineViewModel({
      messages: [message],
      activePromptState: createApprovalPromptState("call-1"),
    })

    expect(viewModel.renderedMessages).toHaveLength(1)
    expect(viewModel.approvalStateByMessageId.get("call-1:message")).toBe("pending")
  })

  test("adds a fallback approval row when the prompt has no matching tool message", () => {
    const viewModel = buildChatTimelineViewModel({
      messages: [],
      activePromptState: createApprovalPromptState("call-2"),
    })

    expect(viewModel.renderedMessages).toHaveLength(1)
    expect(viewModel.renderedMessages[0]?.info.id).toBe("approval:call-2")
    expect(viewModel.approvalStateByMessageId.get("approval:call-2")).toBe("pending")
  })
})
