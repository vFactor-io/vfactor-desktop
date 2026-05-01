import { beforeEach, describe, expect, mock, test } from "bun:test"

const ensureChatSessionTab = mock(() => {})
const chatState: {
  chatByWorktree: Record<string, { sessions: Array<{ id: string; title?: string | null }> }>
} = {
  chatByWorktree: {},
}

mock.module("@/features/editor/store", () => ({
  useTabStore: {
    getState: () => ({
      ensureChatSessionTab,
    }),
  },
}))

mock.module("../store", () => ({
  useChatStore: {
    getState: () => chatState,
  },
}))

const { ensureComposerSessionTab } = await import("./composerSessionTab")

describe("ensureComposerSessionTab", () => {
  beforeEach(() => {
    ensureChatSessionTab.mockClear()
    chatState.chatByWorktree = {}
  })

  test("uses the session title when recreating a chat tab from the empty state", () => {
    chatState.chatByWorktree["worktree-1"] = {
      sessions: [{ id: "session-1", title: "Debug auth flow" }],
    }

    ensureComposerSessionTab("worktree-1", "session-1")

    expect(ensureChatSessionTab).toHaveBeenCalledTimes(1)
    expect(ensureChatSessionTab).toHaveBeenCalledWith(
      "session-1",
      "Debug auth flow",
      "worktree-1"
    )
  })

  test("falls back safely when the session exists without a title", () => {
    chatState.chatByWorktree["worktree-1"] = {
      sessions: [{ id: "session-1" }],
    }

    ensureComposerSessionTab("worktree-1", "session-1")

    expect(ensureChatSessionTab).toHaveBeenCalledTimes(1)
    expect(ensureChatSessionTab).toHaveBeenCalledWith("session-1", undefined, "worktree-1")
  })

  test("does nothing when the composer has no resolved worktree or session", () => {
    ensureComposerSessionTab(null, "session-1")
    ensureComposerSessionTab("worktree-1", null)

    expect(ensureChatSessionTab).not.toHaveBeenCalled()
  })
})
