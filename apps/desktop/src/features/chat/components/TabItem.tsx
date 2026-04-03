import { GitDiff, X } from "@/components/icons"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/features/shared/components/ui/tooltip"
import { getFileIcon } from "@/features/editor/utils/fileIcons"
import { ModelLogo, getHarnessLogoKind } from "./ModelLogo"
import type { HarnessId, TabType } from "../types"

interface TabItemProps {
  type: TabType
  title: string
  harnessId?: HarnessId
  isActive: boolean
  onClick: () => void
  onClose?: () => void
}

function TabIcon({ type, title, harnessId }: { type: TabType; title: string; harnessId?: HarnessId }) {
  switch (type) {
    case "file": {
      const FileIcon = getFileIcon(title)
      return <FileIcon size={15} />
    }
    case "diff":
      return <GitDiff size={15} />
    case "chat-session": {
      const logoKind = harnessId ? getHarnessLogoKind(harnessId) : "default"
      return <ModelLogo kind={logoKind} className="size-4" />
    }
    default:
      return null
  }
}

export function TabItem({ type, title, harnessId, isActive, onClick, onClose }: TabItemProps) {
  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation()
    onClose?.()
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="tab"
          tabIndex={0}
          onClick={onClick}
          onKeyDown={(e) => e.key === "Enter" && onClick()}
          className={cn(
            "group flex items-center gap-1.5 rounded-md px-2 py-1 text-xs cursor-pointer transition-colors",
            isActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
          )}
        >
          <TabIcon type={type} title={title} harnessId={harnessId} />
          <span className="truncate max-w-28">{title}</span>
          {onClose && (
            <button
              type="button"
              onClick={handleClose}
              className="ml-0.5 -mr-0.5 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-muted/60 transition-opacity"
              aria-label={`Close ${title}`}
            >
              <X size={10} />
            </button>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">{title}</TooltipContent>
    </Tooltip>
  )
}
