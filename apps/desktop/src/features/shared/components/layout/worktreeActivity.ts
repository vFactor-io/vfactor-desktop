import type { ProjectChatState } from "@/features/chat/store/storeTypes"
import type { ChatStatus, SessionActivityState } from "@/features/chat/types"

type WorktreeActivityStatus = Extract<ChatStatus, "connecting" | "streaming"> | null

/**
 * Returns the first active chat status found for a worktree's non-archived sessions.
 * Array order determines precedence, so the first matching session wins.
 */
export function getWorktreeActivityStatus(
  projectChat: ProjectChatState | null | undefined,
  sessionActivityById: Record<string, SessionActivityState>
): WorktreeActivityStatus {
  if (!projectChat) {
    return null
  }

  const archivedSessionIds = new Set(projectChat.archivedSessionIds ?? [])

  for (const session of projectChat.sessions) {
    if (archivedSessionIds.has(session.id)) {
      continue
    }

    const status = sessionActivityById[session.id]?.status
    if (status === "connecting" || status === "streaming") {
      return status
    }
  }

  return null
}

export function getVisibleWorktreeActivityById(
  visibleWorktreeIds: string[],
  chatByWorktree: Record<string, ProjectChatState | undefined>,
  sessionActivityById: Record<string, SessionActivityState>
): Record<string, WorktreeActivityStatus> {
  const worktreeActivityById: Record<string, WorktreeActivityStatus> = {}

  for (const worktreeId of visibleWorktreeIds) {
    worktreeActivityById[worktreeId] = getWorktreeActivityStatus(
      chatByWorktree[worktreeId],
      sessionActivityById
    )
  }

  return worktreeActivityById
}
