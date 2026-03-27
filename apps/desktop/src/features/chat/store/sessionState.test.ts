import { describe, expect, test } from "bun:test"

import type { ProjectChatState } from "./storeTypes"
import { hasProjectChatSession, normalizeProjectChat } from "./sessionState"

function createProjectChat(overrides: Partial<ProjectChatState> = {}): ProjectChatState {
  return {
    sessions: [
      {
        id: "session-1",
        harnessId: "codex",
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    activeSessionId: "session-1",
    projectPath: "/tmp/agent",
    archivedSessionIds: [],
    selectedHarnessId: "codex",
    ...overrides,
  }
}

describe("hasProjectChatSession", () => {
  test("returns false for archived sessions", () => {
    const projectChat = createProjectChat({
      archivedSessionIds: ["session-1"],
    })

    expect(hasProjectChatSession(projectChat, "session-1")).toBe(false)
  })
})

describe("normalizeProjectChat", () => {
  test("clears a stale active session id", () => {
    const projectChat = createProjectChat({
      activeSessionId: "missing-session",
    })

    expect(normalizeProjectChat(projectChat).activeSessionId).toBeNull()
  })

  test("clears an archived active session id", () => {
    const projectChat = createProjectChat({
      archivedSessionIds: ["session-1"],
    })

    expect(normalizeProjectChat(projectChat).activeSessionId).toBeNull()
  })
})
