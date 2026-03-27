import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { Compass, File } from "@/components/icons"
import type { NormalizedAgent } from "../hooks/useAgents"

export interface FileItem {
  path: string
  type: "file" | "directory"
}

export interface AtMentionMenuProps {
  agents: NormalizedAgent[]
  files: FileItem[]
  query: string
  isLoading: boolean
  onSelectAgent: (agent: NormalizedAgent) => void
  onSelectFile: (file: FileItem) => void
  onClose: () => void
  selectedIndex: number
  className?: string
}

export function AtMentionMenu({
  agents,
  files,
  query: _query,
  isLoading,
  onSelectAgent,
  onSelectFile,
  onClose,
  selectedIndex,
  className,
}: AtMentionMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<HTMLDivElement>(null)

  // Total items for selection
  const totalItems = agents.length + files.length

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
          "absolute bottom-full left-0 right-0 mb-2 rounded-[6px] border border-border bg-card shadow-lg",
          className
        )}
      >
        <div className="px-3 py-4 text-center text-sm text-muted-foreground">
          Loading...
        </div>
      </div>
    )
  }

  if (totalItems === 0) {
    return (
      <div
        ref={containerRef}
        className={cn(
          "absolute bottom-full left-0 right-0 mb-2 rounded-[6px] border border-border bg-card shadow-lg",
          className
        )}
      >
        <div className="px-3 py-4 text-center text-sm text-muted-foreground">
          No results found
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "absolute bottom-full left-0 right-0 mb-2 rounded-[6px] border border-border bg-card shadow-lg overflow-hidden",
        className
      )}
    >
      <div className="max-h-64 overflow-y-auto p-2">
        {/* Agents section */}
        {agents.map((agent, index) => {
          const isSelected = selectedIndex === index
          return (
            <div
              key={`agent-${agent.name}`}
              ref={isSelected ? selectedRef : undefined}
              onClick={() => onSelectAgent(agent)}
              className={cn(
                "flex items-center gap-2 cursor-pointer rounded-[6px] px-2 py-2 text-sm mb-1 last:mb-0",
                isSelected
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/50"
              )}
            >
              <Compass className="size-4 text-muted-foreground shrink-0" />
              <span className="font-medium text-foreground">@{agent.name}</span>
              {agent.description && (
                <span className="text-muted-foreground truncate">
                  {agent.description}
                </span>
              )}
            </div>
          )
        })}

        {/* Files section */}
        {files.map((file, index) => {
          const isSelected = selectedIndex === agents.length + index
          return (
            <div
              key={`file-${file.path}`}
              ref={isSelected ? selectedRef : undefined}
              onClick={() => onSelectFile(file)}
              className={cn(
                "flex items-center gap-2 cursor-pointer rounded-[6px] px-2 py-2 text-sm mb-1 last:mb-0",
                isSelected
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/50"
              )}
            >
              <File className="size-4 text-muted-foreground shrink-0" />
              <span className="text-foreground truncate">{file.path}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
