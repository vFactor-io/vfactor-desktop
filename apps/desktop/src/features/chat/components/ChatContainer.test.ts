import { describe, expect, test } from "bun:test"

import type { ProjectChatState } from "../store/storeTypes"
import { resolveChatContainerSessionId } from "./chatContainerSession"

function createProjectChat(overrides: Partial<ProjectChatState> = {}): ProjectChatState {
  return {
    sessions: [
      {
        id: "session-1",
        harnessId: "codex",
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "session-2",
        harnessId: "codex",
        createdAt: 2,
        updatedAt: 2,
      },
    ],
    activeSessionId: "session-2",
    worktreePath: "/tmp/project-alpha",
    archivedSessionIds: [],
    selectedHarnessId: "codex",
    ...overrides,
  }
}

describe("resolveChatContainerSessionId", () => {
  test("keeps the tab session when it still exists in the current worktree", () => {
    const projectChat = createProjectChat()

    expect(resolveChatContainerSessionId(projectChat, "session-1", "session-2")).toBe("session-1")
  })

  test("falls back to the active session when the tab session is missing", () => {
    const projectChat = createProjectChat()

    expect(resolveChatContainerSessionId(projectChat, "missing-session", "session-2")).toBe("session-2")
  })

  test("falls back to the active session when the tab session was archived", () => {
    const projectChat = createProjectChat({
      archivedSessionIds: ["session-1"],
    })

    expect(resolveChatContainerSessionId(projectChat, "session-1", "session-2")).toBe("session-2")
  })

  test("preserves draft mode when there is no active fallback session", () => {
    const projectChat = createProjectChat({
      activeSessionId: null,
    })

    expect(resolveChatContainerSessionId(projectChat, "missing-session", null)).toBeNull()
  })
})
