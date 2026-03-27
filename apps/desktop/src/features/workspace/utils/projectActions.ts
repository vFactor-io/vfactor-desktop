import type { Project, ProjectAction } from "@/features/workspace/types"

export function getProjectActions(project: Pick<Project, "actions"> | null | undefined): ProjectAction[] {
  return project?.actions ?? []
}

export function getPrimaryProjectAction(
  project: Pick<Project, "actions" | "primaryActionId"> | null | undefined,
): ProjectAction | null {
  const actions = getProjectActions(project)
  if (actions.length === 0) {
    return null
  }

  return actions.find((action) => action.id === project?.primaryActionId) ?? actions[0] ?? null
}

export function getProjectActionCommands(command: string): string[] {
  return command
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}
