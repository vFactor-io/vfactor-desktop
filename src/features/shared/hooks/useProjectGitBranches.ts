import { useCallback, useEffect, useRef, useState } from "react"
import { desktop, type GitBranchesResponse } from "@/desktop/client"

const WATCHER_REFRESH_DEBOUNCE_MS = 120

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
  const [branchData, setBranchDataState] = useState<GitBranchesResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const setBranchData = useCallback((nextData: GitBranchesResponse | null) => {
    requestIdRef.current += 1
    setBranchDataState(nextData)
    setLoadError(null)
    setIsLoading(false)
  }, [])

  const refresh = useCallback(
    async ({ quiet = false }: RefreshOptions = {}): Promise<GitBranchesResponse | null> => {
      if (!projectPath || !enabled) {
        return null
      }

      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId

      if (!quiet) {
        setIsLoading(true)
      }

      try {
        const nextData = await desktop.git.getBranches(projectPath)

        if (requestId !== requestIdRef.current) {
          return nextData
        }

        setBranchDataState(nextData)
        setLoadError(null)
        return nextData
      } catch (error) {
        console.warn("[useProjectGitBranches] Failed to load git branches:", error)

        if (!quiet && requestId === requestIdRef.current) {
          setLoadError("Unable to load branches for this project.")
        }

        return null
      } finally {
        if (!quiet && requestId === requestIdRef.current) {
          setIsLoading(false)
        }
      }
    },
    [enabled, projectPath]
  )

  useEffect(() => {
    requestIdRef.current += 1
    setBranchDataState(null)
    setLoadError(null)
    setIsLoading(false)
  }, [projectPath])

  useEffect(() => {
    if (!projectPath) {
      return
    }

    if (!enabled) {
      return
    }

    void refresh()
  }, [enabled, projectPath, refresh])

  useEffect(() => {
    if (!projectPath || !enabled) {
      return
    }

    let refreshTimeoutId: ReturnType<typeof setTimeout> | null = null

    const scheduleRefresh = () => {
      if (refreshTimeoutId) {
        clearTimeout(refreshTimeoutId)
      }

      refreshTimeoutId = setTimeout(() => {
        refreshTimeoutId = null
        void refresh({ quiet: true })
      }, WATCHER_REFRESH_DEBOUNCE_MS)
    }

    const unlisten = desktop.watcher.onEvent((event) => {
      if (event.rootPath !== projectPath || event.kind !== "rescan") {
        return
      }

      scheduleRefresh()
    })

    const handleFocus = () => {
      void refresh({ quiet: true })
    }

    window.addEventListener("focus", handleFocus)

    return () => {
      if (refreshTimeoutId) {
        clearTimeout(refreshTimeoutId)
      }

      window.removeEventListener("focus", handleFocus)
      unlisten()
    }
  }, [enabled, projectPath, refresh])

  return {
    branchData,
    isLoading,
    loadError,
    refresh,
    setBranchData,
  }
}
