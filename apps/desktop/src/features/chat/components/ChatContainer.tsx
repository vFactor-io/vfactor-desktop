import { memo, useEffect, useRef, useState } from "react"
import { GitBranch } from "@/components/icons"
import { ProjectIcon } from "@/features/workspace/components/ProjectIcon"
import type { ChatWorkspaceRef } from "@/features/local-chat/types"
import {
  useChatHasContent,
  useChatComposerState,
  useChatProjectState,
  useChatTimelineState,
} from "../hooks/useChat"
import { useChatStore } from "../store"
import { ChatMessages } from "./ChatMessages"
import { ChatInput } from "./ChatInput"
import { resolveChatContainerSessionId } from "./chatContainerSession"
import type { RuntimeModeKind } from "../types"

function ChatTimelinePane({
  threadKey,
  activeSessionId,
  selectedProject,
  selectedWorktree,
}: {
  threadKey: string
  activeSessionId: string | null
  selectedProject: ReturnType<typeof useChatProjectState>["selectedProject"]
  selectedWorktree: ReturnType<typeof useChatProjectState>["selectedWorktree"]
}) {
  const { messages, childSessions, status, workStartedAt, activePromptState } =
    useChatTimelineState(activeSessionId)

  return (
    <ChatMessages
      threadKey={threadKey}
      messages={messages}
      status={status}
      workStartedAt={workStartedAt}
      activePromptState={activePromptState}
      selectedProject={selectedProject}
      selectedWorktree={selectedWorktree}
      childSessions={childSessions}
    />
  )
}

function ChatComposerPane({
  activeSessionId,
  selectedProjectId,
  selectedWorktreePath,
  selectedWorktreeId,
  selectedWorktree,
  workspaceRef,
  ensureWorkspace,
  defaultRuntimeMode,
  hideDevCommands,
}: {
  activeSessionId: string | null
  selectedProjectId: string | null
  selectedWorktreePath?: string | null
  selectedWorktreeId: string | null
  selectedWorktree: ReturnType<typeof useChatProjectState>["selectedWorktree"]
  workspaceRef?: ChatWorkspaceRef | null
  ensureWorkspace?: (input: { prompt: string }) => Promise<ChatWorkspaceRef | null>
  defaultRuntimeMode?: RuntimeModeKind
  hideDevCommands?: boolean
}) {
  const {
    input,
    setInput,
    attachments,
    setAttachments,
    queuedMessages,
    status,
    activePrompt,
    answerPrompt,
    dismissPrompt,
    abort,
    removeQueuedMessage,
    editQueuedMessage,
    executeCommand,
    submit,
  } = useChatComposerState({
    selectedProjectId,
    selectedWorktreePath,
    selectedWorktreeId,
    selectedWorktree,
    activeSessionId,
    workspaceRef,
    ensureWorkspace,
    defaultRuntimeMode,
  })
  const effectiveWorkspaceId = workspaceRef?.id ?? selectedWorktreeId
  const effectiveWorkspacePath = workspaceRef?.path ?? selectedWorktreePath
  const projectChat = useChatStore((state) =>
    effectiveWorkspaceId ? state.chatByWorktree[effectiveWorkspaceId] ?? null : null
  )

  return (
    <ChatInput
      sessionId={activeSessionId}
      workspaceId={effectiveWorkspaceId}
      workspacePath={effectiveWorkspacePath}
      projectChat={projectChat}
      defaultRuntimeMode={defaultRuntimeMode}
      hideDevCommands={hideDevCommands}
      input={input}
      setInput={setInput}
      attachments={attachments}
      setAttachments={setAttachments}
      queuedMessages={queuedMessages}
      onSubmit={async (text, options) => {
        await submit(text, options)
      }}
      prompt={activePrompt}
      onAnswerPrompt={answerPrompt}
      onDismissPrompt={dismissPrompt}
      onAbort={abort}
      onRemoveQueuedMessage={removeQueuedMessage}
      onEditQueuedMessage={editQueuedMessage}
      onExecuteCommand={async (command, args) => {
        await executeCommand(command, args)
      }}
      status={status}
    />
  )
}

const MemoizedChatComposerPane = memo(
  ChatComposerPane,
  (previousProps, nextProps) =>
    previousProps.activeSessionId === nextProps.activeSessionId &&
    previousProps.selectedProjectId === nextProps.selectedProjectId &&
    previousProps.selectedWorktreeId === nextProps.selectedWorktreeId &&
    previousProps.selectedWorktreePath === nextProps.selectedWorktreePath &&
    previousProps.workspaceRef?.id === nextProps.workspaceRef?.id &&
    previousProps.workspaceRef?.path === nextProps.workspaceRef?.path &&
    previousProps.selectedWorktree?.id === nextProps.selectedWorktree?.id &&
    previousProps.selectedWorktree?.path === nextProps.selectedWorktree?.path &&
    previousProps.selectedWorktree?.branchName === nextProps.selectedWorktree?.branchName
)

export function ChatContainer({
  sessionId = null,
  workspaceRef = null,
  ensureWorkspace,
  defaultRuntimeMode,
  hideDevCommands = false,
}: ChatContainerContentProps) {
  return (
    <ChatContainerContent
      sessionId={sessionId}
      workspaceRef={workspaceRef}
      ensureWorkspace={ensureWorkspace}
      defaultRuntimeMode={defaultRuntimeMode}
      hideDevCommands={hideDevCommands}
    />
  )
}

interface ChatContainerContentProps {
  sessionId?: string | null
  workspaceRef?: ChatWorkspaceRef | null
  ensureWorkspace?: (input: { prompt: string }) => Promise<ChatWorkspaceRef | null>
  defaultRuntimeMode?: RuntimeModeKind
  hideDevCommands?: boolean
}

export function ChatContainerContent({
  sessionId = null,
  workspaceRef = null,
  ensureWorkspace,
  defaultRuntimeMode,
  hideDevCommands = false,
}: ChatContainerContentProps) {
  const {
    selectedProject,
    selectedProjectId,
    selectedWorktreeId,
    selectedWorktree,
    activeSessionId,
  } = useChatProjectState(workspaceRef)
  const effectiveWorkspaceId = workspaceRef?.id ?? selectedWorktreeId
  const projectChat = useChatStore((state) =>
    effectiveWorkspaceId ? state.chatByWorktree[effectiveWorkspaceId] ?? null : null
  )
  const resolvedSessionId = resolveChatContainerSessionId(projectChat, sessionId, activeSessionId)
  const hasContent = useChatHasContent(resolvedSessionId)
  const threadKey = `${effectiveWorkspaceId ?? selectedProject?.id ?? "no-project"}:${resolvedSessionId ?? "draft"}`
  const prevHasContentRef = useRef(hasContent)
  const [transition, setTransition] = useState<"settle" | "rise" | null>(null)

  useEffect(() => {
    if (!prevHasContentRef.current && hasContent) {
      setTransition("settle")
    } else if (prevHasContentRef.current && !hasContent) {
      setTransition("rise")
    }
    prevHasContentRef.current = hasContent
  }, [hasContent])

  if (!hasContent) {
    const projectName = workspaceRef?.title ?? selectedProject?.name ?? null
    const branchName = selectedWorktree?.branchName ?? null

    return (
      <div className="h-full flex flex-col items-center justify-center">
        <div
          className={`w-full max-w-[784px] flex flex-col gap-4 ${transition === "rise" ? "animate-composer-rise" : ""}`}
          onAnimationEnd={() => setTransition(null)}
        >
          {projectName ? (
            <div className="flex items-center gap-3.5 px-6">
              {selectedProject ? <ProjectIcon project={selectedProject} size={36} /> : null}
              <div className="flex flex-col gap-0.5">
                <h3 className="text-sm font-medium text-foreground/90">
                  {projectName}
                </h3>
                {branchName && workspaceRef?.kind !== "local" ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/70">
                    <GitBranch size={12} />
                    <span className="font-mono">{branchName}</span>
                  </span>
                ) : null}
              </div>
            </div>
          ) : (
            <h3 className="text-sm font-medium text-foreground/90 px-6">New chat</h3>
          )}
          <MemoizedChatComposerPane
            activeSessionId={resolvedSessionId}
            selectedProjectId={selectedProjectId}
            selectedWorktreePath={selectedWorktree?.path ?? null}
            selectedWorktreeId={effectiveWorkspaceId}
            selectedWorktree={selectedWorktree}
            workspaceRef={workspaceRef}
            ensureWorkspace={ensureWorkspace}
            defaultRuntimeMode={defaultRuntimeMode}
            hideDevCommands={hideDevCommands}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 overflow-hidden">
        <ChatTimelinePane
          threadKey={threadKey}
          activeSessionId={resolvedSessionId}
          selectedProject={selectedProject}
          selectedWorktree={selectedWorktree}
        />
      </div>
      <div
        className={`flex-shrink-0 flex justify-center ${transition === "settle" ? "animate-composer-settle" : ""}`}
        onAnimationEnd={() => setTransition(null)}
      >
        <div className="w-full max-w-[784px]">
          <MemoizedChatComposerPane
            activeSessionId={resolvedSessionId}
            selectedProjectId={selectedProjectId}
            selectedWorktreePath={selectedWorktree?.path ?? null}
            selectedWorktreeId={effectiveWorkspaceId}
            selectedWorktree={selectedWorktree}
            workspaceRef={workspaceRef}
            ensureWorkspace={ensureWorkspace}
            defaultRuntimeMode={defaultRuntimeMode}
            hideDevCommands={hideDevCommands}
          />
        </div>
      </div>
    </div>
  )
}
