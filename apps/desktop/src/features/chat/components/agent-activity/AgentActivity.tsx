/**
 * AgentActivity - Main component showing agent's working steps.
 *
 * Renders all intermediate activity (text, tool calls)
 * in chronological order within a collapsible container.
 */

import { useState, useEffect, useRef, useMemo } from "react";
import type { Message, TimestampedContent } from "../../types";
import { cn } from "@/lib/utils";

import { AgentActivityHeader } from "./AgentActivityHeader";
import { AgentActivityTool } from "./AgentActivityTool";
import { AgentActivityText } from "./AgentActivityText";
import { type ActivityItem, sortActivityItems } from "./types";

interface AgentActivityProps {
  /** The assistant message containing activity */
  message: Message;
  /** Whether the message is still streaming */
  isStreaming: boolean;
  className?: string;
}

/**
 * Build activity items from message content and tool calls.
 */
function buildActivityItems(message: Message): ActivityItem[] {
  const items: ActivityItem[] = [];

  for (const content of message.content) {
    items.push({ type: "text", data: content });
  }

  for (const toolCall of message.toolCalls) {
    items.push({ type: "tool", data: toolCall });
  }

  return sortActivityItems(items);
}

/**
 * Extract text content for display.
 */
function extractText(content: TimestampedContent): string {
  if (content.content.type === "text") {
    return content.content.text;
  }
  return "";
}

export function AgentActivity({
  message,
  isStreaming,
  className,
}: AgentActivityProps) {
  const activityItems = useMemo(
    () => buildActivityItems(message),
    [message]
  );

  const hasActivity = message.toolCalls.length > 0 || message.content.length > 1;

  const hasActiveToolCalls = message.toolCalls.some(
    (tc) => tc.status === "pending" || tc.status === "in_progress"
  );
  const isWorking = isStreaming || hasActiveToolCalls;

  const [userOpenPreference, setUserOpenPreference] = useState<boolean | null>(null);
  const [workEndTime, setWorkEndTime] = useState<number | undefined>(undefined);
  const wasWorkingRef = useRef(isWorking);

  useEffect(() => {
    const wasWorking = wasWorkingRef.current;
    wasWorkingRef.current = isWorking;

    if (wasWorking && !isWorking) {
      const endTimeTimer = setTimeout(() => setWorkEndTime(Date.now()), 0);
      const closeTimer = setTimeout(() => setUserOpenPreference(null), 500);
      return () => {
        clearTimeout(endTimeTimer);
        clearTimeout(closeTimer);
      };
    }

    if (!wasWorking && isWorking) {
      const timer = setTimeout(() => setWorkEndTime(undefined), 0);
      return () => clearTimeout(timer);
    }
  }, [isWorking]);

  const isOpen = userOpenPreference !== null ? userOpenPreference : isWorking;

  const latestActiveTool = message.toolCalls.find(
    (tc) => tc.status === "pending" || tc.status === "in_progress"
  );
  const headerText = isWorking
    ? latestActiveTool?.title ?? "Working..."
    : isOpen
    ? "Hide steps"
    : "Show steps";

  if (!hasActivity && !isStreaming) {
    return null;
  }

  const renderedItems: React.ReactNode[] = [];
  let currentTextGroup: string[] = [];

  const flushTextGroup = () => {
    if (currentTextGroup.length > 0) {
      const text = currentTextGroup.join("");
      if (text.trim()) {
        renderedItems.push(
          <AgentActivityText
            key={`text-${renderedItems.length}`}
            text={text}
            className="my-2"
          />
        );
      }
      currentTextGroup = [];
    }
  };

  for (const item of activityItems) {
    if (item.type === "text") {
      currentTextGroup.push(extractText(item.data));
    } else if (item.type === "tool") {
      flushTextGroup();
      renderedItems.push(
        <AgentActivityTool
          key={`tool-${item.data.id}`}
          toolCall={item.data}
          className="my-2"
        />
      );
    }
  }
  flushTextGroup();

  return (
    <div className={cn("", className)}>
      <AgentActivityHeader
        isWorking={isWorking}
        isOpen={isOpen}
        onToggle={() => setUserOpenPreference(isOpen ? false : true)}
        text={headerText}
        startTime={message.createdAt}
        endTime={workEndTime}
      />

      {isOpen && (
        <div className="mt-2 space-y-1">
          {renderedItems}
        </div>
      )}
    </div>
  );
}
