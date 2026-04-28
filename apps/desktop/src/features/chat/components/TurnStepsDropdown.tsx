import { useMemo, useRef, useState } from "react"
import {
  Bash,
  Brain,
  CaretDown,
  CaretRight,
  Compass,
  Globe,
  PencilSimple,
  Robot,
  Zap,
  type Icon,
} from "@/components/icons"
import { cn } from "@/lib/utils"
import type { ChildSessionData } from "./agent-activity/AgentActivitySubagent"
import {
  Message as MessageComponent,
  MessageContent,
} from "./ai-elements/message"
import {
  ChatTimelineItem,
  type ChatImagePreviewRequest,
} from "./ChatTimelineItem"
import { useViewportAnchorToggle } from "./useViewportAnchorToggle"
import type { MessageWithParts, RuntimeApprovalDisplayState } from "../types"

interface TurnStepsDropdownProps {
  messages: MessageWithParts[]
  childSessions?: Map<string, ChildSessionData>
  approvalStateByMessageId: Map<string, RuntimeApprovalDisplayState>
  className?: string
  summary?: string
  defaultOpen?: boolean
  worktreePath?: string | null
  onOpenImagePreview?: (preview: ChatImagePreviewRequest) => void
}

function getAggregateToolIcon(itemType?: string): Icon {
  switch (itemType) {
    case "reasoning":
      return Brain
    case "commandExecution":
      return Bash
    case "fileChange":
      return PencilSimple
    case "webSearch":
      return Globe
    case "collabAgentToolCall":
      return Robot
    case "mcpToolCall":
    case "dynamicToolCall":
      return Compass
    case "contextCompaction":
    default:
      return Zap
  }
}

function buildSummary(messages: MessageWithParts[]): string {
  const toolCount = messages.filter((message) =>
    message.parts.some((part) => part.type === "tool")
  ).length
  const thoughtCount = messages.filter(
    (message) => message.info.itemType === "reasoning"
  ).length
  const messageCount = messages.filter((message) =>
    message.info.itemType !== "reasoning" &&
    message.parts.every((part) => part.type !== "tool")
  ).length

  const parts: string[] = []
  if (thoughtCount > 0) {
    parts.push(`${thoughtCount} ${thoughtCount === 1 ? "thought" : "thoughts"}`)
  }
  if (messageCount > 0) {
    parts.push(`${messageCount} ${messageCount === 1 ? "message" : "messages"}`)
  }
  if (toolCount > 0) {
    parts.push(`${toolCount} ${toolCount === 1 ? "tool call" : "tool calls"}`)
  }

  return parts.join(" · ") || "No activity"
}

function getSummaryToolIcons(messages: MessageWithParts[]) {
  const seen = new Set<Icon>()
  const icons: Icon[] = []

  for (const message of messages) {
    const hasToolPart = message.parts.some((part) => part.type === "tool")
    const isThought = message.info.itemType === "reasoning"

    if (!hasToolPart && !isThought) {
      continue
    }

    const icon = getAggregateToolIcon(message.info.itemType)
    if (seen.has(icon)) {
      continue
    }

    seen.add(icon)
    icons.push(icon)
  }

  return icons
}

export function TurnStepsDropdown({
  messages,
  childSessions,
  approvalStateByMessageId,
  className,
  summary: summaryOverride,
  defaultOpen = false,
  worktreePath,
  onOpenImagePreview,
}: TurnStepsDropdownProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const summary = useMemo(
    () => summaryOverride ?? buildSummary(messages),
    [messages, summaryOverride]
  )
  const summaryToolIcons = useMemo(() => getSummaryToolIcons(messages), [messages])
  const buttonRef = useRef<HTMLButtonElement>(null)
  const preserveViewportOnToggle = useViewportAnchorToggle()

  return (
    <div className={cn("w-full", className)}>
      <MessageComponent from="assistant">
        <MessageContent className="gap-0">
          <button
            ref={buttonRef}
            type="button"
            onClick={() =>
              preserveViewportOnToggle(buttonRef.current, () => {
                setIsOpen((v) => !v)
              })}
            className="inline-flex items-center gap-2 text-left text-sm leading-5 text-muted-foreground hover:text-foreground/80"
            aria-expanded={isOpen}
          >
            <span>{summary}</span>
            {!isOpen && summaryToolIcons.length > 0 ? (
              <span
                className="inline-flex items-center gap-1.5 text-[var(--color-chat-file-accent)]"
                aria-label="Included activity types"
              >
                {summaryToolIcons.map((IconComponent, index) => (
                  <IconComponent
                    key={`${IconComponent.displayName ?? IconComponent.name ?? "tool"}-${index}`}
                    size={13}
                    className="shrink-0"
                  />
                ))}
              </span>
            ) : null}
            <span className="shrink-0 text-muted-foreground/70">
              {isOpen ? <CaretDown size={14} /> : <CaretRight size={14} />}
            </span>
          </button>

          {isOpen ? (
            <div className="mt-5 space-y-3">
              {messages.map((message) => (
                <ChatTimelineItem
                  key={message.info.id}
                  message={message}
                  childSessions={childSessions}
                  approvalState={approvalStateByMessageId.get(message.info.id) ?? null}
                  withinGroup
                  worktreePath={worktreePath}
                  onOpenImagePreview={onOpenImagePreview}
                />
              ))}
            </div>
          ) : null}
        </MessageContent>
      </MessageComponent>
    </div>
  )
}
