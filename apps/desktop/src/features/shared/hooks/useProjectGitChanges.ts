import { useEffect } from "react"
import type { GitFileChange } from "@/desktop/client"
import { desktop } from "@/desktop/client"
import { useProjectGitStore } from "./projectGitStore"

interface UseProjectGitChangesOptions {
  enabled?: boolean
}

interface RefreshOptions {
  quiet?: boolean
}

export function useProjectGitChanges(
  projectPath: string | null,
  options?: UseProjectGitChangesOptions
) {
  const enabled = options?.enabled ?? true
  const requestRefresh = useProjectGitStore((state) => state.requestRefresh)
  const entry = useProjectGitStore((state) =>
    projectPath ? state.entriesByProjectPath[projectPath] : undefined
  )

  useEffect(() => {
    if (!projectPath || !enabled) {
      return
    }

    useProjectGitStore.getState().ensureEntry(projectPath)
    void requestRefresh(projectPath, {
      includeChanges: true,
      quietChanges: false,
      debounceMs: 0,
    })
  }, [enabled, projectPath, requestRefresh])

  useEffect(() => {
    if (!projectPath || !enabled) {
      return
    }

    const unlisten = desktop.watcher.onEvent((event) => {
      if (event.rootPath !== projectPath) {
        return
      }

      void requestRefresh(projectPath, {
        includeChanges: true,
        quietChanges: true,
        debounceMs: 120,
      })
    })

    const handleFocus = () => {
      void requestRefresh(projectPath, {
        includeChanges: true,
        quietChanges: true,
        debounceMs: 0,
      })
    }

    window.addEventListener("focus", handleFocus)

    return () => {
      window.removeEventListener("focus", handleFocus)
      unlisten()
    }
  }, [enabled, projectPath, requestRefresh])

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
