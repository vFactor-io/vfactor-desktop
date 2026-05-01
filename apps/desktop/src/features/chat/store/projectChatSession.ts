import { useTabStore } from "@/features/editor/store"
import {
  type CollaborationModeKind,
  type HarnessId,
  type RuntimeAttachmentPart,
  type RuntimeModeKind,
  type RuntimeSession,
} from "../types"
import { useChatStore } from "./chatStore"
import { hasProjectChatSession } from "./sessionState"

export interface ProjectChatTurnOptions {
  attachments?: RuntimeAttachmentPart[]
  harnessId?: HarnessId
  agent?: string
  collaborationMode?: CollaborationModeKind
  runtimeMode?: RuntimeModeKind
  model?: string
  reasoningEffort?: string | null
  modelVariant?: string | null
  fastMode?: boolean
}

interface ProjectChatWorkspaceInput {
  worktreeId: string | null
  worktreePath?: string | null
}

type ProjectChatSessionReadyHandler = (
  session: RuntimeSession
) => boolean | void | Promise<boolean | void>

type ProjectChatSessionResult =
  | {
      ok: true
      session: RuntimeSession
      createdSession: boolean
    }
  | {
      ok: false
      reason: "empty-turn" | "missing-workspace" | "session-unavailable" | "cancelled"
      session?: RuntimeSession
    }

interface EnsureProjectChatSessionInput extends ProjectChatWorkspaceInput {
  activeSessionId?: string | null
  options?: Pick<ProjectChatTurnOptions, "harnessId" | "runtimeMode">
  createRemoteSession?: boolean
}

interface SubmitProjectChatTurnInput extends ProjectChatWorkspaceInput {
  activeSessionId?: string | null
  text: string
  options?: ProjectChatTurnOptions
  onSessionReady?: ProjectChatSessionReadyHandler
}

interface ExecuteProjectChatCommandInput extends ProjectChatWorkspaceInput {
  activeSessionId?: string | null
  command: string
  args?: string
  onSessionReady?: ProjectChatSessionReadyHandler
}

function closeProjectChatSessionTab(worktreeId: string | null, sessionId: string): void {
  useTabStore.getState().closeChatSessionTab(sessionId, worktreeId)
}

async function cleanupCreatedProjectChatSession(
  worktreeId: string | null,
  sessionId: string
): Promise<void> {
  closeProjectChatSessionTab(worktreeId, sessionId)

  if (!worktreeId) {
    return
  }

  await useChatStore.getState().deleteSession(worktreeId, sessionId)
}

export function ensureProjectChatSessionTab(
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

export async function createProjectChatSession(
  input: ProjectChatWorkspaceInput & {
    options?: Pick<ProjectChatTurnOptions, "harnessId" | "runtimeMode">
  }
): Promise<ProjectChatSessionResult> {
  return ensureProjectChatSession({
    ...input,
    createRemoteSession: false,
  })
}

export async function submitProjectChatTurn(
  input: SubmitProjectChatTurnInput
): Promise<ProjectChatSessionResult> {
  const attachments = input.options?.attachments ?? []

  if (!input.text.trim() && attachments.length === 0) {
    return {
      ok: false,
      reason: "empty-turn",
    }
  }

  const sessionResult = await ensureProjectChatSession(input)
  if (!sessionResult.ok) {
    return sessionResult
  }

  const shouldContinue = await input.onSessionReady?.(sessionResult.session)
  if (shouldContinue === false) {
    if (sessionResult.createdSession) {
      await cleanupCreatedProjectChatSession(input.worktreeId, sessionResult.session.id).catch(
        (error) => {
          console.error("[projectChatSession] Failed to clean up cancelled session:", error)
        }
      )
    }

    return {
      ok: false,
      reason: "cancelled",
      session: sessionResult.session,
    }
  }

  await useChatStore.getState().sendMessage(sessionResult.session.id, input.text, input.options)
  return sessionResult
}

export async function executeProjectChatCommand(
  input: ExecuteProjectChatCommandInput
): Promise<ProjectChatSessionResult> {
  const sessionResult = await ensureProjectChatSession({
    ...input,
    createRemoteSession: true,
  })
  if (!sessionResult.ok) {
    return sessionResult
  }

  const shouldContinue = await input.onSessionReady?.(sessionResult.session)
  if (shouldContinue === false) {
    if (sessionResult.createdSession) {
      await cleanupCreatedProjectChatSession(input.worktreeId, sessionResult.session.id).catch(
        (error) => {
          console.error("[projectChatSession] Failed to clean up cancelled session:", error)
        }
      )
    }

    return {
      ok: false,
      reason: "cancelled",
      session: sessionResult.session,
    }
  }

  await useChatStore.getState().executeCommand(
    sessionResult.session.id,
    input.command,
    input.args
  )
  return sessionResult
}

async function ensureProjectChatSession(
  input: EnsureProjectChatSessionInput
): Promise<ProjectChatSessionResult> {
  if (!input.worktreeId || !input.worktreePath) {
    return {
      ok: false,
      reason: "missing-workspace",
    }
  }

  const chatStore = useChatStore.getState()
  if (!chatStore.isInitialized) {
    await chatStore.initialize()
  }

  await useChatStore.getState().loadSessionsForProject(input.worktreeId, input.worktreePath)

  const projectChat = useChatStore.getState().chatByWorktree[input.worktreeId] ?? null
  const activeSession = input.activeSessionId
    ? projectChat?.sessions.find((session) => session.id === input.activeSessionId) ?? null
    : null

  if (activeSession && projectChat && hasProjectChatSession(projectChat, activeSession.id)) {
    ensureProjectChatSessionTab(input.worktreeId, activeSession.id)
    return {
      ok: true,
      session: activeSession,
      createdSession: false,
    }
  }

  const session = input.createRemoteSession
    ? await useChatStore.getState().createSession(input.worktreeId, input.worktreePath, input.options)
    : useChatStore.getState().createOptimisticSession(
        input.worktreeId,
        input.worktreePath,
        input.options
      )

  if (!session) {
    return {
      ok: false,
      reason: "session-unavailable",
    }
  }

  ensureProjectChatSessionTab(input.worktreeId, session.id)
  return {
    ok: true,
    session,
    createdSession: true,
  }
}
