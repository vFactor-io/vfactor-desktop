/**
 * AgentActivityHeader - Collapsible header for the agent activity panel.
 *
 * Shows:
 * - LoadingDots when working, nothing when done
 * - Dynamic text (current action or "Show steps" / "Hide steps")
 * - Elapsed time
 * - Chevron for expand/collapse
 */

import { CaretUp, CaretDown } from "@/components/icons";
import { LoadingDots } from "@/features/shared/components/ui/loading-dots";
import { cn } from "@/lib/utils";
import { useElapsedDuration } from "../workDuration";

interface AgentActivityHeaderProps {
  /** Whether the agent is currently working */
  isWorking: boolean;
  /** Whether the content is expanded */
  isOpen: boolean;
  /** Callback when user toggles the header */
  onToggle: () => void;
  /** Text to display (e.g., "Considering next steps" or "Show steps") */
  text: string;
  /** Timestamp when work started */
  startTime: number;
  /** Timestamp when work ended (for final duration display) */
  endTime?: number;
  className?: string;
}

export function AgentActivityHeader({
  isWorking,
  isOpen,
  onToggle,
  text,
  startTime,
  endTime,
  className,
}: AgentActivityHeaderProps) {
  const elapsedTime = useElapsedDuration(startTime, isWorking, endTime)

  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex w-full items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground py-1",
        className
      )}
    >
      {isWorking && <LoadingDots />}

      <span className="flex-1 text-left">
        {text}
      </span>

      <span className="text-muted-foreground/70 tabular-nums">
        · {elapsedTime}
      </span>

      {isOpen ? (
        <CaretUp className="size-4" />
      ) : (
        <CaretDown className="size-4" />
      )}
    </button>
  )
}
