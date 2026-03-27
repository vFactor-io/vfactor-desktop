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

export interface Project {
  id: string
  name: string       // Folder name (derived from path)
  iconPath?: string | null
  path: string       // Full filesystem path
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
