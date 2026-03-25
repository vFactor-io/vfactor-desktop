export interface GitWorkingTreeSummary {
  changedFiles: number
  additions: number
  deletions: number
}

export interface GitBranchesResponse {
  currentBranch: string
  upstreamBranch: string | null
  branches: string[]
  workingTreeSummary: GitWorkingTreeSummary
}

export interface ProjectFileSystemEvent {
  rootPath: string
  kind: "add" | "modify" | "unlink" | "rename" | "rescan"
  path: string
  oldPath?: string | null
  isDirectory: boolean
  requiresRescan: boolean
}

export interface TerminalStartResponse {
  initialData: string
}

export interface TerminalDataEvent {
  sessionId: string
  data: string
}

export interface TerminalExitEvent {
  sessionId: string
}

export interface AppUpdateInfo {
  version: string
  currentVersion: string
  notes: string | null
  pubDate: string | null
  target: string
}

export interface AppUpdateDownloadEvent {
  event: "started" | "progress" | "finished"
  chunkLength?: number | null
  downloaded?: number | null
  contentLength?: number | null
}

export interface ManagedSkill {
  id: string
  name: string
  description: string
  directoryPath: string
  entryPath: string
  body: string
  hasFrontmatter: boolean
}

export interface SkillsSyncResponse {
  managedRootPath: string
  skills: ManagedSkill[]
}

export interface DesktopDirEntry {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
}

export interface WriteTextFileOptions {
  create?: boolean
}

export interface CopyPathsIntoDirectoryOptions {
  overwrite?: boolean
}

export interface StoreValueMap {
  [key: string]: unknown
}
