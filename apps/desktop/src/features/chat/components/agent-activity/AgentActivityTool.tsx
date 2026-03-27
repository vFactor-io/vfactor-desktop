/**
 * AgentActivityTool - Compact inline tool row (non-SDK version).
 *
 * Shows:
 * - Icon based on tool kind
 * - Tool title + optional chip
 * - Status indicator (spinner for active)
 * - Expandable section with content (text, diff, terminal)
 */

import { useState } from "react";
import {
  FileText,
  PencilSimple,
  Trash,
  FolderOpen,
  MagnifyingGlass,
  Terminal,
  Brain,
  Globe,
  CircleDashed,
  CircleNotch,
  GitDiff,
} from "@/components/icons";
import type { ToolCallState, ToolKind, ToolCallContent } from "../../types";
import { cn } from "@/lib/utils";

interface AgentActivityToolProps {
  toolCall: ToolCallState;
  className?: string;
}

/**
 * Render the tool kind icon.
 */
function ToolKindIcon({ kind, className }: { kind?: ToolKind; className?: string }) {
  const iconClass = cn("size-4 shrink-0", className);

  switch (kind) {
    case "read":
      return <FileText className={iconClass} />;
    case "edit":
      return <PencilSimple className={iconClass} />;
    case "delete":
      return <Trash className={iconClass} />;
    case "move":
      return <FolderOpen className={iconClass} />;
    case "search":
      return <MagnifyingGlass className={iconClass} />;
    case "execute":
      return <Terminal className={iconClass} />;
    case "think":
      return <Brain className={iconClass} />;
    case "fetch":
      return <Globe className={iconClass} />;
    case "diff":
      return <GitDiff className={iconClass} />;
    default:
      return <CircleDashed className={iconClass} />;
  }
}

/**
 * Render tool call content (output, diff, terminal reference).
 */
function ToolContent({ content }: { content: ToolCallContent[] }) {
  if (content.length === 0) return null;

  return (
    <div className="space-y-3 text-xs">
      {content.map((item, index) => {
        if (item.type === "content") {
          const block = item.content;
          if (block.type === "text") {
            return (
              <div key={index}>
                <div className="text-muted-foreground mb-1 font-medium">Output</div>
                <pre className="bg-muted/50 rounded p-2 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-mono">
                  {block.text}
                </pre>
              </div>
            );
          }
          return null;
        }

        if (item.type === "diff") {
          return (
            <div key={index}>
              <div className="text-muted-foreground mb-1 font-medium">Diff: {item.path}</div>
              <div className="bg-muted/50 rounded p-2 overflow-x-auto font-mono">
                <pre className="text-red-400 line-through">{item.oldText || "(empty)"}</pre>
                <pre className="text-green-400">{item.newText || "(empty)"}</pre>
              </div>
            </div>
          );
        }

        if (item.type === "terminal") {
          return (
            <div key={index} className="text-muted-foreground">
              Terminal: {item.terminalId}
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}

export function AgentActivityTool({
  toolCall,
  className,
}: AgentActivityToolProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const isActive = toolCall.status === "pending" || toolCall.status === "in_progress";
  const isFailed = toolCall.status === "failed";
  const isCompleted = toolCall.status === "completed";
  const hasContent = toolCall.content.length > 0;
  const canExpand = (isCompleted || isFailed) && hasContent;

  return (
    <div className={cn("text-sm", className)}>
      {/* Compact row */}
      <button
        type="button"
        onClick={() => canExpand && setIsExpanded(!isExpanded)}
        disabled={!canExpand}
        className={cn(
          "flex items-center gap-2 text-left w-full",
          canExpand && "cursor-pointer hover:opacity-80",
          !canExpand && "cursor-default"
        )}
      >
        {/* Icon */}
        <ToolKindIcon kind={toolCall.kind} className="text-muted-foreground" />

        {/* Title */}
        <span className={cn("font-medium", isFailed && "text-destructive")}>
          {toolCall.title}
        </span>

        {/* Spinner for active */}
        {isActive && (
          <CircleNotch className="size-3.5 shrink-0 animate-spin text-muted-foreground ml-auto" />
        )}
      </button>

      {/* Expanded section */}
      {isExpanded && canExpand && (
        <div className="mt-2 ml-6">
          <ToolContent content={toolCall.content} />
        </div>
      )}
    </div>
  );
}
