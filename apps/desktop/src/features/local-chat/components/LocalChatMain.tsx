import { useEffect, useMemo, useCallback } from "react"
import { ChatContainer } from "@/features/chat/components"
import { useChatStore } from "@/features/chat/store"
import type { RuntimeModeKind } from "@/features/chat/types"
import { useLocalChatStore } from "../store"
import type { ChatWorkspaceRef, LocalChatThread } from "../types"

const LOCAL_CHAT_DEFAULT_RUNTIME_MODE = "auto-accept-edits" satisfies RuntimeModeKind

function buildWorkspaceRef(thread: LocalChatThread | null): ChatWorkspaceRef | null {
  if (!thread) {
    return null
  }

  return {
    kind: "local",
    id: thread.id,
    path: thread.path,
    title: thread.title,
    artifactsPath: thread.artifactsPath,
  }
}

export function LocalChatMain() {
  const {
    threads,
    activeThreadId,
    initialize,
    createThread,
    setThreadActiveSession,
  } = useLocalChatStore()

  useEffect(() => {
    void initialize()
  }, [initialize])

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? null,
    [activeThreadId, threads]
  )
  const workspaceRef = useMemo(() => buildWorkspaceRef(activeThread), [activeThread])
  const activeChatSessionId = useChatStore((state) =>
    activeThread?.id ? state.chatByWorktree[activeThread.id]?.activeSessionId ?? null : null
  )

  useEffect(() => {
    if (!activeThread || !activeChatSessionId || activeThread.activeSessionId === activeChatSessionId) {
      return
    }

    void setThreadActiveSession(activeThread.id, activeChatSessionId)
  }, [activeChatSessionId, activeThread, setThreadActiveSession])

  const ensureWorkspace = useCallback(
    async ({ prompt }: { prompt: string }) => {
      const thread = activeThread ?? (await createThread({ prompt }))
      return buildWorkspaceRef(thread)
    },
    [activeThread, createThread]
  )

  return (
    <main className="chat-main-surface flex-1 min-w-80 text-main-content-foreground overflow-hidden flex flex-col">
      <ChatContainer
        sessionId={activeThread?.activeSessionId ?? null}
        workspaceRef={workspaceRef}
        ensureWorkspace={async (input) => {
          const nextWorkspace = await ensureWorkspace(input)
          if (nextWorkspace?.id) {
            await setThreadActiveSession(nextWorkspace.id, null)
          }
          return nextWorkspace
        }}
        defaultRuntimeMode={LOCAL_CHAT_DEFAULT_RUNTIME_MODE}
        hideDevCommands
      />
    </main>
  )
}
