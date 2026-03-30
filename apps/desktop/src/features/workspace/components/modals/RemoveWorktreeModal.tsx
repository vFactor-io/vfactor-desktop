import { useMemo, useState } from "react"
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
import { useTabStore } from "@/features/editor/store"
import { useTerminalStore } from "@/features/terminal/store/terminalStore"
import { useProjectStore } from "@/features/workspace/store"
import type { Project, ProjectWorktree } from "@/features/workspace/types"

interface RemoveWorktreeModalProps {
  open: boolean
  project: Project | null
  worktree: ProjectWorktree | null
  onOpenChange: (open: boolean) => void
}

export function RemoveWorktreeModal({
  open,
  project,
  worktree,
  onOpenChange,
}: RemoveWorktreeModalProps) {
  const removeWorktree = useProjectStore((state) => state.removeWorktree)
  const removeWorktreeTabs = useTabStore((state) => state.removeWorktreeTabs)
  const removeTerminalProject = useTerminalStore((state) => state.removeProject)
  const terminalStateByProject = useTerminalStore((state) => state.terminalStateByProject)
  const [isRemoving, setIsRemoving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const isRootWorktree = project != null && worktree != null && project.rootWorktreeId === worktree.id
  const isLastWorktree = (project?.worktrees.length ?? 0) <= 1

  const copy = useMemo(() => {
    if (isLastWorktree) {
      return {
        title: "Remove project?",
        action: "Remove project",
        description:
          "This is the last worktree in the project. Removing it will remove the project from Nucleus Desktop. The local folder and files stay on disk.",
      }
    }

    if (isRootWorktree) {
      return {
        title: "Remove root worktree?",
        action: "Remove root worktree",
        description:
          "This will remove the root worktree from Nucleus Desktop and promote another worktree in its place. The main checkout stays on disk because Git does not allow deleting the main working tree automatically.",
      }
    }

    return {
      title: "Remove worktree?",
      action: "Remove worktree",
      description:
        "This deletes the worktree checkout from disk but keeps its branch. The worktree must be clean before it can be removed.",
    }
  }, [isLastWorktree, isRootWorktree])

  const handleRemove = async () => {
    if (!project || !worktree) {
      return
    }

    setIsRemoving(true)
    setErrorMessage(null)

    try {
      const terminalTabs = terminalStateByProject[worktree.id]?.tabs ?? []
      await Promise.allSettled(
        terminalTabs.map((tab) => desktop.terminal.closeSession(`project-terminal:${tab.id}`))
      )

      await removeWorktree(project.id, worktree.id)
      removeWorktreeTabs(worktree.id)
      removeTerminalProject(worktree.id)
      onOpenChange(false)
    } catch (error) {
      console.error("Failed to remove worktree:", error)
      setErrorMessage(error instanceof Error ? error.message : "Couldn't remove this worktree.")
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
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {worktree?.name ?? "This worktree"} will be removed.
            {" "}
            {copy.description}
            {errorMessage ? ` ${errorMessage}` : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isRemoving}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            type="button"
            variant="destructive"
            onClick={() => void handleRemove()}
            disabled={!project || !worktree || isRemoving}
          >
            {isRemoving ? "Removing..." : copy.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
