import type { ShortcutBinding } from "@/features/settings/shortcuts"
import type { ProjectActionIconName } from "@/features/workspace/utils/projectActionIcons"

export interface Workspace {
  id: string
  branchName: string
  name: string
  lastActive: Date
  diffCount?: number
  isLoading?: boolean
  needsAttention?: boolean
}

export interface Repository {
  id: string
  name: string
  path: string
  collapsed: boolean
  workspaces: Workspace[]
}

export type ProjectWorktreeSource = "root" | "managed"

export type ProjectWorktreeStatus = "ready" | "creating" | "error"
export type ProjectWorktreeIntentStatus = "pending" | "configured"

export interface ProjectWorktree {
  id: string
  name: string
  branchName: string
  path: string
  createdAt: number
  updatedAt: number
  source: ProjectWorktreeSource
  status: ProjectWorktreeStatus
  intentStatus: ProjectWorktreeIntentStatus
}

export interface Project {
  id: string
  name: string       // Folder name (derived from path)
  iconPath?: string | null
  faviconPath?: string | null
  path: string       // Full filesystem path
  repoRootPath: string
  workspacesPath?: string | null
  rootWorktreeId: string | null
  selectedWorktreeId: string | null
  targetBranch: string | null
  remoteName?: string | null
  setupScript?: string | null
  hiddenWorktreePaths?: string[]
  worktrees: ProjectWorktree[]
  addedAt: number    // Timestamp when added (for ordering)
  actions?: ProjectAction[]
  primaryActionId?: string | null
}

export interface ProjectAction {
  id: string
  name: string
  iconName?: ProjectActionIconName | null
  iconPath?: string | null
  hotkey?: ShortcutBinding | null
  command: string
  createdAt: number
}
