import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { useChatStore, type MessageWithParts, type ChildSessionState } from "../store"
import type { Project } from "@/features/workspace/types"
import type { RuntimeMessagePart, RuntimeTextPart, RuntimeToolPart } from "../types"
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "./ai-elements/conversation"
import {
  Message as MessageComponent,
  MessageContent,
  MessageResponse,
  MessageUserContent,
} from "./ai-elements/message"
import { Loader } from "./ai-elements/loader"
import { Streamdown } from "streamdown"
import { AgentActivitySDK } from "./agent-activity/AgentActivitySDK"
import type { ChildSessionData } from "./agent-activity/AgentActivitySubagent"
import { CaretDown, PencilSimple, Plus } from "@/components/icons"
import { Button } from "@/features/shared/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/features/shared/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/features/shared/components/ui/dialog"
import { useProjectStore } from "@/features/workspace/store"
import { getAgentAvatarUrl } from "@/features/workspace/utils/avatar"
import { AGENT_HEADER_BACKGROUNDS } from "@/features/workspace/utils/backgrounds"
import { getAgentDigestPath, readLatestAgentDigest } from "@/features/workspace/utils/digest"
import { openFolderPicker } from "@/features/workspace/utils/folderDialog"
import { useStickToBottomContext } from "use-stick-to-bottom"

interface ChatMessagesProps {
  messages: MessageWithParts[]
  status: "idle" | "streaming" | "error"
  selectedProject?: Project | null
  childSessions?: Map<string, ChildSessionState>
}

function StaticConversation({
  children,
  resetKey,
}: {
  children: ReactNode
  resetKey: string
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0
    }
  }, [resetKey])

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto overscroll-none [scrollbar-color:var(--color-muted-foreground)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-track]:bg-transparent"
    >
      {children}
    </div>
  )
}

/**
 * Extract text from message parts.
 */
function getMessageText(parts: RuntimeMessagePart[]): string {
  return parts
    .filter((p): p is RuntimeTextPart => p.type === "text")
    .map((p) => p.text)
    .join("")
}

/**
 * Get tool parts from message parts.
 */
function getToolParts(parts: RuntimeMessagePart[]): RuntimeToolPart[] {
  return parts.filter((p): p is RuntimeToolPart => p.type === "tool")
}

/**
 * Check if a message has any activity (tool calls, multiple content blocks, etc.)
 */
function hasActivity(parts: RuntimeMessagePart[]): boolean {
  return parts.some((p) => p.type === "tool")
}

/**
 * A group of messages - either a single user message or consecutive assistant messages.
 */
type MessageGroup =
  | { type: "user"; message: MessageWithParts }
  | { type: "assistant"; messages: MessageWithParts[] }

/**
 * Group consecutive assistant messages together.
 * Some harnesses create separate messages for each "step" (tool call),
 * but we want to render them in a single "Show steps" dropdown.
 */
function groupMessages(messages: MessageWithParts[]): MessageGroup[] {
  const groups: MessageGroup[] = []
  let currentAssistantGroup: MessageWithParts[] = []

  const flushAssistantGroup = () => {
    if (currentAssistantGroup.length > 0) {
      groups.push({ type: "assistant", messages: currentAssistantGroup })
      currentAssistantGroup = []
    }
  }

  for (const message of messages) {
    if (message.info.role === "user") {
      flushAssistantGroup()
      groups.push({ type: "user", message })
    } else {
      currentAssistantGroup.push(message)
    }
  }

  flushAssistantGroup()
  return groups
}

interface ChatEmptyStateProps {
  selectedProject?: Project | null
}

function ChatEmptyState({ selectedProject }: ChatEmptyStateProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isBackgroundDialogOpen, setIsBackgroundDialogOpen] = useState(false)
  const [digestMarkdown, setDigestMarkdown] = useState<string | null>(null)
  const [digestPath, setDigestPath] = useState<string | null>(null)
  const [digestError, setDigestError] = useState<string | null>(null)
  const { projects, selectProject, addProject, updateProjectBackground } = useProjectStore()
  const { getProjectChat } = useChatStore()

  const handleSelectProject = async (projectId: string) => {
    await selectProject(projectId)
    setIsOpen(false)
  }

  const handleAddProject = async () => {
    const folderPath = await openFolderPicker()
    if (!folderPath) {
      return
    }

    await addProject(folderPath)
    setIsOpen(false)
  }

  const handleBackgroundSelect = async (backgroundImageUrl: string) => {
    if (!selectedProject) {
      return
    }

    await updateProjectBackground(selectedProject.id, backgroundImageUrl)
    setIsBackgroundDialogOpen(false)
  }

  useEffect(() => {
    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null
    const selectedProjectPath = selectedProject?.path ?? null

    const loadDigest = async () => {
      if (!selectedProjectPath) {
        if (!cancelled) {
          setDigestMarkdown(null)
          setDigestPath(null)
          setDigestError(null)
        }
        return
      }

      const nextDigestPath = getAgentDigestPath(selectedProjectPath)
      setDigestPath(nextDigestPath)

      try {
        const latestDigest = await readLatestAgentDigest(selectedProjectPath)

        if (!cancelled) {
          setDigestMarkdown(latestDigest)
          setDigestPath(nextDigestPath)
          setDigestError(null)
        }
      } catch (error) {
        console.error("[ChatEmptyState] Failed to read agent digest:", error)
        if (!cancelled) {
          setDigestPath(nextDigestPath)
          setDigestError(error instanceof Error ? error.message : String(error))
        }
      }
    }

    void loadDigest()
    intervalId = setInterval(() => {
      void loadDigest()
    }, 5000)

    const handleWindowFocus = () => {
      void loadDigest()
    }

    window.addEventListener("focus", handleWindowFocus)

    return () => {
      cancelled = true
      if (intervalId) {
        clearInterval(intervalId)
      }
      window.removeEventListener("focus", handleWindowFocus)
    }
  }, [selectedProject?.path])

  const formatSessionTitle = (title: string | undefined, createdAt: number) => {
    if (title?.trim()) {
      return title
    }

    const date = new Date(createdAt)
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const projectChat = selectedProject ? getProjectChat(selectedProject.id) : null
  const recentSessions =
    projectChat?.sessions
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 3) ?? []
  const latestSession = recentSessions[0] ?? null
  const recentSessionTitles = recentSessions.map((session) =>
    formatSessionTitle(session.title, session.createdAt)
  )
  const hasRecentWork = recentSessions.length > 0

  return (
    <div className="flex min-h-[58vh] items-center justify-center px-4 py-8">
      <div className="w-full max-w-[860px] space-y-10 text-left">
        <section className="relative space-y-3 pb-2">
          <div className="group relative h-[182px] overflow-hidden rounded-[2rem] bg-muted">
            {selectedProject ? (
              <img
                src={selectedProject.backgroundImageUrl}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : null}
            <div className="absolute inset-0 bg-black/18" />
            <div className="absolute right-5 top-5">
              <Dialog open={isBackgroundDialogOpen} onOpenChange={setIsBackgroundDialogOpen}>
                <DialogTrigger
                  render={
                    <Button
                      variant="secondary"
                      className="h-11 rounded-2xl bg-background/88 px-4 text-foreground opacity-0 shadow-none transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-background"
                    />
                  }
                >
                  <PencilSimple size={16} />
                  <span>Edit cover</span>
                </DialogTrigger>
                <DialogContent className="max-w-[760px] rounded-[2rem] p-5" showCloseButton={false}>
                  <DialogHeader>
                    <DialogTitle>Choose a background</DialogTitle>
                    <DialogDescription>
                      Pick an Unsplash cover for this agent. Your selection is saved to the agent profile.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {AGENT_HEADER_BACKGROUNDS.map((background) => {
                      const isSelected = selectedProject?.backgroundImageUrl === background.imageUrl

                      return (
                        <button
                          key={background.id}
                          type="button"
                          onClick={() => void handleBackgroundSelect(background.imageUrl)}
                          className="group text-left"
                        >
                          <div
                            className={`overflow-hidden rounded-[1.4rem] border ${
                              isSelected ? "border-foreground/60" : "border-border/60"
                            }`}
                          >
                            <img
                              src={background.imageUrl}
                              alt={background.label}
                              className="h-32 w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                            />
                          </div>
                          <span className="mt-2 block text-[13px] text-foreground/86">
                            {background.label}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {selectedProject ? (
            <img
              src={getAgentAvatarUrl(selectedProject.avatarSeed)}
              alt=""
              className="absolute left-6 top-[112px] z-10 h-32 w-32 rounded-[28%] border-[5px] border-background object-cover shadow-[0_12px_40px_rgba(0,0,0,0.18)]"
            />
          ) : null}

          <div className="flex flex-col gap-5 sm:-mt-1 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-end gap-4 pl-[154px]">
              <div className="flex min-h-[52px] items-end pb-0">
                <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
                  <DropdownMenuTrigger className="inline-flex h-[52px] cursor-pointer items-center justify-center gap-2 align-middle text-[1.8rem] leading-none text-foreground outline-none transition-opacity hover:opacity-80 sm:text-[2.2rem]">
                    <span
                      className="block leading-none tracking-[-0.04em]"
                      style={{ fontFamily: "var(--font-pixel)" }}
                    >
                      {selectedProject?.name ?? "Select your agent"}
                    </span>
                    <CaretDown
                      size={18}
                      className={
                        isOpen
                          ? "shrink-0 self-center rotate-180 transition-transform"
                          : "shrink-0 self-center transition-transform"
                      }
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    sideOffset={12}
                    className="w-72 rounded-2xl border border-border/70 bg-card/95 p-2 shadow-lg backdrop-blur-sm"
                  >
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="px-2 py-2 text-sm font-medium text-muted-foreground">
                        Select your agent
                      </DropdownMenuLabel>
                      {projects.length > 0 ? (
                        projects.map((project) => {
                          const isSelected = project.id === selectedProject?.id

                          return (
                            <DropdownMenuItem
                              key={project.id}
                              onClick={() => void handleSelectProject(project.id)}
                              className="min-h-11 rounded-xl px-3 py-2 text-sm font-medium text-foreground"
                            >
                              <img
                                src={getAgentAvatarUrl(project.avatarSeed)}
                                alt=""
                                className="h-7 w-7 rounded-[28%] object-cover"
                              />
                              <span className="truncate">{project.name}</span>
                              {isSelected ? (
                                <span className="ml-auto text-sm text-foreground">✓</span>
                              ) : null}
                            </DropdownMenuItem>
                          )
                        })
                      ) : (
                        <div className="px-2 py-2 text-sm text-muted-foreground">No agents yet</div>
                      )}
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator className="my-2" />
                    <DropdownMenuItem
                      onClick={() => void handleAddProject()}
                      className="min-h-10 rounded-xl px-3 py-2 text-sm font-medium text-foreground"
                    >
                      <Plus size={14} className="text-muted-foreground" />
                      <span>Add new agent</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </section>

        <article className="space-y-5">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Recent Summary
          </p>
          {digestMarkdown ? (
            <div className="max-w-[68ch] text-[15px] leading-7 text-foreground/90">
              <Streamdown>{digestMarkdown}</Streamdown>
            </div>
          ) : (
            <div className="space-y-3 text-[14px] leading-7">
              <div className="grid gap-1 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-4">
                <span className="text-muted-foreground">Most recent action</span>
                <span className="text-foreground/88">
                  {!selectedProject
                    ? "No agent selected yet."
                    : latestSession
                      ? `Most recently, this agent worked in "${formatSessionTitle(latestSession.title, latestSession.createdAt)}".`
                      : "No work recorded yet for this agent."}
                </span>
              </div>
              <div className="grid gap-1 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-4">
                <span className="text-muted-foreground">Recent findings</span>
                <span className="text-foreground/88">
                  {!selectedProject
                    ? "Pick an agent from the selector above or create a new one."
                    : hasRecentWork
                      ? `Recent thread history points to ${recentSessionTitles
                          .slice(0, 3)
                          .map((title) => `"${title}"`)
                          .join(recentSessionTitles.length > 1 ? ", " : "")}.`
                      : "There are no findings yet because this agent has not started any threads."}
                </span>
              </div>
              <div className="grid gap-1 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-4">
                <span className="text-muted-foreground">Digest file</span>
                <span className="text-foreground/88">
                  {digestPath
                    ? digestError
                      ? `Could not read ${digestPath}. ${digestError}`
                      : `No digest found yet. The agent can write markdown to ${digestPath}.`
                    : "Pick an agent from the selector above or create a new one."}
                </span>
              </div>
            </div>
          )}
        </article>
      </div>
    </div>
  )
}

export function ChatMessages({ messages, status, selectedProject: _selectedProject, childSessions }: ChatMessagesProps) {
  const hasContent = messages.length > 0
  const groups = groupMessages(messages)

  // Convert ChildSessionState to ChildSessionData for the component
  const childSessionData: Map<string, ChildSessionData> | undefined = childSessions 
    ? new Map(
        Array.from(childSessions.entries()).map(([id, state]) => [
          id,
          {
            session: state.session,
            toolParts: state.toolParts,
            isActive: state.isActive,
          },
        ])
      )
    : undefined

  if (!hasContent) {
    return (
      <StaticConversation resetKey={_selectedProject?.id ?? "empty-chat"}>
        <div className="mx-auto w-full max-w-[803px] px-10 pb-10">
          <ChatEmptyState key={_selectedProject?.id ?? "empty-chat"} selectedProject={_selectedProject} />
        </div>
      </StaticConversation>
    )
  }

  return (
    <Conversation className="h-full">
      <ChatAutoScroll messages={messages} status={status} />
      <ConversationContent className="mx-auto w-full max-w-[803px] px-10 pb-10">
        <>
          {groups.map((group, groupIndex) => {
            const isLastGroup = groupIndex === groups.length - 1

            if (group.type === "user") {
              const text = getMessageText(group.message.parts)
              // Don't render empty user messages
              if (!text.trim()) {
                return null
              }
              return (
                <MessageComponent key={group.message.info.id} from="user">
                  <MessageContent>
                    <MessageUserContent>{text}</MessageUserContent>
                  </MessageContent>
                </MessageComponent>
              )
            }

            // Assistant message group - only pass child sessions to the last group
            const isStreaming = status === "streaming" && isLastGroup
            const groupKey = group.messages.map((m) => m.info.id).join("-")

            return (
              <AssistantMessageGroup
                key={groupKey}
                messages={group.messages}
                isStreaming={isStreaming}
                childSessions={isLastGroup ? childSessionData : undefined}
              />
            )
          })}
        </>
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  )
}

function ChatAutoScroll({
  messages,
  status,
}: {
  messages: MessageWithParts[]
  status: "idle" | "streaming" | "error"
}) {
  const { scrollToBottom } = useStickToBottomContext()
  const previousLastMessageIdRef = useRef<string | null>(null)
  const previousStatusRef = useRef<typeof status>(status)

  const lastMessage = messages[messages.length - 1] ?? null
  const lastMessageId = lastMessage?.info.id ?? null

  useEffect(() => {
    const previousLastMessageId = previousLastMessageIdRef.current
    const previousStatus = previousStatusRef.current
    const hasNewMessage = !!lastMessageId && lastMessageId !== previousLastMessageId
    const userJustSentMessage = hasNewMessage && lastMessage?.info.role === "user"
    const agentJustStartedResponding = status === "streaming" && previousStatus !== "streaming"

    if (userJustSentMessage || agentJustStartedResponding) {
      requestAnimationFrame(() => {
        void scrollToBottom("instant")
      })
    }

    previousLastMessageIdRef.current = lastMessageId
    previousStatusRef.current = status
  }, [lastMessage?.info.role, lastMessageId, scrollToBottom, status])

  return null
}

interface AssistantMessageGroupProps {
  messages: MessageWithParts[]
  isStreaming: boolean
  childSessions?: Map<string, ChildSessionData>
}

/**
 * Renders a group of assistant messages with a single AgentActivity dropdown
 * for all tool calls, plus the final response text.
 */
function AssistantMessageGroup({ messages, isStreaming, childSessions }: AssistantMessageGroupProps) {
  // Combine all parts from all messages in the group
  const allParts = messages.flatMap((m) => m.parts)
  
  // Get text from all messages (usually only the last one has final text)
  const text = getMessageText(allParts)
  const hasChildSessions = childSessions && childSessions.size > 0
  const showActivity = hasActivity(allParts) || isStreaming || hasChildSessions

  // Check if the last message in the group is finished
  const lastMessage = messages[messages.length - 1]
  const assistantInfo = lastMessage.info
  const showFinalText = !isStreaming && text && (!showActivity || assistantInfo.finishReason === "end_turn")

  return (
    <MessageComponent from="assistant">
      <MessageContent>
        {showActivity && (
          <AgentActivitySDK
            parts={allParts}
            isStreaming={isStreaming}
            childSessions={childSessions}
            className="mb-6"
          />
        )}

        {showFinalText ? (
          <MessageResponse isStreaming={isStreaming} className="leading-relaxed [&>p]:mb-4">{text}</MessageResponse>
        ) : (
          isStreaming && !text && !showActivity && <Loader className="mt-2" />
        )}
      </MessageContent>
    </MessageComponent>
  )
}
