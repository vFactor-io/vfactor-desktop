import type { ReactNode } from "react"
import type { Project } from "@/features/workspace/types"
import { Plus } from "@/components/icons"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/features/shared/components/ui/dropdown-menu"
import { useProjectStore } from "@/features/workspace/store"
import { openFolderPicker } from "@/features/workspace/utils/folderDialog"
import { ProjectIcon } from "@/features/workspace/components/ProjectIcon"
import { cn } from "@/lib/utils"

interface ProjectSelectorDropdownProps {
  selectedProject?: Project | null
  trigger: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  side?: "top" | "right" | "bottom" | "left"
  align?: "start" | "center" | "end"
  sideOffset?: number
  contentClassName?: string
}

export function ProjectSelectorDropdown({
  selectedProject,
  trigger,
  open,
  onOpenChange,
  side = "bottom",
  align = "start",
  sideOffset = 4,
  contentClassName,
}: ProjectSelectorDropdownProps) {
  const { projects, selectProject, addProject } = useProjectStore()

  const handleSelectProject = async (projectId: string) => {
    await selectProject(projectId)
    onOpenChange?.(false)
  }

  const handleAddProject = async () => {
    const folderPath = await openFolderPicker()
    if (!folderPath) {
      return
    }

    await addProject(folderPath)
    onOpenChange?.(false)
  }

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        side={side}
        align={align}
        sideOffset={sideOffset}
        className={cn("w-[260px] border border-border/70 bg-card p-2 shadow-lg", contentClassName)}
      >
        {projects.length > 0 ? (
          projects.map((project) => {
            const isSelected = project.id === selectedProject?.id

            return (
              <DropdownMenuItem
                key={project.id}
                onClick={() => void handleSelectProject(project.id)}
                className="flex items-center gap-2 px-2 py-2"
              >
                <ProjectDropdownAvatar project={project} />
                <span className="min-w-0 flex-1">
                  <span className="font-sans block truncate text-sm leading-tight font-bold text-sidebar-foreground">
                    {project.name}
                  </span>
                </span>
                {isSelected ? <span className="text-sm text-muted-foreground">Current</span> : null}
              </DropdownMenuItem>
            )
          })
        ) : (
          <div className="px-2 py-2 text-sm text-muted-foreground">No projects yet</div>
        )}
        <DropdownMenuSeparator className="my-2" />
        <DropdownMenuItem
          onClick={() => void handleAddProject()}
          className="min-h-8 px-2 py-1 text-sm font-medium text-foreground"
        >
          <Plus size={14} className="text-muted-foreground" />
          <span>Add new project</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ProjectDropdownAvatar({ project }: { project: Project }) {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/20">
      <ProjectIcon project={project} size={14} className="text-muted-foreground" />
    </span>
  )
}
