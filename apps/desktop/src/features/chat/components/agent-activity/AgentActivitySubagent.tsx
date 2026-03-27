/**
 * AgentActivitySubagent - Displays inline subagent activity.
 *
 * Shows:
 * - Robot icon with "Agent" label and agent name
 * - Description of what the subagent is doing
 * - Collapsible list of tool calls from the child session
 */

import { useState } from "react"
import {
  Robot,
  CaretDown,
  CaretRight,
  CircleNotch,
  CheckCircle,
} from "@/components/icons"
import { cn } from "@/lib/utils"
import { AgentActivityToolSDK } from "./AgentActivityToolSDK"
import type { RuntimeToolPart, RuntimeSession } from "../../types"

export interface ChildSessionData {
  session: RuntimeSession
  toolParts: RuntimeToolPart[]
  isActive: boolean
}

interface AgentActivitySubagentProps {
  /** Child session data */
  childSession: ChildSessionData
  className?: string
}

/**
 * Format agent name for display (capitalize, remove prefixes).
 */
function formatAgentName(title: string | undefined): string {
  if (!title) return "Subagent"
  
  // Extract agent name from title like "Explore app routing (@explore subagent)"
  const match = title.match(/@(\w+)\s+subagent/i)
  if (match) {
    const name = match[1]
    return name.charAt(0).toUpperCase() + name.slice(1)
  }
  
  // Fallback: use first part of title
  const firstWord = title.split(" ")[0]
  return firstWord.charAt(0).toUpperCase() + firstWord.slice(1)
}

/**
 * Extract description from session title.
 */
function getDescription(title: string | undefined): string {
  if (!title) return "Running subagent task..."
  
  // Remove the (@agent subagent) suffix
  const cleaned = title.replace(/\s*\(@\w+\s+subagent\)/i, "").trim()
  return cleaned || "Running subagent task..."
}

export function AgentActivitySubagent({
  childSession,
  className,
}: AgentActivitySubagentProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  
  const { session, toolParts, isActive } = childSession
  const agentName = formatAgentName(session.title)
  const description = getDescription(session.title)
  const hasTools = toolParts.length > 0

  return (
    <div className={cn("w-full rounded-lg border border-border bg-card overflow-hidden", className)}>
      {/* Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-muted/50 transition-colors"
      >
        {/* Expand/collapse icon */}
        {isExpanded ? (
          <CaretDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <CaretRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}

        {/* Robot icon */}
        <Robot className="size-4 shrink-0 text-primary" />

        {/* Agent label */}
        <span className="text-sm font-medium">
          Agent <span className="text-primary">{agentName}</span>
        </span>

        {/* Description */}
        <span className="text-sm text-muted-foreground truncate flex-1">
          {description}
        </span>

        {/* Status indicator */}
        {isActive ? (
          <CircleNotch className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <CheckCircle className="size-3.5 shrink-0 text-green-500" />
        )}
      </button>

      {/* Expanded content - tool calls */}
      {isExpanded && hasTools && (
        <div className="px-3 pb-3 space-y-2 border-t border-border pt-2 ml-5">
          {toolParts.map((toolPart) => (
            <AgentActivityToolSDK
              key={toolPart.id}
              toolPart={toolPart}
            />
          ))}
        </div>
      )}

      {/* Empty state when expanded but no tools yet */}
      {isExpanded && !hasTools && isActive && (
        <div className="px-3 pb-3 border-t border-border pt-2 ml-5">
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <CircleNotch className="size-3.5 animate-spin" />
            Starting...
          </div>
        </div>
      )}
    </div>
  )
}
