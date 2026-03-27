/**
 * AgentActivityText - Displays intermediate text from the agent.
 *
 * This is the agent's "thinking out loud" text that appears
 * within the working section before the final response.
 */

import { cn } from "@/lib/utils";
import { Streamdown } from "streamdown";
import type { ComponentProps } from "react";

const MARKDOWN_COMPONENTS = {
  p: ({ children, className, ...props }: ComponentProps<"p">) => (
    <p
      className={cn("leading-relaxed my-0 [&:not(:first-child)]:mt-4", className)}
      {...props}
    >
      {children}
    </p>
  ),
};

interface AgentActivityTextProps {
  text: string;
  className?: string;
  isStreaming?: boolean;
}

export function AgentActivityText({ text, className, isStreaming }: AgentActivityTextProps) {
  if (!text.trim()) return null;

  return (
    <Streamdown
      mode={isStreaming ? "streaming" : "static"}
      components={MARKDOWN_COMPONENTS}
      className={cn(
        "text-sm text-foreground leading-relaxed [&>p]:mb-4 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className
      )}
    >
      {text}
    </Streamdown>
  );
}
