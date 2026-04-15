import { create } from "zustand"

interface BrowserSidebarEntry {
  url: string
}

interface BrowserSidebarState {
  entriesByWorktreeId: Record<string, BrowserSidebarEntry>
  setUrl: (worktreeId: string, url: string) => void
}

export const useBrowserSidebarStore = create<BrowserSidebarState>((set) => ({
  entriesByWorktreeId: {},
  setUrl: (worktreeId, url) =>
    set((state) => ({
      entriesByWorktreeId: {
        ...state.entriesByWorktreeId,
        [worktreeId]: { url },
      },
    })),
}))

export function getBrowserUrlForWorktree(
  entriesByWorktreeId: Record<string, BrowserSidebarEntry>,
  worktreeId: string | null
) {
  if (!worktreeId) {
    return null
  }

  return entriesByWorktreeId[worktreeId]?.url ?? null
}
