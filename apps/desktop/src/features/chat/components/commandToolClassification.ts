export type CommandCliKind = "git" | "github"

function getStringField(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key]

    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
  }

  return null
}

export function getCommandLabel(command: unknown): string {
  if (typeof command !== "string" || !command.trim()) {
    return "command"
  }

  const normalized = command
    .replace(/^\/bin\/\w+\s+-lc\s+/, "")
    .replace(/^["'](.+)["']$/, "$1")
    .trim()

  return normalized || command
}

function getCommandExecutables(command: string): string[] {
  return getCommandLabel(command)
    .split(/\s*(?:&&|\|\||[;|])\s*/)
    .flatMap((segment) => {
      const tokens = segment.match(/"[^"]+"|'[^']+'|\S+/g) ?? []
      let index = 0

      while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(tokens[index] ?? "")) {
        index += 1
      }

      while (tokens[index] === "env" || tokens[index] === "sudo" || tokens[index] === "command") {
        index += 1

        while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(tokens[index] ?? "")) {
          index += 1
        }
      }

      const executable = tokens[index]?.replace(/^['"]|['"]$/g, "").split(/[\\/]/).at(-1)

      return executable ? [executable] : []
    })
}

export function getCommandCliKind(input: Record<string, unknown>): CommandCliKind | null {
  const command = getStringField(input, ["command", "cmd"]) ?? ""
  const executables = getCommandExecutables(command)

  if (executables.includes("gh")) {
    return "github"
  }

  if (executables.includes("git")) {
    return "git"
  }

  return null
}
