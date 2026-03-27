import { cn } from "@/lib/utils"
import { useResizablePanel } from "./useResizablePanel"

interface SidebarShellProps {
  width: number
  setWidth: (width: number) => void
  isCollapsed: boolean
  side: "left" | "right"
  sizeConstraintClass: string
  children: React.ReactNode
  className?: string
}

export function SidebarShell({
  width,
  setWidth,
  isCollapsed,
  side,
  sizeConstraintClass,
  children,
  className,
}: SidebarShellProps) {
  const { handleResizeStart } = useResizablePanel({ width, setWidth, isCollapsed, side })

  return (
    <aside
      style={{ width: isCollapsed ? 0 : width }}
      className={cn(
        "relative flex shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground",
        side === "left" ? "border-r border-sidebar-border/70" : "border-l border-sidebar-border",
        !isCollapsed && sizeConstraintClass,
        className,
      )}
    >
      {children}
      {!isCollapsed ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${side} sidebar`}
          onPointerDown={handleResizeStart}
          className={cn(
            "absolute inset-y-0 z-10 w-2 cursor-col-resize",
            side === "left" ? "right-0 translate-x-1/2" : "left-0 -translate-x-1/2",
          )}
        >
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent hover:bg-sidebar-border/90" />
        </div>
      ) : null}
    </aside>
  )
}
