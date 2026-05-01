import { useTabStore } from "@/features/editor/store"
import { useChatStore } from "../store"

export function ensureComposerSessionTab(
  worktreeId: string | null,
  sessionId: string | null
): void {
  if (!worktreeId || !sessionId) {
    return
  }

  const projectChat = useChatStore.getState().chatByWorktree[worktreeId]
  const session = projectChat?.sessions.find((candidate) => candidate.id === sessionId) ?? null

  useTabStore.getState().ensureChatSessionTab(sessionId, session?.title, worktreeId)
}
