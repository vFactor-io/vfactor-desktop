import { useState, useCallback, useEffect, useMemo } from "react"
import { useShallow } from "zustand/react/shallow"
import { useProjectStore } from "@/features/workspace/store"
import type { Project } from "@/features/workspace/types"
import { useChatStore, type ChildSessionState, type MessageWithParts } from "../store"
import { hasProjectChatSession } from "../store/sessionState"
import type { ProjectChatState } from "../store/storeTypes"
import type {
  ChatStatus,
  CollaborationModeKind,
  RuntimePrompt,
  RuntimePromptResponse,
  RuntimePromptState,
  RuntimeSession,
} from "../types"

const EMPTY_MESSAGES: MessageWithParts[] = []

function getActiveSessionId(projectChat: ProjectChatState | null): string | null {
  if (!projectChat) {
    return null
  }

  return hasProjectChatSession(projectChat, projectChat.activeSessionId)
    ? projectChat.activeSessionId
    : null
}

function getUiStatus(status: ChatStatus | "connecting"): ChatStatus {
  return status === "connecting" ? "idle" : status
}

export function useChatProjectState(): {
  selectedProjectId: string | null
  selectedProject: Project | null
  activeSessionId: string | null
} {
  const { projects, selectedProjectId } = useProjectStore(
    useShallow((state) => ({
      projects: state.projects,
      selectedProjectId: state.selectedProjectId,
    }))
  )
  const { initialize, isInitialized, loadSessionsForProject } = useChatStore(
    useShallow((state) => ({
      initialize: state.initialize,
      isInitialized: state.isInitialized,
      loadSessionsForProject: state.loadSessionsForProject,
    }))
  )
  const projectChat = useChatStore((state) =>
    selectedProjectId ? state.chatByProject[selectedProjectId] ?? null : null
  )

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  )
  const activeSessionId = getActiveSessionId(projectChat)

  useEffect(() => {
    initialize()
  }, [initialize])

  useEffect(() => {
    if (selectedProjectId && selectedProject?.path && isInitialized) {
      loadSessionsForProject(selectedProjectId, selectedProject.path)
    }
  }, [selectedProjectId, selectedProject?.path, isInitialized, loadSessionsForProject])

  return {
    selectedProjectId,
    selectedProject,
    activeSessionId,
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
  const status = useChatStore((state) => state.status)
  const activePromptState = useChatStore((state) =>
    activeSessionId ? state.activePromptBySession[activeSessionId] ?? null : null
  )

  const isResolvedActiveSession = activeSessionId != null && currentSessionId === activeSessionId

  return {
    messages: isResolvedActiveSession ? messages : EMPTY_MESSAGES,
    childSessions: isResolvedActiveSession ? childSessions : undefined,
    status: isResolvedActiveSession ? getUiStatus(status) : "idle",
    activePromptState: isResolvedActiveSession ? activePromptState : null,
  }
}

export function useChatComposerState({
  selectedProjectId,
  selectedProjectPath,
  activeSessionId,
}: {
  selectedProjectId: string | null
  selectedProjectPath?: string | null
  activeSessionId: string | null
}): {
  input: string
  setInput: (value: string) => void
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
    }
  ) => Promise<boolean>
} {
  const [draftInputsBySessionKey, setDraftInputsBySessionKey] = useState<Record<string, string>>({})
  const {
    currentSessionId,
    status,
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
      currentSessionId: state.currentSessionId,
      status: state.status,
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
    activeSessionId ?? (selectedProjectId ? `draft:${selectedProjectId}` : "draft:no-project")
  const input = draftInputsBySessionKey[draftSessionKey] ?? ""
  const activePromptState: RuntimePromptState | null =
    activeSessionId ? activePromptBySession[activeSessionId] ?? null : null
  const activePrompt = activePromptState?.status === "active" ? activePromptState.prompt : null
  const isResolvedActiveSession = activeSessionId != null && currentSessionId === activeSessionId
  const uiStatus = isResolvedActiveSession ? getUiStatus(status) : "idle"

  const setInput = useCallback(
    (value: string) => {
      setDraftInputsBySessionKey((current) => ({
        ...current,
        [draftSessionKey]: value,
      }))
    },
    [draftSessionKey]
  )

  const clearDraftInput = useCallback((sessionKey: string) => {
    setDraftInputsBySessionKey((current) => {
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
      }
    ) => {
      if (!text.trim() || uiStatus === "streaming") {
        return false
      }

      let targetSessionId = activeSessionId

      if (!targetSessionId) {
        if (!selectedProjectId || !selectedProjectPath) {
          return false
        }

        setInput("")

        const session = createOptimisticSession(selectedProjectId, selectedProjectPath)
        if (!session) {
          return false
        }

        targetSessionId = session.id
      }

      clearDraftInput(targetSessionId)
      await sendMessage(targetSessionId, text, options)
      return true
    },
    [
      activeSessionId,
      clearDraftInput,
      createOptimisticSession,
      selectedProjectId,
      selectedProjectPath,
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
        if (!selectedProjectId || !selectedProjectPath) {
          return false
        }

        const session = await createSession(selectedProjectId, selectedProjectPath)
        if (!session) {
          return false
        }

        targetSessionId = session.id
      }

      await executeCommand(targetSessionId, command, args)
      return true
    },
    [
      activeSessionId,
      createSession,
      executeCommand,
      selectedProjectId,
      selectedProjectPath,
    ]
  )

  return {
    input,
    setInput,
    status: uiStatus,
    activePrompt,
    answerPrompt: handleAnswerPrompt,
    dismissPrompt: handleDismissPrompt,
    abort,
    executeCommand: handleExecuteCommand,
    submit,
  }
}

export type { MessageWithParts, RuntimeSession as Session }
