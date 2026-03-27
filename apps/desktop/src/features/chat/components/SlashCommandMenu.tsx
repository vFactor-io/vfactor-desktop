import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { BookOpen } from "@/components/icons"
import type { NormalizedCommand } from "../hooks/useCommands"

export interface SlashCommandMenuProps {
  commands: NormalizedCommand[]
  query: string
  isLoading: boolean
  onSelect: (command: NormalizedCommand) => void
  onClose: () => void
  selectedIndex: number
  className?: string
}

export function SlashCommandMenu({
  commands,
  query,
  isLoading,
  onSelect,
  onClose,
  selectedIndex,
  className,
}: SlashCommandMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<HTMLDivElement>(null)

  // Scroll selected item into view
  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: "nearest" })
    }
  }, [selectedIndex])

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [onClose])

  if (isLoading) {
    return (
      <div
        ref={containerRef}
        className={cn(
          "absolute bottom-full left-0 right-0 z-20 mb-2 overflow-hidden rounded-xl border border-border bg-card shadow-sm",
          className
        )}
      >
        <div className="px-5 py-4 text-center text-sm text-muted-foreground">
          Loading commands...
        </div>
      </div>
    )
  }

  if (commands.length === 0) {
    return (
      <div
        ref={containerRef}
        className={cn(
          "absolute bottom-full left-0 right-0 z-20 mb-2 overflow-hidden rounded-xl border border-border bg-card shadow-sm",
          className
        )}
      >
        <div className="px-5 py-4 text-center text-sm text-muted-foreground">
          No commands found
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "absolute bottom-full left-0 right-0 z-20 mb-2 overflow-hidden rounded-xl border border-border bg-card shadow-sm",
        className
      )}
    >
      <div className="app-scrollbar max-h-72 overflow-y-auto px-2 pb-3">
        <div className="px-3 pt-4 pb-2 text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground/80">
          Skills
        </div>

        {commands.map((cmd, index) => {
          const isSelected = selectedIndex === index

          return (
            <div
              key={cmd.name}
              ref={isSelected ? selectedRef : undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(cmd)}
              className={cn(
                "mb-1 grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-xl px-3 py-3 text-sm last:mb-0",
                isSelected
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/50"
              )}
            >
              <span className="flex size-9 items-center justify-center rounded-lg border border-border bg-muted text-skill-icon">
                <BookOpen size={17} />
              </span>

              <span className="min-w-0">
                <span className="block truncate font-medium text-foreground">{cmd.name}</span>
                {cmd.description ? (
                  <span className="block truncate text-muted-foreground">
                    {cmd.description}
                  </span>
                ) : null}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
