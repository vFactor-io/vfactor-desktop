import type {
  HarnessId,
  MessageWithParts,
  RuntimePromptState,
  RuntimeSession,
} from "../types"

export interface WorktreeChatState {
  sessions: RuntimeSession[]
  activeSessionId: string | null
  worktreePath?: string
  archivedSessionIds?: string[]
  selectedHarnessId: HarnessId
}

export type ProjectChatState = WorktreeChatState

export interface PersistedChatState {
  chatByProject?: Record<string, WorktreeChatState>
  chatByWorktree?: Record<string, WorktreeChatState>
  messagesBySession: Record<string, MessageWithParts[]>
  activePromptBySession?: Record<string, RuntimePromptState>
}

export interface FileChangeEvent {
  file: string
  event: "add" | "change" | "unlink"
}
