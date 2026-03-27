import { create } from "zustand"
import { desktop, type GitBranchesResponse, type GitFileChange } from "@/desktop/client"

const WATCHER_REFRESH_DEBOUNCE_MS = 120

interface ProjectGitEntry {
  branchData: GitBranchesResponse | null
  changes: GitFileChange[]
  branchError: string | null
  changesError: string | null
  isBranchLoading: boolean
  isChangesLoading: boolean
}

interface RefreshRequest {
  includeBranches: boolean
  includeChanges: boolean
  quietBranches: boolean
  quietChanges: boolean
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

const EMPTY_ENTRY: ProjectGitEntry = {
  branchData: null,
  changes: [],
  branchError: null,
  changesError: null,
  isBranchLoading: false,
  isChangesLoading: false,
}

function getEntry(
  entriesByProjectPath: Record<string, ProjectGitEntry>,
  projectPath: string
): ProjectGitEntry {
  return entriesByProjectPath[projectPath] ?? EMPTY_ENTRY
}

const pendingRefreshByProject = new Map<
  string,
  RefreshRequest & { timerId: ReturnType<typeof setTimeout> | null }
>()

const inFlightBranchesByProject = new Map<string, Promise<GitBranchesResponse | null>>()
const inFlightChangesByProject = new Map<string, Promise<GitFileChange[]>>()

function mergeRefreshRequest(
  current: RefreshRequest | undefined,
  next: Partial<RefreshRequest>
): RefreshRequest {
  return {
    includeBranches: (current?.includeBranches ?? false) || (next.includeBranches ?? false),
    includeChanges: (current?.includeChanges ?? false) || (next.includeChanges ?? false),
    quietBranches: (current?.quietBranches ?? true) && (next.quietBranches ?? true),
    quietChanges: (current?.quietChanges ?? true) && (next.quietChanges ?? true),
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

async function refreshBranches(projectPath: string): Promise<GitBranchesResponse | null> {
  const existingRequest = inFlightBranchesByProject.get(projectPath)
  if (existingRequest) {
    return existingRequest
  }

  const request = desktop.git.getBranches(projectPath)
  inFlightBranchesByProject.set(projectPath, request)

  try {
    return await request
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
    set((state) => ({
      entriesByProjectPath: {
        ...state.entriesByProjectPath,
        [projectPath]: {
          ...getEntry(state.entriesByProjectPath, projectPath),
          branchData,
          branchError: null,
          isBranchLoading: false,
        },
      },
    }))
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
          quietBranches: pending.quietBranches,
          quietChanges: pending.quietChanges,
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
        },
      },
    }))

    const tasks: Promise<void>[] = []

    if (request.includeBranches) {
      tasks.push(
        refreshBranches(projectPath)
          .then((branchData) => {
            set((state) => ({
              entriesByProjectPath: {
                ...state.entriesByProjectPath,
                [projectPath]: {
                  ...getEntry(state.entriesByProjectPath, projectPath),
                  branchData,
                  branchError: null,
                  isBranchLoading: false,
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

    await Promise.all(tasks)
  },
}))
