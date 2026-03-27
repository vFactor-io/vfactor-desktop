import type {
  HarnessId,
  MessageWithParts,
  RuntimePromptState,
  RuntimeSession,
} from "../types"

export interface ProjectChatState {
  sessions: RuntimeSession[]
  activeSessionId: string | null
  projectPath?: string
  archivedSessionIds?: string[]
  selectedHarnessId: HarnessId
}

export interface PersistedChatState {
  chatByProject: Record<string, ProjectChatState>
  messagesBySession: Record<string, MessageWithParts[]>
  activePromptBySession?: Record<string, RuntimePromptState>
}

export interface FileChangeEvent {
  file: string
  event: "add" | "change" | "unlink"
}
