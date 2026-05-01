import { useEffect } from "react"
import type { GitFileChange } from "@/desktop/client"
import { desktop } from "@/desktop/client"
import { useProjectGitStore } from "./projectGitStore"

interface UseProjectGitChangesOptions {
  enabled?: boolean
  autoRefreshOnMount?: boolean
  refreshOnWindowFocus?: boolean
  subscribeToWatcher?: boolean
}

interface RefreshOptions {
  quiet?: boolean
}

export function useProjectGitChanges(
  projectPath: string | null,
  options?: UseProjectGitChangesOptions
) {
  const enabled = options?.enabled ?? true
  const autoRefreshOnMount = options?.autoRefreshOnMount ?? true
  const refreshOnWindowFocus = options?.refreshOnWindowFocus ?? true
  const subscribeToWatcher = options?.subscribeToWatcher ?? true
  const requestRefresh = useProjectGitStore((state) => state.requestRefresh)
  const entry = useProjectGitStore((state) =>
    projectPath ? state.entriesByProjectPath[projectPath] : undefined
  )

  useEffect(() => {
    if (!projectPath || !enabled || !autoRefreshOnMount) {
      return
    }

    const hasCachedChangesEntry =
      useProjectGitStore.getState().entriesByProjectPath[projectPath] != null

    useProjectGitStore.getState().ensureEntry(projectPath)
    void requestRefresh(projectPath, {
      includeChanges: true,
      quietChanges: hasCachedChangesEntry,
      debounceMs: 0,
    })
  }, [autoRefreshOnMount, enabled, projectPath, requestRefresh])

  useEffect(() => {
    if (!projectPath || !enabled || (!subscribeToWatcher && !refreshOnWindowFocus)) {
      return
    }

    const unlisten = subscribeToWatcher
      ? desktop.watcher.onEvent((event) => {
          if (event.rootPath !== projectPath) {
            return
          }

          void requestRefresh(projectPath, {
            includeChanges: true,
            quietChanges: true,
            debounceMs: 120,
          })
        })
      : () => {}

    const handleFocus = () => {
      if (!refreshOnWindowFocus) {
        return
      }

      void requestRefresh(projectPath, {
        includeChanges: true,
        quietChanges: true,
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

  const refresh = async ({ quiet = false }: RefreshOptions = {}): Promise<GitFileChange[]> => {
    if (!projectPath || !enabled) {
      return []
    }

    await requestRefresh(projectPath, {
      includeChanges: true,
      quietChanges: quiet,
      debounceMs: 0,
    })

    return useProjectGitStore.getState().entriesByProjectPath[projectPath]?.changes ?? []
  }

  return {
    changes: entry?.changes ?? [],
    isLoading: entry?.isChangesLoading ?? false,
    loadError: entry?.changesError ?? null,
    refresh,
    setChanges: (_nextChanges: GitFileChange[]) => {},
  }
}
