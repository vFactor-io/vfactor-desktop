import { useEffect } from "react"
import { useShallow } from "zustand/react/shallow"
import { desktop, type GitBranchesResponse } from "@/desktop/client"
import { useProjectGitStore } from "./projectGitStore"

interface UseProjectGitBranchesOptions {
  enabled?: boolean
}

interface RefreshOptions {
  quiet?: boolean
}

export function useProjectGitBranches(
  projectPath: string | null,
  options?: UseProjectGitBranchesOptions
) {
  const enabled = options?.enabled ?? true
  const { requestRefresh } = useProjectGitStore(
    useShallow((state) => ({
      requestRefresh: state.requestRefresh,
    }))
  )
  const setBranchData = useProjectGitStore((state) => state.setBranchData)
  const entry = useProjectGitStore((state) =>
    projectPath ? state.entriesByProjectPath[projectPath] : undefined
  )

  useEffect(() => {
    if (!projectPath || !enabled) {
      return
    }

    useProjectGitStore.getState().ensureEntry(projectPath)
    void requestRefresh(projectPath, {
      includeBranches: true,
      quietBranches: false,
      debounceMs: 0,
    })
  }, [enabled, projectPath, requestRefresh])

  useEffect(() => {
    if (!projectPath || !enabled) {
      return
    }

    const unlisten = desktop.watcher.onEvent((event) => {
      if (event.rootPath !== projectPath || event.kind !== "rescan") {
        return
      }

      void requestRefresh(projectPath, {
        includeBranches: true,
        quietBranches: true,
        debounceMs: 120,
      })
    })

    const handleFocus = () => {
      void requestRefresh(projectPath, {
        includeBranches: true,
        quietBranches: true,
        debounceMs: 0,
      })
    }

    window.addEventListener("focus", handleFocus)

    return () => {
      window.removeEventListener("focus", handleFocus)
      unlisten()
    }
  }, [enabled, projectPath, requestRefresh])

  const refresh = async ({ quiet = false }: RefreshOptions = {}): Promise<GitBranchesResponse | null> => {
    if (!projectPath || !enabled) {
      return null
    }

    await requestRefresh(projectPath, {
      includeBranches: true,
      quietBranches: quiet,
      debounceMs: 0,
    })

    return useProjectGitStore.getState().entriesByProjectPath[projectPath]?.branchData ?? null
  }

  return {
    branchData: entry?.branchData ?? null,
    isLoading: entry?.isBranchLoading ?? false,
    loadError: entry?.branchError ?? null,
    refresh,
    setBranchData: (nextData: GitBranchesResponse | null) => {
      if (!projectPath) {
        return
      }

      setBranchData(projectPath, nextData)
    },
  }
}
