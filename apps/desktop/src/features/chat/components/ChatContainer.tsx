import { useEffect, useState } from "react"
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
  showInlineIntro,
}: {
  threadKey: string
  activeSessionId: string | null
  selectedProject: ReturnType<typeof useChatProjectState>["selectedProject"]
  showInlineIntro: boolean
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
      childSessions={childSessions}
      showInlineIntro={showInlineIntro}
    />
  )
}

function ChatComposerPane({
  activeSessionId,
  selectedProjectId,
  selectedWorktreePath,
  onTurnStarted,
}: {
  activeSessionId: string | null
  selectedProjectId: string | null
  selectedWorktreePath?: string | null
  onTurnStarted: () => void
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
    activeSessionId,
  })

  return (
    <ChatInput
      input={input}
      setInput={setInput}
      onSubmit={async (text, options) => {
        const didSubmit = await submit(text, options)
        if (didSubmit) {
          onTurnStarted()
        }
      }}
      prompt={activePrompt}
      onAnswerPrompt={answerPrompt}
      onDismissPrompt={dismissPrompt}
      onAbort={abort}
      onExecuteCommand={async (command, args) => {
        const didStart = await executeCommand(command, args)
        if (didStart) {
          onTurnStarted()
        }
      }}
      status={status}
    />
  )
}

export function ChatContainer() {
  const { selectedProject, selectedProjectId, selectedWorktree, activeSessionId } = useChatProjectState()
  const threadKey = `${selectedProjectId ?? selectedProject?.id ?? "no-project"}:${activeSessionId ?? "draft"}`
  const shouldShowDraftIntro = activeSessionId == null || activeSessionId.startsWith("draft-")
  const [showInlineIntro, setShowInlineIntro] = useState(shouldShowDraftIntro)

  useEffect(() => {
    setShowInlineIntro(shouldShowDraftIntro)
  }, [shouldShowDraftIntro, threadKey])

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 overflow-hidden">
        <ChatTimelinePane
          threadKey={threadKey}
          activeSessionId={activeSessionId}
          selectedProject={selectedProject}
          showInlineIntro={showInlineIntro}
        />
      </div>
      <div className="flex-shrink-0 flex justify-center">
        <div className="w-full max-w-[803px]">
          <ChatComposerPane
            activeSessionId={activeSessionId}
            selectedProjectId={selectedProjectId}
            selectedWorktreePath={selectedWorktree?.path ?? null}
            onTurnStarted={() => setShowInlineIntro(false)}
          />
        </div>
      </div>
    </div>
  )
}
