/**
 * AgentActivitySDK - Agent activity component for runtime message parts.
 *
 * Renders all intermediate activity (text, tool calls, subagents) inline.
 * Groups tools tightly together, with more spacing before text messages.
 */

import { cn } from "@/lib/utils"
import type { RuntimeMessagePart, RuntimeTextPart, RuntimeToolPart } from "../../types"

import { AgentActivityToolSDK } from "./AgentActivityToolSDK"
import { AgentActivityText } from "./AgentActivityText"
import { AgentActivitySubagent, type ChildSessionData } from "./AgentActivitySubagent"

interface AgentActivitySDKProps {
  /** Message parts from the selected harness */
  parts: RuntimeMessagePart[]
  /** Whether the message is still streaming */
  isStreaming: boolean
  /** Child sessions (subagents) to display */
  childSessions?: Map<string, ChildSessionData>
  className?: string
}

type RenderedItem = {
  type: "text" | "tool" | "subagent"
  node: React.ReactNode
}

export function AgentActivitySDK({
  parts,
  isStreaming,
  childSessions,
  className,
}: AgentActivitySDKProps) {
  // Debug: log child sessions
  if (childSessions && childSessions.size > 0) {
    console.log("[AgentActivitySDK] childSessions:", childSessions.size, Array.from(childSessions.keys()))
  }

  // Build rendered items with type info for spacing logic
  const renderedItems: RenderedItem[] = []
  let currentTextGroup: string[] = []

  // Render child sessions (subagents) first at the top
  if (childSessions && childSessions.size > 0) {
    for (const [sessionId, childData] of childSessions) {
      renderedItems.push({
        type: "subagent",
        node: (
          <AgentActivitySubagent
            key={`subagent-${sessionId}`}
            childSession={childData}
          />
        ),
      })
    }
  }

  const flushTextGroup = (isLastGroup: boolean = false) => {
    if (currentTextGroup.length > 0) {
      const text = currentTextGroup.join("")
      if (text.trim()) {
        renderedItems.push({
          type: "text",
          node: (
            <AgentActivityText
              key={`text-${renderedItems.length}`}
              text={text}
              isStreaming={isStreaming && isLastGroup}
            />
          ),
        })
      }
      currentTextGroup = []
    }
  }

  for (const part of parts) {
    if (part.type === "text") {
      currentTextGroup.push((part as RuntimeTextPart).text)
    } else if (part.type === "tool") {
      flushTextGroup(false)
      const toolPart = part as RuntimeToolPart
      
      // Skip task tools since we render child sessions separately
      if (toolPart.tool === "mcp_task" || toolPart.tool === "task") {
        continue
      }
      
      renderedItems.push({
        type: "tool",
        node: (
          <AgentActivityToolSDK
            key={`tool-${part.id}`}
            toolPart={toolPart}
          />
        ),
      })
    }
  }
  flushTextGroup(true)

  if (renderedItems.length === 0) {
    return null
  }

  return (
    <div className={cn("flex flex-col", className)}>
      {renderedItems.map((item, index) => {
        const prevItem = index > 0 ? renderedItems[index - 1] : null
        
        // Determine spacing based on transition
        // - Text after anything (except first): large gap
        // - Tool/subagent after tool/subagent: tight gap
        // - Tool after text: medium gap
        let spacingClass = ""
        if (index > 0) {
          if (item.type === "text") {
            spacingClass = "mt-8"
          } else if ((item.type === "tool" || item.type === "subagent") && 
                     (prevItem?.type === "tool" || prevItem?.type === "subagent")) {
            spacingClass = "mt-3"
          } else {
            spacingClass = "mt-4"
          }
        }

        return (
          <div key={index} className={spacingClass}>
            {item.node}
          </div>
        )
      })}
    </div>
  )
}
