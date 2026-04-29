import { useEffect } from "react"
import type { GitPullRequestCheck } from "@/desktop/client"
import { desktop } from "@/desktop/client"
import { useProjectGitStore } from "./projectGitStore"

const PULL_REQUEST_CHECKS_POLL_INTERVAL_MS = 5000
const PULL_REQUEST_ACTIVITY_REFRESH_COOLDOWN_MS = 60_000

interface UseProjectGitPullRequestChecksOptions {
  enabled?: boolean
}

interface RefreshOptions {
  quiet?: boolean
}

function shouldRequestPullRequestActivity(projectPath: string): boolean {
  const loadedAt =
    useProjectGitStore.getState().entriesByProjectPath[projectPath]?.pullRequestActivityLoadedAt ??
    null

  return !loadedAt || Date.now() - loadedAt > PULL_REQUEST_ACTIVITY_REFRESH_COOLDOWN_MS
}

export function useProjectGitPullRequestChecks(
  projectPath: string | null,
  options?: UseProjectGitPullRequestChecksOptions
) {
  const enabled = options?.enabled ?? true
  const requestRefresh = useProjectGitStore((state) => state.requestRefresh)
  const entry = useProjectGitStore((state) =>
    projectPath ? state.entriesByProjectPath[projectPath] : undefined
  )
  const openPullRequest = entry?.branchData?.openPullRequest
  const hasOpenPullRequest = openPullRequest?.state === "open"
  const openPullRequestRefreshKey =
    hasOpenPullRequest ? `${openPullRequest.number}:${openPullRequest.checksStatus}` : null
  const shouldPoll =
    hasOpenPullRequest &&
    (openPullRequest.checksStatus === "pending" ||
      (entry?.pullRequestChecks ?? []).some((check) => check.status === "pending"))

  useEffect(() => {
    if (!projectPath || !enabled || !hasOpenPullRequest) {
      return
    }

    useProjectGitStore.getState().ensureEntry(projectPath)
    void requestRefresh(projectPath, {
      includePullRequestChecks: true,
      includePullRequestActivity: shouldRequestPullRequestActivity(projectPath),
      quietPullRequestChecks: false,
      debounceMs: 0,
    })
  }, [enabled, hasOpenPullRequest, openPullRequestRefreshKey, projectPath, requestRefresh])

  useEffect(() => {
    if (!projectPath || !enabled || !hasOpenPullRequest) {
      return
    }

    const unlisten = desktop.watcher.onEvent((event) => {
      if (event.rootPath !== projectPath || event.kind !== "rescan") {
        return
      }

      void requestRefresh(projectPath, {
        includePullRequestChecks: true,
        includePullRequestActivity: false,
        quietPullRequestChecks: true,
        debounceMs: 120,
      })
    })

    const handleFocus = () => {
      void requestRefresh(projectPath, {
        includePullRequestChecks: true,
        includePullRequestActivity: shouldRequestPullRequestActivity(projectPath),
        quietPullRequestChecks: true,
        debounceMs: 0,
      })
    }

    window.addEventListener("focus", handleFocus)

    return () => {
      window.removeEventListener("focus", handleFocus)
      unlisten()
    }
  }, [enabled, hasOpenPullRequest, projectPath, requestRefresh])

  useEffect(() => {
    if (!projectPath || !enabled || !shouldPoll) {
      return
    }

    const intervalId = window.setInterval(() => {
      void requestRefresh(projectPath, {
        includePullRequestChecks: true,
        includePullRequestActivity: false,
        quietPullRequestChecks: true,
        debounceMs: 0,
      })
    }, PULL_REQUEST_CHECKS_POLL_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [enabled, projectPath, requestRefresh, shouldPoll])

  const refresh = async ({ quiet = false }: RefreshOptions = {}): Promise<GitPullRequestCheck[]> => {
    if (!projectPath || !enabled || !hasOpenPullRequest) {
      return []
    }

    await requestRefresh(projectPath, {
      includePullRequestChecks: true,
      includePullRequestActivity: true,
      quietPullRequestChecks: quiet,
      debounceMs: 0,
    })

    return useProjectGitStore.getState().entriesByProjectPath[projectPath]?.pullRequestChecks ?? []
  }

  return {
    checks: entry?.pullRequestChecks ?? [],
    commits: entry?.pullRequestCommits ?? [],
    comments: entry?.pullRequestComments ?? [],
    reviews: entry?.pullRequestReviews ?? [],
    reviewComments: entry?.pullRequestReviewComments ?? [],
    isLoading: entry?.isPullRequestChecksLoading ?? false,
    loadError: entry?.pullRequestChecksError ?? null,
    refresh,
  }
}
