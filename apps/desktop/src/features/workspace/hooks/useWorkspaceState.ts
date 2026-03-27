import { useState, useCallback } from "react"
import type { Repository } from "../types"
import { mockRepositories } from "../mocks/mock-workspaces"
import { DEFAULT_SELECTED_WORKSPACE_ID } from "../constants"

/**
 * Hook for managing workspace and repository state
 * Handles repository list, selection state, and collapse toggles
 */
export function useWorkspaceState() {
  const [repositories, setRepositories] = useState<Repository[]>(mockRepositories)
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | undefined>(
    DEFAULT_SELECTED_WORKSPACE_ID
  )

  const handleToggleCollapse = useCallback((repoId: string) => {
    setRepositories((prev) =>
      prev.map((repo) =>
        repo.id === repoId ? { ...repo, collapsed: !repo.collapsed } : repo
      )
    )
  }, [])

  return {
    repositories,
    selectedWorkspaceId,
    setSelectedWorkspaceId,
    handleToggleCollapse,
  }
}
