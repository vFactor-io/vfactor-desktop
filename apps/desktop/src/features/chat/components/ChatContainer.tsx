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
  const threadKey = `${selectedWorktreeId ?? selectedProject?.id ?? "no-project"}:${activeSessionId ?? "draft"}`

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
      <div className="flex-shrink-0 flex justify-center">
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
