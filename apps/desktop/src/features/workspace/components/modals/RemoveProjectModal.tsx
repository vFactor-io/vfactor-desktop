import { useEffect, useState } from "react"
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
import { disposeCachedTerminalSession } from "@/features/terminal/components/terminalSessionCache"
import { getTerminalSessionId, isTerminalTab } from "@/features/terminal/utils/terminalTabs"

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
  const tabsByWorktree = useTabStore((state) => state.tabsByWorktree)
  const [isRemoving, setIsRemoving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setErrorMessage(null)
    }
  }, [open])

  const handleRemove = async () => {
    if (!project) {
      return
    }

    setIsRemoving(true)
    setErrorMessage(null)

    try {
      for (const worktree of project.worktrees) {
        const terminalTabs = (tabsByWorktree[worktree.id]?.tabs ?? []).filter(isTerminalTab)
        await Promise.allSettled(
          terminalTabs.map((tab) => {
            const terminalSessionId = getTerminalSessionId(tab.id)
            disposeCachedTerminalSession(terminalSessionId)
            return desktop.terminal.closeSession(terminalSessionId)
          })
        )
      }
      await removeProjectData(project.id)
      await removeProject(project.id)
      for (const worktree of project.worktrees) {
        removeWorktreeTabs(worktree.id)
      }
      onOpenChange(false)
    } catch (error) {
      console.error("Failed to remove project:", error)
      setErrorMessage(error instanceof Error ? error.message : "Couldn't remove this project.")
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
            {errorMessage ? ` ${errorMessage}` : ""}
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
