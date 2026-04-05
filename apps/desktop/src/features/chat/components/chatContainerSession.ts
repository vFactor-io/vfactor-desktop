import { hasProjectChatSession } from "../store/sessionState"
import type { ProjectChatState } from "../store/storeTypes"

export function resolveChatContainerSessionId(
  projectChat: ProjectChatState | null,
  sessionId: string | null,
  activeSessionId: string | null
): string | null {
  if (projectChat && hasProjectChatSession(projectChat, sessionId)) {
    return sessionId
  }

  return activeSessionId
}
