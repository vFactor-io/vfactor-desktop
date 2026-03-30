import { useState } from "react"
import { Trash } from "@/components/icons"
import { desktop } from "@/desktop/client"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/features/shared/components/ui/alert-dialog"
import type { Project } from "@/features/workspace/types"
import { useProjectStore } from "@/features/workspace/store"
import { useChatStore } from "@/features/chat/store/chatStore"
import { useTabStore } from "@/features/editor/store"
import { useTerminalStore } from "@/features/terminal/store/terminalStore"

interface RemoveProjectModalProps {
  open: boolean
  project: Project | null
  onOpenChange: (open: boolean) => void
}

export function RemoveProjectModal({
  open,
  project,
  onOpenChange,
}: RemoveProjectModalProps) {
  const { removeProject } = useProjectStore()
  const { removeProjectData } = useChatStore()
  const removeWorktreeTabs = useTabStore((state) => state.removeWorktreeTabs)
  const removeTerminalProject = useTerminalStore((state) => state.removeProject)
  const terminalStateByProject = useTerminalStore((state) => state.terminalStateByProject)
  const [isRemoving, setIsRemoving] = useState(false)

  const handleRemove = async () => {
    if (!project) {
      return
    }

    setIsRemoving(true)

    try {
      for (const worktree of project.worktrees) {
        const terminalTabs = terminalStateByProject[worktree.id]?.tabs ?? []
        await Promise.allSettled(
          terminalTabs.map((tab) => desktop.terminal.closeSession(`project-terminal:${tab.id}`))
        )
        removeWorktreeTabs(worktree.id)
        removeTerminalProject(worktree.id)
      }
      await removeProjectData(project.id)
      await removeProject(project.id)
      onOpenChange(false)
    } catch (error) {
      console.error("Failed to remove project:", error)
    } finally {
      setIsRemoving(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <Trash />
          </AlertDialogMedia>
          <AlertDialogTitle>Remove project?</AlertDialogTitle>
          <AlertDialogDescription>
            Remove {project?.name ?? "this project"} and its chat history from Nucleus Desktop.
            This keeps the local folder and files on disk.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isRemoving}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            type="button"
            variant="destructive"
            onClick={() => void handleRemove()}
            disabled={!project || isRemoving}
          >
            {isRemoving ? "Removing..." : "Remove project"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
