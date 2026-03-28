import { useMemo, useRef, useState } from "react"
import {
  Bash,
  CaretDown,
  CaretRight,
  Compass,
  Globe,
  Image,
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
import { ChatTimelineItem } from "./ChatTimelineItem"
import { useViewportAnchorToggle } from "./useViewportAnchorToggle"
import type { MessageWithParts, RuntimeApprovalDisplayState } from "../types"

interface TurnStepsDropdownProps {
  messages: MessageWithParts[]
  childSessions?: Map<string, ChildSessionData>
  approvalStateByMessageId: Map<string, RuntimeApprovalDisplayState>
  className?: string
}

function getAggregateToolIcon(itemType?: string): Icon {
  switch (itemType) {
    case "commandExecution":
      return Bash
    case "fileChange":
      return PencilSimple
    case "webSearch":
      return Globe
    case "imageGeneration":
    case "imageView":
      return Image
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
  const messageCount = messages.filter((message) =>
    message.parts.every((part) => part.type !== "tool")
  ).length

  return `${messageCount} ${messageCount === 1 ? "message" : "messages"} · ${toolCount} ${toolCount === 1 ? "tool call" : "tool calls"}`
}

function getSummaryToolIcons(messages: MessageWithParts[]) {
  const seen = new Set<Icon>()
  const icons: Icon[] = []

  for (const message of messages) {
    const hasToolPart = message.parts.some((part) => part.type === "tool")
    if (!hasToolPart) {
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
}: TurnStepsDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const summary = useMemo(() => buildSummary(messages), [messages])
  const summaryToolIcons = useMemo(() => getSummaryToolIcons(messages), [messages])
  const buttonRef = useRef<HTMLButtonElement>(null)
  const preserveViewportOnToggle = useViewportAnchorToggle()

  return (
    <div className={cn("w-full", className)}>
      <MessageComponent from="assistant">
        <MessageContent>
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
            <span className="shrink-0 text-muted-foreground/70">
              {isOpen ? <CaretDown size={14} /> : <CaretRight size={14} />}
            </span>
            <span>{summary}</span>
            {!isOpen && summaryToolIcons.length > 0 ? (
              <span
                className="inline-flex items-center gap-1.5 text-muted-foreground/72"
                aria-label="Included tools"
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
          </button>

          {isOpen ? (
            <div className="mt-3 space-y-3 border-l border-border/60 pl-4">
              {messages.map((message) => (
                <ChatTimelineItem
                  key={message.info.id}
                  message={message}
                  childSessions={childSessions}
                  approvalState={approvalStateByMessageId.get(message.info.id) ?? null}
                  withinGroup
                />
              ))}
            </div>
          ) : null}
        </MessageContent>
      </MessageComponent>
    </div>
  )
}
