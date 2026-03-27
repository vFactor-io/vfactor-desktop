import { ChatCircle, GitDiff, X } from "@/components/icons"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/features/shared/components/ui/tooltip"
import { getFileIcon } from "@/features/editor/utils/fileIcons"
import type { TabType } from "../types"

interface TabItemProps {
  type: TabType
  title: string
  isActive: boolean
  onClick: () => void
  onClose?: () => void
}

function TabIcon({ type, title }: { type: TabType; title: string }) {
  switch (type) {
    case "file": {
      const FileIcon = getFileIcon(title)
      return <FileIcon size={14} />
    }
    case "diff":
      return <GitDiff size={14} />
    case "chat":
    default:
      return <ChatCircle size={14} />
  }
}

export function TabItem({ type, title, isActive, onClick, onClose }: TabItemProps) {
  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation()
    onClose?.()
  }

  return (
    <div
      role="tab"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      className={cn(
        "group flex items-center gap-1.5 px-3 h-full text-sm transition-colors border-b-2 -mb-px cursor-pointer",
        isActive
          ? "text-foreground border-foreground"
          : "text-muted-foreground border-transparent hover:text-foreground"
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center gap-1.5">
            <TabIcon type={type} title={title} />
            <span className="truncate max-w-24">{title}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">{title}</TooltipContent>
      </Tooltip>
      {onClose && (
        <button
          type="button"
          onClick={handleClose}
          className="ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-muted/50 transition-opacity"
          aria-label={`Close ${title}`}
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}
