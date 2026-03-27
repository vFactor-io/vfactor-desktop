import type { Icon } from "@/components/icons"
import {
  Bash,
  ChatCircle,
  CheckCircle,
  Clock,
  Cloud,
  Command,
  Commit,
  Compass,
  DocumentValidation,
  FileCode,
  FileJs,
  FilePy,
  FileRs,
  FileText,
  FileTs,
  Folder,
  FolderOpen,
  GearSix,
  GitBranch,
  GitPullRequest,
  Globe,
  Lightbulb,
  MagnifyingGlass,
  Play,
  PlusSquare,
  Refresh,
  Robot,
  Square,
  Terminal,
  Zap,
} from "@/components/icons"

export const PROJECT_ACTION_ICON_OPTIONS = [
  { id: "play", label: "Run", icon: Play },
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "command", label: "Command", icon: Command },
  { id: "zap", label: "Zap", icon: Zap },
  { id: "git-branch", label: "Branch", icon: GitBranch },
  { id: "git-pull-request", label: "Pull request", icon: GitPullRequest },
  { id: "commit", label: "Commit", icon: Commit },
  { id: "folder", label: "Folder", icon: Folder },
  { id: "folder-open", label: "Folder open", icon: FolderOpen },
  { id: "file-code", label: "Code", icon: FileCode },
  { id: "file-text", label: "Text", icon: FileText },
  { id: "file-ts", label: "TypeScript", icon: FileTs },
  { id: "file-js", label: "JavaScript", icon: FileJs },
  { id: "file-py", label: "Python", icon: FilePy },
  { id: "file-rs", label: "Rust", icon: FileRs },
  { id: "globe", label: "Web", icon: Globe },
  { id: "search", label: "Search", icon: MagnifyingGlass },
  { id: "lightbulb", label: "Idea", icon: Lightbulb },
  { id: "robot", label: "Robot", icon: Robot },
  { id: "refresh", label: "Refresh", icon: Refresh },
  { id: "check", label: "Check", icon: CheckCircle },
  { id: "clock", label: "Clock", icon: Clock },
  { id: "document", label: "Document", icon: DocumentValidation },
  { id: "cloud", label: "Cloud", icon: Cloud },
  { id: "compass", label: "Compass", icon: Compass },
  { id: "bash", label: "Shell", icon: Bash },
  { id: "square", label: "Stop", icon: Square },
  { id: "plus-square", label: "Add", icon: PlusSquare },
  { id: "chat", label: "Chat", icon: ChatCircle },
  { id: "gear", label: "Settings", icon: GearSix },
] as const satisfies ReadonlyArray<{
  id: string
  label: string
  icon: Icon
}>

export type ProjectActionIconName = (typeof PROJECT_ACTION_ICON_OPTIONS)[number]["id"]

const PROJECT_ACTION_ICON_NAME_SET = new Set<string>(
  PROJECT_ACTION_ICON_OPTIONS.map((option) => option.id),
)

export function normalizeProjectActionIconName(
  value: string | null | undefined,
): ProjectActionIconName | null {
  const trimmed = value?.trim()
  if (!trimmed || !PROJECT_ACTION_ICON_NAME_SET.has(trimmed)) {
    return null
  }

  return trimmed as ProjectActionIconName
}

export function getProjectActionIconOption(
  value: string | null | undefined,
): (typeof PROJECT_ACTION_ICON_OPTIONS)[number] | null {
  const normalized = normalizeProjectActionIconName(value)
  if (!normalized) {
    return null
  }

  return PROJECT_ACTION_ICON_OPTIONS.find((option) => option.id === normalized) ?? null
}
