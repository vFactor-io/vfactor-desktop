import { useChatStore } from "@/features/chat/store"
import { useProjectGitStore } from "@/features/shared/hooks/projectGitStore"
import { useFileTreeStore } from "@/features/workspace/store"

export type ProjectPrewarmTarget = "chat" | "files" | "changes" | "checks" | "browser"

const prewarmPromiseByKey = new Map<string, Promise<void>>()
const BACKGROUND_PREWARM_DEBOUNCE_MS = 120
let latestBackgroundPrewarmRequestId = 0
let backgroundPrewarmTimerId: ReturnType<typeof setTimeout> | null = null
let resolvePendingBackgroundPrewarm: (() => void) | null = null

function trackPrewarm(key: string, load: () => Promise<void>): Promise<void> {
  const inFlightPrewarm = prewarmPromiseByKey.get(key)
  if (inFlightPrewarm) {
    return inFlightPrewarm
  }

  const promise = load().finally(() => {
    prewarmPromiseByKey.delete(key)
  })

  prewarmPromiseByKey.set(key, promise)
  return promise
}

function scheduleBackgroundPrewarm(
  worktreePath: string,
  target: ProjectPrewarmTarget,
  requestId: number
): Promise<void> {
  if (backgroundPrewarmTimerId) {
    clearTimeout(backgroundPrewarmTimerId)
    backgroundPrewarmTimerId = null
  }

  resolvePendingBackgroundPrewarm?.()

  return new Promise((resolve) => {
    resolvePendingBackgroundPrewarm = resolve
    backgroundPrewarmTimerId = setTimeout(() => {
      backgroundPrewarmTimerId = null
      resolvePendingBackgroundPrewarm = null

      void (async () => {
        if (requestId !== latestBackgroundPrewarmRequestId) {
          resolve()
          return
        }

        if (target === "chat" || target === "browser") {
          resolve()
          return
        }

        const gitStore = useProjectGitStore.getState()

        gitStore.ensureEntry(worktreePath)
        await gitStore.requestRefresh(worktreePath, {
          includeBranches: true,
          includeChanges: target === "changes" || target === "files",
          quietBranches: true,
          quietChanges: true,
          debounceMs: 0,
        })

        if (requestId !== latestBackgroundPrewarmRequestId) {
          resolve()
          return
        }

        if (target === "files") {
          const fileTreeStore = useFileTreeStore.getState()
          await fileTreeStore.primeProjectPath(worktreePath)
          resolve()
          return
        }

        if (target !== "checks") {
          resolve()
          return
        }

        const branchData = useProjectGitStore.getState().entriesByProjectPath[worktreePath]?.branchData
        if (branchData?.openPullRequest?.state !== "open") {
          resolve()
          return
        }

        await useProjectGitStore.getState().requestRefresh(worktreePath, {
          includePullRequestChecks: true,
          quietPullRequestChecks: true,
          debounceMs: 0,
        })
        resolve()
      })().catch((error) => {
        console.error("Failed to prewarm project data:", error)
        resolve()
      })
    }, BACKGROUND_PREWARM_DEBOUNCE_MS)
  })
}

export function prewarmProjectData(
  worktreeId: string | null,
  worktreePath: string | null,
  target: ProjectPrewarmTarget = "changes"
): Promise<void> {
  if (!worktreeId || !worktreePath) {
    return Promise.resolve()
  }

  const requestId = ++latestBackgroundPrewarmRequestId
  const chatPrewarmPromise = trackPrewarm(`${worktreeId}:${worktreePath}:chat`, async () => {
    const chatStore = useChatStore.getState()
    await chatStore.initialize()
    await chatStore.loadSessionsForProject(worktreeId, worktreePath)
  })

  return Promise.all([
    chatPrewarmPromise.catch((error) => {
      console.error("Failed to prewarm chat data:", error)
    }),
    scheduleBackgroundPrewarm(worktreePath, target, requestId),
  ]).then(() => {})
}
