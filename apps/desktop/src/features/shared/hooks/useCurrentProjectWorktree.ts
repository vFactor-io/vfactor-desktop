import { useMemo } from "react"
import { useShallow } from "zustand/react/shallow"
import { useProjectStore } from "@/features/workspace/store"
import { getSelectedWorktree, isWorktreeReady } from "@/features/workspace/utils/worktrees"

export function useCurrentProjectWorktree() {
  const { projects, selectedProjectId } = useProjectStore(
    useShallow((state) => ({
      projects: state.projects,
      selectedProjectId: state.selectedProjectId,
    }))
  )

  return useMemo(() => {
    const selectedProject =
      projects.find((project) => project.id === selectedProjectId) ?? null
    const selectedWorktree = getSelectedWorktree(selectedProject)
    const readySelectedWorktree = isWorktreeReady(selectedWorktree) ? selectedWorktree : null

    return {
      selectedProject,
      selectedProjectId,
      selectedWorktree: readySelectedWorktree,
      selectedWorktreeId: readySelectedWorktree?.id ?? null,
      selectedWorktreePath: readySelectedWorktree?.path ?? null,
      targetBranch: selectedProject?.targetBranch ?? null,
    }
  }, [projects, selectedProjectId])
}
