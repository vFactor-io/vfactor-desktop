import { useEffect, useRef, useState } from "react"
import { GitBranch } from "@/components/icons"
import { ProjectIcon } from "@/features/workspace/components/ProjectIcon"
import {
  useChatComposerState,
  useChatProjectState,
  useChatTimelineState,
} from "../hooks/useChat"
import { ChatMessages } from "./ChatMessages"
import { ChatInput } from "./ChatInput"

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
  const { messages, childSessions, status, activePromptState } =
    useChatTimelineState(activeSessionId)

  return (
    <ChatMessages
      threadKey={threadKey}
      messages={messages}
      status={status}
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
}: {
  activeSessionId: string | null
  selectedProjectId: string | null
  selectedWorktreePath?: string | null
  selectedWorktreeId: string | null
  selectedWorktree: ReturnType<typeof useChatProjectState>["selectedWorktree"]
}) {
  const {
    input,
    setInput,
    status,
    activePrompt,
    answerPrompt,
    dismissPrompt,
    abort,
    executeCommand,
    submit,
  } = useChatComposerState({
    selectedProjectId,
    selectedWorktreePath,
    selectedWorktreeId,
    selectedWorktree,
    activeSessionId,
  })

  return (
    <ChatInput
      input={input}
      setInput={setInput}
      onSubmit={async (text, options) => {
        await submit(text, options)
      }}
      prompt={activePrompt}
      onAnswerPrompt={answerPrompt}
      onDismissPrompt={dismissPrompt}
      onAbort={abort}
      onExecuteCommand={async (command, args) => {
        await executeCommand(command, args)
      }}
      status={status}
    />
  )
}

export function ChatContainer() {
  const {
    selectedProject,
    selectedProjectId,
    selectedWorktreeId,
    selectedWorktree,
    activeSessionId,
  } = useChatProjectState()
  const { messages } = useChatTimelineState(activeSessionId)
  const threadKey = `${selectedWorktreeId ?? selectedProject?.id ?? "no-project"}:${activeSessionId ?? "draft"}`
  const hasContent = messages.length > 0
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
    const projectName = selectedProject?.name ?? null
    const branchName = selectedWorktree?.branchName ?? null

    return (
      <div className="h-full flex flex-col items-center justify-center">
        <div
          className={`w-full max-w-[803px] flex flex-col gap-4 ${transition === "rise" ? "animate-composer-rise" : ""}`}
          onAnimationEnd={() => setTransition(null)}
        >
          {projectName ? (
            <div className="flex items-center gap-3.5 px-10">
              <ProjectIcon project={selectedProject} size={36} />
              <div className="flex flex-col gap-0.5">
                <h3 className="text-sm font-medium text-foreground/90">
                  {projectName}
                </h3>
                {branchName ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/70">
                    <GitBranch size={12} />
                    <span className="font-mono">{branchName}</span>
                  </span>
                ) : null}
              </div>
            </div>
          ) : (
            <h3 className="text-sm font-medium text-foreground/90 px-10">New chat</h3>
          )}
          <ChatComposerPane
            activeSessionId={activeSessionId}
            selectedProjectId={selectedProjectId}
            selectedWorktreePath={selectedWorktree?.path ?? null}
            selectedWorktreeId={selectedWorktreeId}
            selectedWorktree={selectedWorktree}
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
          activeSessionId={activeSessionId}
          selectedProject={selectedProject}
          selectedWorktree={selectedWorktree}
        />
      </div>
      <div
        className={`flex-shrink-0 flex justify-center ${transition === "settle" ? "animate-composer-settle" : ""}`}
        onAnimationEnd={() => setTransition(null)}
      >
        <div className="w-full max-w-[803px]">
          <ChatComposerPane
            activeSessionId={activeSessionId}
            selectedProjectId={selectedProjectId}
            selectedWorktreePath={selectedWorktree?.path ?? null}
            selectedWorktreeId={selectedWorktreeId}
            selectedWorktree={selectedWorktree}
          />
        </div>
      </div>
    </div>
  )
}
