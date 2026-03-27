import { useState, useEffect, useCallback } from "react"
import { desktop } from "@/desktop/client"
import { useProjectStore } from "@/features/workspace/store"
import { useChatStore } from "../store/chatStore"
import type { SkillsSyncResponse } from "@/features/skills/types"

export interface NormalizedCommand {
  name: string
  description: string
  kind: "builtin" | "custom"
  agent?: string
  model?: string
  isPreview?: boolean
  referenceName?: string
}

const BUILTIN_PREVIEW_COMMANDS: NormalizedCommand[] = [
  {
    name: "OpenAI Docs",
    description: "Reference official OpenAI docs, including upgrade guidance.",
    kind: "builtin",
    isPreview: true,
    referenceName: "openai-docs",
  },
  {
    name: "Skill Creator",
    description: "Create or update a skill.",
    kind: "builtin",
    isPreview: true,
    referenceName: "skill-creator",
  },
]

export function useCommands() {
  const { selectedProjectId } = useProjectStore()
  const listCommands = useChatStore((state) => state.listCommands)
  const [commands, setCommands] = useState<NormalizedCommand[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchCommands = useCallback(async () => {
    if (!selectedProjectId) {
      setCommands([])
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const [rawCommands, installedSkillsResponse] = await Promise.all([
        listCommands(selectedProjectId),
        desktop.skills.list().catch(() => null as SkillsSyncResponse | null),
      ])
      const installedSkillCommands: NormalizedCommand[] =
        installedSkillsResponse?.skills.map((skill) => ({
          name: skill.name,
          description: skill.description ?? "",
          kind: "custom",
          isPreview: true,
          referenceName: skill.id,
        })) ?? []
      const previewByName = new Map(
        installedSkillCommands.map((command) => [command.name.toLowerCase(), command])
      )

      const normalized: NormalizedCommand[] = rawCommands.map((cmd) => ({
        name: cmd.name,
        description: cmd.description ?? "",
        kind: cmd.kind,
        agent: cmd.agent,
        model: cmd.model,
        referenceName: previewByName.get(cmd.name.toLowerCase())?.referenceName,
      }))

      const merged = [
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

      merged.sort((a, b) => {
        if (a.kind !== b.kind) {
          return a.kind === "custom" ? -1 : 1
        }
        return a.name.localeCompare(b.name)
      })

      setCommands(merged)
    } catch (err) {
      console.error("[useCommands] Failed to fetch commands:", err)
      setError(String(err))
      setCommands(BUILTIN_PREVIEW_COMMANDS)
    } finally {
      setIsLoading(false)
    }
  }, [listCommands, selectedProjectId])

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
