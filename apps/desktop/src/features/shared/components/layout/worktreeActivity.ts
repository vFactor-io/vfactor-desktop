import type { ProjectChatState } from "@/features/chat/store/storeTypes"
import type { ChatStatus, SessionActivityState } from "@/features/chat/types"

export function getWorktreeActivityStatus(
  projectChat: ProjectChatState | null | undefined,
  sessionActivityById: Record<string, SessionActivityState>
): Extract<ChatStatus, "connecting" | "streaming"> | null {
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
