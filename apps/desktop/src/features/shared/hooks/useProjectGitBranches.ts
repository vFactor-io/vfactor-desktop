import { useEffect } from "react"
import { useShallow } from "zustand/react/shallow"
import { desktop, type GitBranchesResponse } from "@/desktop/client"
import { useProjectGitStore } from "./projectGitStore"

const OPEN_PULL_REQUEST_POLL_INTERVAL_MS = 30_000

interface UseProjectGitBranchesOptions {
  enabled?: boolean
  autoRefreshOnMount?: boolean
  pollOpenPullRequest?: boolean
  refreshOnWindowFocus?: boolean
  subscribeToWatcher?: boolean
}

interface RefreshOptions {
  quiet?: boolean
}

export function useProjectGitBranches(
  projectPath: string | null,
  options?: UseProjectGitBranchesOptions
) {
  const enabled = options?.enabled ?? true
  const autoRefreshOnMount = options?.autoRefreshOnMount ?? true
  const pollOpenPullRequest = options?.pollOpenPullRequest ?? true
  const refreshOnWindowFocus = options?.refreshOnWindowFocus ?? true
  const subscribeToWatcher = options?.subscribeToWatcher ?? true
  const { requestRefresh } = useProjectGitStore(
    useShallow((state) => ({
      requestRefresh: state.requestRefresh,
    }))
  )
  const setBranchData = useProjectGitStore((state) => state.setBranchData)
  const entry = useProjectGitStore((state) =>
    projectPath ? state.entriesByProjectPath[projectPath] : undefined
  )
  const hasOpenPullRequest = entry?.branchData?.openPullRequest?.state === "open"

  useEffect(() => {
    if (!projectPath || !enabled || !autoRefreshOnMount) {
      return
    }

    useProjectGitStore.getState().ensureEntry(projectPath)
    void requestRefresh(projectPath, {
      includeBranches: true,
      quietBranches: false,
      debounceMs: 0,
    })
  }, [autoRefreshOnMount, enabled, projectPath, requestRefresh])

  useEffect(() => {
    if (!projectPath || !enabled || !hasOpenPullRequest || !pollOpenPullRequest) {
      return
    }

    const intervalId = window.setInterval(() => {
      void requestRefresh(projectPath, {
        includeBranches: true,
        quietBranches: true,
        debounceMs: 0,
      })
    }, OPEN_PULL_REQUEST_POLL_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [enabled, hasOpenPullRequest, pollOpenPullRequest, projectPath, requestRefresh])

  useEffect(() => {
    if (!projectPath || !enabled || (!subscribeToWatcher && !refreshOnWindowFocus)) {
      return
    }

    const unlisten = subscribeToWatcher
      ? desktop.watcher.onEvent((event) => {
          if (event.rootPath !== projectPath || event.kind !== "rescan") {
            return
          }

          void requestRefresh(projectPath, {
            includeBranches: true,
            quietBranches: true,
            debounceMs: 120,
          })
        })
      : () => {}

    const handleFocus = () => {
      if (!refreshOnWindowFocus) {
        return
      }

      void requestRefresh(projectPath, {
        includeBranches: true,
        quietBranches: true,
        debounceMs: 0,
      })
    }

    if (refreshOnWindowFocus) {
      window.addEventListener("focus", handleFocus)
    }

    return () => {
      if (refreshOnWindowFocus) {
        window.removeEventListener("focus", handleFocus)
      }
      unlisten()
    }
  }, [enabled, projectPath, refreshOnWindowFocus, requestRefresh, subscribeToWatcher])

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
