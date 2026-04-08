import { useState, useCallback, useEffect, useRef } from "react"
import { useShallow } from "zustand/react/shallow"
import { useCurrentProjectWorktree } from "@/features/shared/hooks"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
import type { Project, ProjectWorktree } from "@/features/workspace/types"
import { useProjectStore } from "@/features/workspace/store"
import { runCommandInProjectTerminal } from "@/features/terminal/utils/projectTerminal"
import { buildWorkspaceSetupScriptEnvironment } from "@/features/workspace/utils/setupScript"
import { suggestWorkspaceSetup } from "@/features/workspace/utils/workspaceSetup"
import type { DraftChatAttachment } from "../components/composer/attachments"
import { useChatStore, type ChildSessionState, type MessageWithParts } from "../store"
import { ensureComposerSessionTab } from "./composerSessionTab"
import { hasProjectChatSession } from "../store/sessionState"
import {
  createWorkspaceSetupState,
} from "../store/workspaceSetupState"
import type {
  ProjectChatState,
  WorkspaceSetupState,
  WorkspaceSetupStepId,
} from "../store/storeTypes"
import type {
  ChatStatus,
  CollaborationModeKind,
  RuntimePrompt,
  RuntimePromptResponse,
  RuntimePromptState,
  RuntimeSession,
} from "../types"

const EMPTY_MESSAGES: MessageWithParts[] = []

interface ComposerDraftState {
  input: string
  attachments: DraftChatAttachment[]
}

function getActiveSessionId(projectChat: ProjectChatState | null): string | null {
  if (!projectChat) {
    return null
  }

  return hasProjectChatSession(projectChat, projectChat.activeSessionId)
    ? projectChat.activeSessionId
    : null
}

export function useChatProjectState(): {
  selectedProjectId: string | null
  selectedProject: Project | null
  selectedWorktreeId: string | null
  selectedWorktree: ProjectWorktree | null
  activeSessionId: string | null
  workspaceSetupState: WorkspaceSetupState | null
} {
  const {
    selectedProjectId,
    selectedProject,
    selectedWorktreeId,
    selectedWorktree,
    selectedWorktreePath,
  } = useCurrentProjectWorktree()
  const { initialize, isInitialized, loadSessionsForProject } = useChatStore(
    useShallow((state) => ({
      initialize: state.initialize,
      isInitialized: state.isInitialized,
      loadSessionsForProject: state.loadSessionsForProject,
    }))
  )
  const projectChat = useChatStore((state) =>
    selectedWorktreeId ? state.chatByWorktree[selectedWorktreeId] ?? null : null
  )
  const workspaceSetupState = useChatStore((state) =>
    selectedProjectId ? state.workspaceSetupByProject[selectedProjectId] ?? null : null
  )
  const activeSessionId = getActiveSessionId(projectChat)

  useEffect(() => {
    initialize()
  }, [initialize])

  useEffect(() => {
    if (selectedWorktreeId && selectedWorktreePath && isInitialized) {
      loadSessionsForProject(selectedWorktreeId, selectedWorktreePath)
    }
  }, [selectedWorktreeId, selectedWorktreePath, isInitialized, loadSessionsForProject])

  return {
    selectedProjectId,
    selectedProject,
    selectedWorktreeId,
    selectedWorktree,
    activeSessionId,
    workspaceSetupState,
  }
}

export function useChatTimelineState(activeSessionId: string | null): {
  messages: MessageWithParts[]
  childSessions?: Map<string, ChildSessionState>
  status: ChatStatus
  activePromptState: RuntimePromptState | null
} {
  const messages = useChatStore((state) =>
    activeSessionId ? state.messagesBySession[activeSessionId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES
  )
  const currentSessionId = useChatStore((state) => state.currentSessionId)
  const childSessions = useChatStore((state) => state.childSessions)
  const sessionStatus = useChatStore((state) =>
    activeSessionId ? state.sessionActivityById[activeSessionId]?.status ?? "idle" : "idle"
  )
  const activePromptState = useChatStore((state) =>
    activeSessionId ? state.activePromptBySession[activeSessionId] ?? null : null
  )

  const isResolvedActiveSession = activeSessionId != null && currentSessionId === activeSessionId

  return {
    messages,
    childSessions: isResolvedActiveSession ? childSessions : undefined,
    status: sessionStatus,
    activePromptState,
  }
}

export function useChatHasContent(activeSessionId: string | null): boolean {
  return useChatStore((state) =>
    activeSessionId ? (state.messagesBySession[activeSessionId]?.length ?? 0) > 0 : false
  )
}

export function useChatComposerState({
  selectedProjectId,
  selectedWorktreePath,
  selectedWorktreeId,
  selectedWorktree,
  activeSessionId,
}: {
  selectedProjectId: string | null
  selectedWorktreePath?: string | null
  selectedWorktreeId: string | null
  selectedWorktree: ProjectWorktree | null
  activeSessionId: string | null
}): {
  input: string
  setInput: (value: string) => void
  attachments: DraftChatAttachment[]
  setAttachments: (attachments: DraftChatAttachment[]) => void
  status: ChatStatus
  activePrompt: RuntimePrompt | null
  answerPrompt: (response: RuntimePromptResponse) => Promise<void>
  dismissPrompt: () => Promise<void>
  abort: () => Promise<void>
  executeCommand: (command: string, args?: string) => Promise<boolean>
  submit: (
    text: string,
    options?: {
      agent?: string
      collaborationMode?: CollaborationModeKind
      model?: string
      reasoningEffort?: string | null
      fastMode?: boolean
      attachments?: DraftChatAttachment[]
    }
  ) => Promise<boolean>
} {
  const [draftStateBySessionKey, setDraftStateBySessionKey] = useState<Record<string, ComposerDraftState>>({})
  const {
    initialize,
    sessionActivityById,
    activePromptBySession,
    createSession,
    createOptimisticSession,
    answerPrompt,
    dismissPrompt,
    sendMessage,
    abortSession,
    executeCommand,
  } = useChatStore(
    useShallow((state) => ({
      initialize: state.initialize,
      sessionActivityById: state.sessionActivityById,
      activePromptBySession: state.activePromptBySession,
      createSession: state.createSession,
      createOptimisticSession: state.createOptimisticSession,
      answerPrompt: state.answerPrompt,
      dismissPrompt: state.dismissPrompt,
      sendMessage: state.sendMessage,
      abortSession: state.abortSession,
      executeCommand: state.executeCommand,
    }))
  )

  const draftSessionKey =
    activeSessionId ?? (selectedWorktreeId ? `draft:${selectedWorktreeId}` : "draft:no-project")
  const draftState = draftStateBySessionKey[draftSessionKey]
  const input = draftState?.input ?? ""
  const attachments = draftState?.attachments ?? []
  const activePromptState: RuntimePromptState | null =
    activeSessionId ? activePromptBySession[activeSessionId] ?? null : null
  const activePrompt = activePromptState?.status === "active" ? activePromptState.prompt : null
  const uiStatus = activeSessionId ? sessionActivityById[activeSessionId]?.status ?? "idle" : "idle"

  const setInput = useCallback(
    (value: string) => {
      setDraftStateBySessionKey((current) => ({
        ...current,
        [draftSessionKey]: {
          input: value,
          attachments: current[draftSessionKey]?.attachments ?? [],
        },
      }))
    },
    [draftSessionKey]
  )

  const setAttachments = useCallback(
    (nextAttachments: DraftChatAttachment[]) => {
      setDraftStateBySessionKey((current) => ({
        ...current,
        [draftSessionKey]: {
          input: current[draftSessionKey]?.input ?? "",
          attachments: nextAttachments,
        },
      }))
    },
    [draftSessionKey]
  )

  const clearDraftState = useCallback((sessionKey: string) => {
    setDraftStateBySessionKey((current) => {
      if (!(sessionKey in current)) {
        return current
      }

      const nextDrafts = { ...current }
      delete nextDrafts[sessionKey]
      return nextDrafts
    })
  }, [])

  const submit = useCallback(
    async (
      text: string,
      options?: {
        agent?: string
        collaborationMode?: CollaborationModeKind
        model?: string
        reasoningEffort?: string | null
        fastMode?: boolean
        attachments?: DraftChatAttachment[]
      }
    ) => {
      const attachmentsToSend = options?.attachments ?? attachments

      if (
        (!text.trim() && attachmentsToSend.length === 0) ||
        uiStatus === "streaming" ||
        uiStatus === "connecting"
      ) {
        return false
      }

      let targetSessionId = activeSessionId

      if (!selectedProjectId || !selectedWorktreePath || !selectedWorktreeId || !selectedWorktree) {
        return false
      }

      if (!targetSessionId) {
        let session = createOptimisticSession(selectedWorktreeId, selectedWorktreePath)
        if (!session) {
          await initialize()
          session = createOptimisticSession(selectedWorktreeId, selectedWorktreePath)
        }

        if (!session) {
          return false
        }

        targetSessionId = session.id
      }

      setInput("")
      ensureComposerSessionTab(selectedWorktreeId, targetSessionId)
      clearDraftState(draftSessionKey)
      clearDraftState(targetSessionId)
      await sendMessage(targetSessionId, text, {
        ...options,
        attachments: attachmentsToSend,
      })
      return true
    },
    [
      activeSessionId,
      attachments,
      clearDraftState,
      createOptimisticSession,
      draftSessionKey,
      initialize,
      selectedProjectId,
      selectedWorktree,
      selectedWorktreeId,
      selectedWorktreePath,
      sendMessage,
      setInput,
      uiStatus,
    ]
  )

  const handleAnswerPrompt = useCallback(
    async (response: Parameters<typeof answerPrompt>[1]) => {
      if (!activeSessionId) {
        return
      }

      await answerPrompt(activeSessionId, response)
    },
    [activeSessionId, answerPrompt]
  )

  const handleDismissPrompt = useCallback(async () => {
    if (!activeSessionId) {
      return
    }

    await dismissPrompt(activeSessionId)
  }, [activeSessionId, dismissPrompt])

  const abort = useCallback(async () => {
    if (!activeSessionId) {
      return
    }

    await abortSession(activeSessionId)
  }, [activeSessionId, abortSession])

  const handleExecuteCommand = useCallback(
    async (command: string, args?: string) => {
      let targetSessionId = activeSessionId

      if (!targetSessionId) {
        if (!selectedProjectId || !selectedWorktreePath) {
          return false
        }

        const session = await createSession(selectedWorktreeId, selectedWorktreePath)
        if (!session) {
          return false
        }

        targetSessionId = session.id
      }

      ensureComposerSessionTab(selectedWorktreeId, targetSessionId)
      await executeCommand(targetSessionId, command, args)
      return true
    },
    [
      activeSessionId,
      createSession,
      executeCommand,
      selectedProjectId,
      selectedWorktreePath,
    ]
  )

  return {
    input,
    setInput,
    attachments,
    setAttachments,
    status: uiStatus,
    activePrompt,
    answerPrompt: handleAnswerPrompt,
    dismissPrompt: handleDismissPrompt,
    abort,
    executeCommand: handleExecuteCommand,
    submit,
  }
}

export function useNewWorkspaceSetupState(): {
  isActive: boolean
  input: string
  setInput: (value: string) => void
  submit: (
    text: string,
    options?: {
      agent?: string
      collaborationMode?: CollaborationModeKind
      model?: string
      reasoningEffort?: string | null
      fastMode?: boolean
    }
  ) => Promise<boolean>
  workspaceSetupState: WorkspaceSetupState | null
  cancel: () => void
} {
  const {
    selectedProjectId,
    selectedProject,
    selectedWorktree,
    selectedWorktreePath,
  } = useCurrentProjectWorktree()
  const workspaceSetupModel = useSettingsStore((state) => state.workspaceSetupModel)
  const initializeSettings = useSettingsStore((state) => state.initialize)
  const newWorkspaceSetupProjectId = useProjectStore((state) => state.newWorkspaceSetupProjectId)
  const cancelNewWorkspaceSetup = useProjectStore((state) => state.cancelNewWorkspaceSetup)
  const {
    loadSessionsForProject,
    createOptimisticSession,
    sendMessage,
    setWorkspaceSetupState,
    setWorkspaceSetupIntent,
  } =
    useChatStore(
      useShallow((state) => ({
        loadSessionsForProject: state.loadSessionsForProject,
        createOptimisticSession: state.createOptimisticSession,
        sendMessage: state.sendMessage,
        setWorkspaceSetupState: state.setWorkspaceSetupState,
        setWorkspaceSetupIntent: state.setWorkspaceSetupIntent,
      }))
    )
  const workspaceSetupState = useChatStore((state) =>
    selectedProjectId ? state.workspaceSetupByProject[selectedProjectId] ?? null : null
  )
  const workspaceSetupIntent = useChatStore((state) =>
    selectedProjectId ? state.workspaceSetupIntentByProject[selectedProjectId] ?? null : null
  )
  const [draftInputsByProjectKey, setDraftInputsByProjectKey] = useState<Record<string, string>>({})

  useEffect(() => {
    void initializeSettings()
  }, [initializeSettings])

  const draftProjectKey = selectedProjectId ? `new-workspace:${selectedProjectId}` : "new-workspace:none"
  const input = draftInputsByProjectKey[draftProjectKey] ?? ""
  const isActive = selectedProjectId != null && newWorkspaceSetupProjectId === selectedProjectId
  const autoSubmitKeyRef = useRef<string | null>(null)

  const setInput = useCallback(
    (value: string) => {
      setDraftInputsByProjectKey((current) => ({
        ...current,
        [draftProjectKey]: value,
      }))
    },
    [draftProjectKey]
  )

  const clearDraftInput = useCallback((projectKey: string) => {
    setDraftInputsByProjectKey((current) => {
      if (!(projectKey in current)) {
        return current
      }

      const nextDrafts = { ...current }
      delete nextDrafts[projectKey]
      return nextDrafts
    })
  }, [])

  const workspaceSetupRunIdRef = useRef(0)

  const invalidateWorkspaceSetupRun = useCallback(() => {
    workspaceSetupRunIdRef.current += 1
  }, [])

  const isWorkspaceSetupRunCurrent = useCallback((runId: number, projectId: string) => {
    const { focusedProjectId, newWorkspaceSetupProjectId } = useProjectStore.getState()

    return (
      workspaceSetupRunIdRef.current === runId &&
      focusedProjectId === projectId &&
      newWorkspaceSetupProjectId === projectId
    )
  }, [])

  const cancel = useCallback(() => {
    invalidateWorkspaceSetupRun()
    cancelNewWorkspaceSetup()
    if (selectedProjectId) {
      setWorkspaceSetupState(selectedProjectId, null)
      setWorkspaceSetupIntent(selectedProjectId, null)
    }
  }, [
    cancelNewWorkspaceSetup,
    invalidateWorkspaceSetupRun,
    selectedProjectId,
    setWorkspaceSetupIntent,
    setWorkspaceSetupState,
  ])

  useEffect(() => {
    const nextPrompt = workspaceSetupIntent?.prompt?.trim()
    if (!nextPrompt) {
      return
    }

    setDraftInputsByProjectKey((current) => {
      if (current[draftProjectKey] === nextPrompt) {
        return current
      }

      return {
        ...current,
        [draftProjectKey]: nextPrompt,
      }
    })
  }, [draftProjectKey, workspaceSetupIntent?.prompt])

  const submit = useCallback(
    async (
      text: string,
      options?: {
        agent?: string
        collaborationMode?: CollaborationModeKind
        model?: string
        reasoningEffort?: string | null
        fastMode?: boolean
      }
    ) => {
      if (!text.trim() || !isActive || !selectedProjectId || !selectedProject) {
        return false
      }

      const setupRunId = workspaceSetupRunIdRef.current + 1
      workspaceSetupRunIdRef.current = setupRunId

      const setupProjectId = selectedProjectId
      const setupProject = selectedProject
      const setupSourceProjectPath = selectedWorktreePath ?? setupProject.repoRootPath
      const setupSourceBranchName =
        setupProject.targetBranch?.trim() || selectedWorktree?.branchName || "main"
      const setupDraftProjectKey = draftProjectKey
      let failedStepId: WorkspaceSetupStepId = "generate-workspace-name"

      setWorkspaceSetupState(
        setupProjectId,
        createWorkspaceSetupState("generate-workspace-name")
      )

      try {
        const suggestion = await suggestWorkspaceSetup({
          projectPath: setupSourceProjectPath,
          currentBranchName: setupSourceBranchName,
          prompt: text,
          model: workspaceSetupModel,
        })
        if (!isWorkspaceSetupRunCurrent(setupRunId, setupProjectId)) {
          return false
        }

        failedStepId = "create-workspace"
        setWorkspaceSetupState(
          setupProjectId,
          createWorkspaceSetupState("create-workspace", {
            detail: suggestion.workspaceName,
          })
        )

        const createdWorktree = await useProjectStore.getState().createWorktreeFromIntent(
          setupProjectId,
          {
            branchName: suggestion.branchName,
            name: suggestion.workspaceName,
          },
          {
            activateOnSuccess: false,
          }
        )
        if (!isWorkspaceSetupRunCurrent(setupRunId, setupProjectId)) {
          return false
        }

        await useProjectStore.getState().selectProject(setupProjectId)
        await useProjectStore.getState().selectWorktree(setupProjectId, createdWorktree.id)
        if (!isWorkspaceSetupRunCurrent(setupRunId, setupProjectId)) {
          return false
        }

        const setupScript = setupProject.setupScript?.trim()
        if (setupScript) {
          try {
            await runCommandInProjectTerminal({
              projectId: createdWorktree.id,
              cwd: createdWorktree.path,
              command: setupScript,
              environment: buildWorkspaceSetupScriptEnvironment(setupProject, createdWorktree),
            })
          } catch (error) {
            console.error(
              `[useChat] Failed to run setup script for workspace "${createdWorktree.name}":`,
              error
            )
          }
        }
        if (!isWorkspaceSetupRunCurrent(setupRunId, setupProjectId)) {
          return false
        }

        failedStepId = "prepare-chat-session"
        setWorkspaceSetupState(
          setupProjectId,
          createWorkspaceSetupState("prepare-chat-session", {
            detail: createdWorktree.name,
          })
        )

        await loadSessionsForProject(createdWorktree.id, createdWorktree.path)
        if (!isWorkspaceSetupRunCurrent(setupRunId, setupProjectId)) {
          return false
        }
        const session = createOptimisticSession(createdWorktree.id, createdWorktree.path)
        if (!session) {
          throw new Error("Failed to prepare a chat session for the new workspace.")
        }
        if (!isWorkspaceSetupRunCurrent(setupRunId, setupProjectId)) {
          return false
        }

        clearDraftInput(setupDraftProjectKey)
        setWorkspaceSetupState(setupProjectId, null)
        setWorkspaceSetupIntent(setupProjectId, null)
        cancelNewWorkspaceSetup()
        await sendMessage(session.id, text, options)
        return true
      } catch (error) {
        if (!isWorkspaceSetupRunCurrent(setupRunId, setupProjectId)) {
          return false
        }

        console.error("[useChat] Failed to create a workspace from the first prompt:", error)
        setWorkspaceSetupState(
          setupProjectId,
          createWorkspaceSetupState(failedStepId, {
            status: "error",
            errorMessage:
              error instanceof Error ? error.message : "Workspace setup failed.",
          })
        )
        return false
      }
    },
    [
      cancelNewWorkspaceSetup,
      clearDraftInput,
      createOptimisticSession,
      draftProjectKey,
      invalidateWorkspaceSetupRun,
      isWorkspaceSetupRunCurrent,
      isActive,
      loadSessionsForProject,
      selectedProject,
      selectedProjectId,
      selectedWorktree?.branchName,
      selectedWorktreePath,
      sendMessage,
      setWorkspaceSetupIntent,
      setWorkspaceSetupState,
      workspaceSetupModel,
    ]
  )

  useEffect(() => {
    const trimmedPrompt = workspaceSetupIntent?.prompt?.trim()
    if (!isActive || !selectedProjectId || !workspaceSetupIntent?.autoSubmit || !trimmedPrompt) {
      autoSubmitKeyRef.current = null
      return
    }

    if (workspaceSetupState != null) {
      return
    }

    const autoSubmitKey = [
      selectedProjectId,
      trimmedPrompt,
    ].join("::")

    if (autoSubmitKeyRef.current === autoSubmitKey) {
      return
    }

    autoSubmitKeyRef.current = autoSubmitKey
    void submit(trimmedPrompt)
  }, [
    isActive,
    selectedProjectId,
    submit,
    workspaceSetupIntent,
    workspaceSetupState,
  ])

  return {
    isActive,
    input,
    setInput,
    submit,
    workspaceSetupState,
    cancel,
  }
}

export type { MessageWithParts, RuntimeSession as Session }
