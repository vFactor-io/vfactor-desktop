import { create } from "zustand"
import {
  desktop,
  type GitBranchesResponse,
  type GitFileChange,
  type GitPullRequest,
  type GitPullRequestCheck,
  type GitPullRequestChecksResponse,
  type GitPullRequestComment,
  type GitPullRequestReviewComment,
  type GitPullRequestReview,
} from "@/desktop/client"

const WATCHER_REFRESH_DEBOUNCE_MS = 120
const OPTIMISTIC_CHECKS_PENDING_GRACE_MS = 30_000

interface ProjectGitEntry {
  branchData: GitBranchesResponse | null
  changes: GitFileChange[]
  pullRequestChecks: GitPullRequestCheck[]
  pullRequestComments: GitPullRequestComment[]
  pullRequestReviews: GitPullRequestReview[]
  pullRequestReviewComments: GitPullRequestReviewComment[]
  branchError: string | null
  changesError: string | null
  pullRequestChecksError: string | null
  pullRequestChecksPendingUntil: number | null
  isBranchLoading: boolean
  isChangesLoading: boolean
  isPullRequestChecksLoading: boolean
}

interface RefreshRequest {
  includeBranches: boolean
  includeChanges: boolean
  includePullRequestChecks: boolean
  quietBranches: boolean
  quietChanges: boolean
  quietPullRequestChecks: boolean
}

interface ProjectGitStoreState {
  entriesByProjectPath: Record<string, ProjectGitEntry>
  ensureEntry: (projectPath: string) => void
  setBranchData: (projectPath: string, branchData: GitBranchesResponse | null) => void
  requestRefresh: (
    projectPath: string,
    request: Partial<RefreshRequest> & { debounceMs?: number }
  ) => Promise<void>
}

function normalizePullRequestChecksPayload(
  result: GitPullRequestChecksResponse
): GitPullRequestChecksResponse {
  return {
    ...result,
    checks: Array.isArray(result.checks) ? result.checks : [],
    reviews: Array.isArray(result.reviews) ? result.reviews : [],
    comments: Array.isArray(result.comments) ? result.comments : [],
    reviewComments: Array.isArray(result.reviewComments) ? result.reviewComments : [],
  }
}

const EMPTY_ENTRY: ProjectGitEntry = {
  branchData: null,
  changes: [],
  pullRequestChecks: [],
  pullRequestComments: [],
  pullRequestReviews: [],
  pullRequestReviewComments: [],
  branchError: null,
  changesError: null,
  pullRequestChecksError: null,
  pullRequestChecksPendingUntil: null,
  isBranchLoading: false,
  isChangesLoading: false,
  isPullRequestChecksLoading: false,
}

function getEntry(
  entriesByProjectPath: Record<string, ProjectGitEntry>,
  projectPath: string
): ProjectGitEntry {
  return entriesByProjectPath[projectPath] ?? EMPTY_ENTRY
}

function getOpenPullRequestNumber(branchData: GitBranchesResponse | null): number | null {
  return branchData?.openPullRequest?.state === "open" ? branchData.openPullRequest.number : null
}

function shouldRetainPullRequestChecks(
  currentBranchData: GitBranchesResponse | null,
  nextBranchData: GitBranchesResponse | null
): boolean {
  const currentPullRequestNumber = getOpenPullRequestNumber(currentBranchData)
  const nextPullRequestNumber = getOpenPullRequestNumber(nextBranchData)

  return currentPullRequestNumber != null && currentPullRequestNumber === nextPullRequestNumber
}

function shouldPreservePendingChecks(
  entry: ProjectGitEntry,
  nextBranchData: GitBranchesResponse | null
): boolean {
  const currentPullRequest = entry.branchData?.openPullRequest
  const nextPullRequest = nextBranchData?.openPullRequest

  return Boolean(
    currentPullRequest?.state === "open" &&
      nextPullRequest?.state === "open" &&
      currentPullRequest.number === nextPullRequest.number &&
      currentPullRequest.checksStatus === "pending" &&
      nextPullRequest.checksStatus === "none" &&
      entry.pullRequestChecksPendingUntil != null &&
      Date.now() < entry.pullRequestChecksPendingUntil
  )
}

function mergePendingPullRequestState(
  currentPullRequest: GitPullRequest,
  nextPullRequest: GitPullRequest
): GitPullRequest {
  return {
    ...nextPullRequest,
    checksStatus: "pending",
    checksError: null,
    pendingChecksCount: Math.max(
      currentPullRequest.pendingChecksCount ?? 0,
      nextPullRequest.pendingChecksCount ?? 0,
      1
    ),
    failedChecksCount: 0,
    failedCheckNames: [],
    resolveReason:
      nextPullRequest.resolveReason === "failed_checks"
        ? undefined
        : nextPullRequest.resolveReason,
  }
}

function resolveBranchDataForEntry(
  entry: ProjectGitEntry,
  nextBranchData: GitBranchesResponse | null
): { branchData: GitBranchesResponse | null; pullRequestChecksPendingUntil: number | null } {
  const nextPullRequest = nextBranchData?.openPullRequest

  if (nextPullRequest?.state === "open" && nextPullRequest.checksStatus === "pending") {
    return {
      branchData: {
        ...nextBranchData,
        openPullRequest: {
          ...nextPullRequest,
          checksError: null,
          pendingChecksCount: Math.max(nextPullRequest.pendingChecksCount ?? 0, 1),
        },
      },
      pullRequestChecksPendingUntil: Math.max(
        entry.pullRequestChecksPendingUntil ?? 0,
        Date.now() + OPTIMISTIC_CHECKS_PENDING_GRACE_MS
      ),
    }
  }

  if (shouldPreservePendingChecks(entry, nextBranchData)) {
    const currentPullRequest = entry.branchData!.openPullRequest!
    return {
      branchData: {
        ...nextBranchData!,
        openPullRequest: mergePendingPullRequestState(currentPullRequest, nextPullRequest!),
      },
      pullRequestChecksPendingUntil: entry.pullRequestChecksPendingUntil,
    }
  }

  return {
    branchData: nextBranchData,
    pullRequestChecksPendingUntil: null,
  }
}

const pendingRefreshByProject = new Map<
  string,
  RefreshRequest & { timerId: ReturnType<typeof setTimeout> | null }
>()

const inFlightBranchesByProject = new Map<string, Promise<GitBranchesResponse | null>>()
const inFlightChangesByProject = new Map<string, Promise<GitFileChange[]>>()
const inFlightPullRequestChecksByProject = new Map<
  string,
  Promise<GitPullRequestChecksResponse>
>()

function mergeRefreshRequest(
  current: RefreshRequest | undefined,
  next: Partial<RefreshRequest>
): RefreshRequest {
  return {
    includeBranches: (current?.includeBranches ?? false) || (next.includeBranches ?? false),
    includeChanges: (current?.includeChanges ?? false) || (next.includeChanges ?? false),
    includePullRequestChecks:
      (current?.includePullRequestChecks ?? false) || (next.includePullRequestChecks ?? false),
    quietBranches: (current?.quietBranches ?? true) && (next.quietBranches ?? true),
    quietChanges: (current?.quietChanges ?? true) && (next.quietChanges ?? true),
    quietPullRequestChecks:
      (current?.quietPullRequestChecks ?? true) && (next.quietPullRequestChecks ?? true),
  }
}

function formatBranchLoadError(error: unknown): string {
  console.warn("[projectGitStore] Failed to load git branches:", error)
  return "Unable to load branches for this project."
}

function formatChangesLoadError(error: unknown): string {
  console.warn("[projectGitStore] Failed to load git changes:", error)
  return "Unable to load changes for this project."
}

function formatPullRequestChecksLoadError(error: unknown): string {
  console.warn("[projectGitStore] Failed to load pull request checks:", error)
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim()
  }

  return "Unable to load pull request checks for this pull request."
}

async function refreshBranches(projectPath: string): Promise<GitBranchesResponse | null> {
  const existingRequest = inFlightBranchesByProject.get(projectPath)
  if (existingRequest) {
    console.debug("[projectGitStore] refreshBranches:reuse", { projectPath })
    return existingRequest
  }

  console.debug("[projectGitStore] refreshBranches:start", { projectPath })
  const request = desktop.git.getBranches(projectPath)
  inFlightBranchesByProject.set(projectPath, request)

  try {
    const result = await request
    console.debug("[projectGitStore] refreshBranches:success", {
      projectPath,
      branchData: result
        ? {
            currentBranch: result.currentBranch,
            aheadCount: result.aheadCount,
            behindCount: result.behindCount,
            hasUpstream: result.hasUpstream,
            openPullRequest: result.openPullRequest
              ? {
                  number: result.openPullRequest.number,
                  state: result.openPullRequest.state,
                  checksStatus: result.openPullRequest.checksStatus,
                  mergeStatus: result.openPullRequest.mergeStatus,
                  resolveReason: result.openPullRequest.resolveReason,
                }
              : null,
          }
        : null,
    })
    return result
  } catch (error) {
    console.error("[projectGitStore] refreshBranches:error", { projectPath, error })
    throw error
  } finally {
    inFlightBranchesByProject.delete(projectPath)
  }
}

async function refreshChanges(projectPath: string): Promise<GitFileChange[]> {
  const existingRequest = inFlightChangesByProject.get(projectPath)
  if (existingRequest) {
    return existingRequest
  }

  const request = desktop.git.getChanges(projectPath)
  inFlightChangesByProject.set(projectPath, request)

  try {
    return await request
  } finally {
    inFlightChangesByProject.delete(projectPath)
  }
}

async function refreshPullRequestChecks(projectPath: string) {
  const existingRequest = inFlightPullRequestChecksByProject.get(projectPath)
  if (existingRequest) {
    return existingRequest
  }

  const request = desktop.git.getPullRequestChecks(projectPath)
  inFlightPullRequestChecksByProject.set(projectPath, request)

  try {
    return normalizePullRequestChecksPayload(await request)
  } finally {
    inFlightPullRequestChecksByProject.delete(projectPath)
  }
}

export const useProjectGitStore = create<ProjectGitStoreState>((set, get) => ({
  entriesByProjectPath: {},

  ensureEntry: (projectPath) => {
    set((state) => {
      if (state.entriesByProjectPath[projectPath]) {
        return state
      }

        return {
          entriesByProjectPath: {
            ...state.entriesByProjectPath,
            [projectPath]: { ...EMPTY_ENTRY },
          },
        }
      })
  },

  setBranchData: (projectPath, branchData) => {
    set((state) => {
      const currentEntry = getEntry(state.entriesByProjectPath, projectPath)
      const {
        branchData: nextBranchData,
        pullRequestChecksPendingUntil,
      } = resolveBranchDataForEntry(currentEntry, branchData)
      const shouldRetainChecks = shouldRetainPullRequestChecks(
        currentEntry.branchData,
        nextBranchData
      )

      return {
        entriesByProjectPath: {
          ...state.entriesByProjectPath,
          [projectPath]: {
            ...currentEntry,
            branchData: nextBranchData,
            pullRequestChecks: shouldRetainChecks ? currentEntry.pullRequestChecks : [],
            pullRequestComments: shouldRetainChecks ? currentEntry.pullRequestComments : [],
            pullRequestReviews: shouldRetainChecks ? currentEntry.pullRequestReviews : [],
            pullRequestReviewComments: shouldRetainChecks ? currentEntry.pullRequestReviewComments : [],
            branchError: null,
            pullRequestChecksError: shouldRetainChecks ? currentEntry.pullRequestChecksError : null,
            pullRequestChecksPendingUntil,
            isBranchLoading: false,
            isPullRequestChecksLoading: shouldRetainChecks
              ? currentEntry.isPullRequestChecksLoading
              : false,
          },
        },
      }
    })
  },

  requestRefresh: async (projectPath, request) => {
    get().ensureEntry(projectPath)

    const scheduleRequest = () => {
      const currentPending = pendingRefreshByProject.get(projectPath)
      const mergedRequest = mergeRefreshRequest(currentPending ?? undefined, request)

      if (currentPending?.timerId) {
        clearTimeout(currentPending.timerId)
      }

      const timerId = setTimeout(() => {
        const pending = pendingRefreshByProject.get(projectPath)
        if (!pending) {
          return
        }

        pendingRefreshByProject.delete(projectPath)
        void get().requestRefresh(projectPath, {
          includeBranches: pending.includeBranches,
          includeChanges: pending.includeChanges,
          includePullRequestChecks: pending.includePullRequestChecks,
          quietBranches: pending.quietBranches,
          quietChanges: pending.quietChanges,
          quietPullRequestChecks: pending.quietPullRequestChecks,
          debounceMs: 0,
        })
      }, request.debounceMs ?? WATCHER_REFRESH_DEBOUNCE_MS)

      pendingRefreshByProject.set(projectPath, {
        ...mergedRequest,
        timerId,
      })
    }

    if ((request.debounceMs ?? 0) > 0) {
      scheduleRequest()
      return
    }

    set((state) => ({
      entriesByProjectPath: {
        ...state.entriesByProjectPath,
        [projectPath]: {
          ...getEntry(state.entriesByProjectPath, projectPath),
          isBranchLoading:
            request.includeBranches && !request.quietBranches
              ? true
              : getEntry(state.entriesByProjectPath, projectPath).isBranchLoading,
          isChangesLoading:
            request.includeChanges && !request.quietChanges
              ? true
              : getEntry(state.entriesByProjectPath, projectPath).isChangesLoading,
          isPullRequestChecksLoading:
            request.includePullRequestChecks && !request.quietPullRequestChecks
              ? true
              : getEntry(state.entriesByProjectPath, projectPath).isPullRequestChecksLoading,
        },
      },
    }))

    const tasks: Promise<void>[] = []

    if (request.includeBranches) {
      tasks.push(
        refreshBranches(projectPath)
          .then((branchData) => {
            set((state) => {
              const currentEntry = getEntry(state.entriesByProjectPath, projectPath)
              const {
                branchData: nextBranchData,
                pullRequestChecksPendingUntil,
              } = resolveBranchDataForEntry(currentEntry, branchData)
              const shouldRetainChecks = shouldRetainPullRequestChecks(
                currentEntry.branchData,
                nextBranchData
              )

              return {
                entriesByProjectPath: {
                  ...state.entriesByProjectPath,
                  [projectPath]: {
                    ...currentEntry,
                    branchData: nextBranchData,
                    pullRequestChecks: shouldRetainChecks ? currentEntry.pullRequestChecks : [],
                    pullRequestComments: shouldRetainChecks ? currentEntry.pullRequestComments : [],
                    pullRequestReviews: shouldRetainChecks ? currentEntry.pullRequestReviews : [],
                    pullRequestReviewComments: shouldRetainChecks
                      ? currentEntry.pullRequestReviewComments
                      : [],
                    branchError: null,
                    pullRequestChecksError: shouldRetainChecks
                      ? currentEntry.pullRequestChecksError
                      : null,
                    pullRequestChecksPendingUntil,
                    isBranchLoading: false,
                    isPullRequestChecksLoading: shouldRetainChecks
                      ? currentEntry.isPullRequestChecksLoading
                      : false,
                  },
                },
              }
            })
          })
          .catch((error) => {
            set((state) => ({
              entriesByProjectPath: {
                ...state.entriesByProjectPath,
                [projectPath]: {
                  ...getEntry(state.entriesByProjectPath, projectPath),
                  branchError: formatBranchLoadError(error),
                  isBranchLoading: false,
                },
              },
            }))
          })
      )
    }

    if (request.includeChanges) {
      tasks.push(
        refreshChanges(projectPath)
          .then((changes) => {
            set((state) => ({
              entriesByProjectPath: {
                ...state.entriesByProjectPath,
                [projectPath]: {
                  ...getEntry(state.entriesByProjectPath, projectPath),
                  changes,
                  changesError: null,
                  isChangesLoading: false,
                },
              },
            }))
          })
          .catch((error) => {
            set((state) => ({
              entriesByProjectPath: {
                ...state.entriesByProjectPath,
                [projectPath]: {
                  ...getEntry(state.entriesByProjectPath, projectPath),
                  changesError: formatChangesLoadError(error),
                  isChangesLoading: false,
                },
              },
            }))
          })
      )
    }

    if (request.includePullRequestChecks) {
      tasks.push(
        refreshPullRequestChecks(projectPath)
          .then((result) => {
            const normalizedResult = normalizePullRequestChecksPayload(result)
            set((state) => ({
              entriesByProjectPath: (() => {
                const currentEntry = getEntry(state.entriesByProjectPath, projectPath)
                const currentPullRequest = currentEntry.branchData?.openPullRequest

                if (
                  !currentPullRequest ||
                  currentPullRequest.state !== "open" ||
                  (normalizedResult.pullRequestNumber != null &&
                    currentPullRequest.number !== normalizedResult.pullRequestNumber)
                ) {
                  return {
                    ...state.entriesByProjectPath,
                    [projectPath]: {
                      ...currentEntry,
                      isPullRequestChecksLoading: false,
                    },
                  }
                }

                return {
                  ...state.entriesByProjectPath,
                  [projectPath]: {
                    ...currentEntry,
                    pullRequestChecks: normalizedResult.error ? [] : normalizedResult.checks,
                    pullRequestComments: normalizedResult.comments,
                    pullRequestReviews: normalizedResult.reviews,
                    pullRequestReviewComments: normalizedResult.reviewComments,
                    pullRequestChecksError: normalizedResult.error ?? null,
                    isPullRequestChecksLoading: false,
                  },
                }
              })(),
            }))
          })
          .catch((error) => {
            set((state) => ({
              entriesByProjectPath: {
                ...state.entriesByProjectPath,
                [projectPath]: {
                  ...getEntry(state.entriesByProjectPath, projectPath),
                  pullRequestChecksError: formatPullRequestChecksLoadError(error),
                  isPullRequestChecksLoading: false,
                },
              },
            }))
          })
      )
    }

    await Promise.all(tasks)
  },
}))
