import type {
  HarnessId,
  MessageWithParts,
  RuntimePromptState,
  RuntimeSession,
  SessionActivityState,
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
  sessionActivityById?: Record<string, SessionActivityState>
}

export interface FileChangeEvent {
  file: string
  event: "add" | "change" | "unlink"
}

export type WorkspaceSetupStepId =
  | "review-request"
  | "generate-workspace-name"
  | "create-workspace"
  | "prepare-chat-session"

export type WorkspaceSetupStepStatus = "pending" | "active" | "completed" | "error"

export interface WorkspaceSetupStep {
  id: WorkspaceSetupStepId
  label: string
  status: WorkspaceSetupStepStatus
}

export interface WorkspaceSetupState {
  status: "running" | "error"
  title: string
  detail?: string | null
  errorMessage?: string | null
  activeStepId: WorkspaceSetupStepId
  steps: WorkspaceSetupStep[]
}

export interface WorkspaceSetupIntent {
  prompt: string
  autoSubmit?: boolean
}
