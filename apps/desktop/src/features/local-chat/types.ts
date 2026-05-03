export type AppMode = "dev" | "chat"

export interface LocalChatThread {
  id: string
  title: string
  path: string
  artifactsPath: string
  createdAt: number
  updatedAt: number
  activeSessionId: string | null
  archivedAt?: number | null
  deletedAt?: number | null
}

export interface ChatWorkspaceRef {
  kind: "dev" | "local"
  id: string | null
  path: string | null
  title?: string | null
  artifactsPath?: string | null
}

export interface ArtifactItem {
  id: string
  name: string
  path: string
  relativePath: string
  isDirectory: boolean
  sizeBytes?: number
  modifiedAt?: number
}
