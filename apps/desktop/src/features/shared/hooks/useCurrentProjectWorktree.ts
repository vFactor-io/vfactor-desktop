import { useMemo } from "react"
import { useShallow } from "zustand/react/shallow"
import { useProjectStore } from "@/features/workspace/store"
import { getWorktreeById } from "@/features/workspace/utils/worktrees"
import type { Project, ProjectWorktree } from "@/features/workspace/types"

export function getCurrentProjectWorktreeState(
  projects: Project[],
  focusedProjectId: string | null,
  activeWorktreeId: string | null
): {
  focusedProject: Project | null
  focusedProjectId: string | null
  activeWorktree: ProjectWorktree | null
  activeWorktreeId: string | null
  activeWorktreePath: string | null
  targetBranch: string | null
  selectedProject: Project | null
  selectedProjectId: string | null
  selectedWorktree: ProjectWorktree | null
  selectedWorktreeId: string | null
  selectedWorktreePath: string | null
} {
  const focusedProject =
    (focusedProjectId ? projects.find((project) => project.id === focusedProjectId) : null) ?? null
  const activeWorktree = getWorktreeById(focusedProject, activeWorktreeId)

  return {
    focusedProject,
    focusedProjectId: focusedProject?.id ?? null,
    activeWorktree,
    activeWorktreeId: activeWorktree?.id ?? null,
    activeWorktreePath: activeWorktree?.path ?? null,
    targetBranch: focusedProject?.targetBranch ?? null,
    selectedProject: focusedProject,
    selectedProjectId: focusedProject?.id ?? null,
    selectedWorktree: activeWorktree,
    selectedWorktreeId: activeWorktree?.id ?? null,
    selectedWorktreePath: activeWorktree?.path ?? null,
  }
}

export function useCurrentProjectWorktree() {
  const { projects, focusedProjectId, activeWorktreeId } = useProjectStore(
    useShallow((state) => ({
      projects: state.projects,
      focusedProjectId: state.focusedProjectId,
      activeWorktreeId: state.activeWorktreeId,
    }))
  )

  return useMemo(
    () => getCurrentProjectWorktreeState(projects, focusedProjectId, activeWorktreeId),
    [projects, focusedProjectId, activeWorktreeId]
  )
}
