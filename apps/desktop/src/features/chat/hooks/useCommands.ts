import { useState, useEffect, useCallback } from "react"
import { desktop } from "@/desktop/client"
import type { SkillsSyncResponse } from "@/features/skills/types"
import type { ProjectAction } from "@/features/workspace/types"
import { getHarnessAdapter } from "../runtime/harnesses"
import type { HarnessId } from "../types"

export interface NormalizedCommand {
  id: string
  name: string
  description: string
  kind: "builtin" | "custom"
  section: "actions" | "custom-actions" | "skills"
  execution: "insert" | "run"
  action?: "new-chat" | "new-terminal"
  icon?: "skill" | "new-chat" | "new-terminal"
  agent?: string
  model?: string
  isPreview?: boolean
  referenceName?: string
  projectAction?: ProjectAction
}

const ACTION_COMMANDS: NormalizedCommand[] = [
  {
    id: "action:new-chat",
    name: "New Chat",
    description: "Open a new chat tab in the current project.",
    kind: "builtin",
    section: "actions",
    execution: "run",
    action: "new-chat",
    icon: "new-chat",
  },
  {
    id: "action:new-terminal",
    name: "New Terminal",
    description: "Open a new terminal tab in the current project.",
    kind: "builtin",
    section: "actions",
    execution: "run",
    action: "new-terminal",
    icon: "new-terminal",
  },
]

const BUILTIN_PREVIEW_COMMANDS: NormalizedCommand[] = [
  {
    id: "builtin:openai-docs",
    name: "OpenAI Docs",
    description: "Reference official OpenAI docs, including upgrade guidance.",
    kind: "builtin",
    section: "skills",
    execution: "insert",
    isPreview: true,
    referenceName: "openai-docs",
    icon: "skill",
  },
  {
    id: "builtin:skill-creator",
    name: "Skill Creator",
    description: "Create or update a skill.",
    kind: "builtin",
    section: "skills",
    execution: "insert",
    isPreview: true,
    referenceName: "skill-creator",
    icon: "skill",
  },
]

export function useCommands(harnessId: HarnessId | null, projectActions: ProjectAction[] = []) {
  const [commands, setCommands] = useState<NormalizedCommand[]>(ACTION_COMMANDS)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchCommands = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const [rawCommands, installedSkillsResponse] = await Promise.all([
        getHarnessAdapter(harnessId ?? "codex").listCommands(),
        desktop.skills.list().catch(() => null as SkillsSyncResponse | null),
      ])
      const installedSkillCommands: NormalizedCommand[] =
        installedSkillsResponse?.skills.map((skill) => ({
          id: `skill:${skill.id}`,
          name: skill.name,
          description: skill.description ?? "",
          kind: "custom",
          section: "skills",
          execution: "insert",
          isPreview: true,
          referenceName: skill.id,
          icon: "skill",
        })) ?? []
      const previewByName = new Map(
        installedSkillCommands.map((command) => [command.name.toLowerCase(), command])
      )

      const normalized: NormalizedCommand[] = rawCommands.map((cmd) => ({
        id: `command:${cmd.name.toLowerCase().replace(/\s+/g, "-")}`,
        name: cmd.name,
        description: cmd.description ?? "",
        kind: cmd.kind,
        section: "skills",
        execution: "insert",
        agent: cmd.agent,
        model: cmd.model,
        referenceName: previewByName.get(cmd.name.toLowerCase())?.referenceName,
        icon: "skill",
      }))

      const skillCommands = [
        ...normalized,
        ...installedSkillCommands.filter(
          (mockCommand) =>
            !normalized.some(
              (command) => command.name.toLowerCase() === mockCommand.name.toLowerCase()
            )
        ),
        ...BUILTIN_PREVIEW_COMMANDS.filter(
          (mockCommand) =>
            !normalized.some(
              (command) => command.name.toLowerCase() === mockCommand.name.toLowerCase()
            ) &&
            !installedSkillCommands.some(
              (command) => command.name.toLowerCase() === mockCommand.name.toLowerCase()
            )
        ),
      ]

      skillCommands.sort((a, b) => {
        if (a.kind !== b.kind) {
          return a.kind === "custom" ? -1 : 1
        }
        return a.name.localeCompare(b.name)
      })

      const projectActionCommands: NormalizedCommand[] = projectActions.map((action) => ({
        id: `project-action:${action.id}`,
        name: action.name,
        description: "Run this project action in the current worktree terminal.",
        kind: "custom",
        section: "custom-actions",
        execution: "run",
        projectAction: action,
      }))

      setCommands([...ACTION_COMMANDS, ...projectActionCommands, ...skillCommands])
    } catch (err) {
      console.error("[useCommands] Failed to fetch commands:", err)
      setError(String(err))
      const projectActionCommands: NormalizedCommand[] = projectActions.map((action) => ({
        id: `project-action:${action.id}`,
        name: action.name,
        description: "Run this project action in the current worktree terminal.",
        kind: "custom",
        section: "custom-actions",
        execution: "run",
        projectAction: action,
      }))
      setCommands([...ACTION_COMMANDS, ...projectActionCommands, ...BUILTIN_PREVIEW_COMMANDS])
    } finally {
      setIsLoading(false)
    }
  }, [harnessId, projectActions])

  useEffect(() => {
    fetchCommands()
  }, [fetchCommands])

  return {
    commands,
    isLoading,
    error,
    refetch: fetchCommands,
  }
}

export function filterCommands(
  commands: NormalizedCommand[],
  query: string
): NormalizedCommand[] {
  const lowerQuery = query.toLowerCase()
  
  if (!lowerQuery) {
    return commands
  }

  return commands.filter(
    (cmd) =>
      cmd.name.toLowerCase().includes(lowerQuery) ||
      cmd.description.toLowerCase().includes(lowerQuery)
  )
}
