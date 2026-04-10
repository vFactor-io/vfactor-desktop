import { describe, expect, test } from "bun:test"
import { getWorktreeActivityStatus } from "./worktreeActivity"

describe("getWorktreeActivityStatus", () => {
  test("returns the active status for a worktree session even when another session is selected elsewhere", () => {
    expect(
      getWorktreeActivityStatus(
        {
          sessions: [
            {
              id: "session-running",
              harnessId: "codex",
              createdAt: 1,
              updatedAt: 2,
            },
          ],
          activeSessionId: "session-running",
          archivedSessionIds: [],
          selectedHarnessId: "codex",
        },
        {
          "session-running": {
            status: "streaming",
            unread: true,
          },
          "session-selected-elsewhere": {
            status: "idle",
            unread: false,
          },
        }
      )
    ).toBe("streaming")
  })

  test("ignores archived sessions when deriving workspace activity", () => {
    expect(
      getWorktreeActivityStatus(
        {
          sessions: [
            {
              id: "session-archived",
              harnessId: "codex",
              createdAt: 1,
              updatedAt: 2,
            },
          ],
          activeSessionId: null,
          archivedSessionIds: ["session-archived"],
          selectedHarnessId: "codex",
        },
        {
          "session-archived": {
            status: "streaming",
            unread: false,
          },
        }
      )
    ).toBeNull()
  })

  test("returns the first active session status found in array order", () => {
    expect(
      getWorktreeActivityStatus(
        {
          sessions: [
            {
              id: "session-connecting",
              harnessId: "codex",
              createdAt: 3,
              updatedAt: 4,
            },
            {
              id: "session-streaming",
              harnessId: "codex",
              createdAt: 1,
              updatedAt: 2,
            },
          ],
          // Included to mirror the real store shape; getWorktreeActivityStatus does not read it.
          activeSessionId: "session-connecting",
          archivedSessionIds: [],
          selectedHarnessId: "codex",
        },
        {
          "session-connecting": {
            status: "connecting",
            unread: false,
          },
          "session-streaming": {
            status: "streaming",
            unread: false,
          },
        }
      )
    ).toBe("connecting")
  })
})
