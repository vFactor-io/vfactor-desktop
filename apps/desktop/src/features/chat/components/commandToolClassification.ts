export type CommandCliKind = "git" | "github"

const SHELL_LAUNCHERS = new Set(["bash", "sh", "zsh"])
const SHELL_COMMAND_FLAGS = new Set(["-c", "-lc"])
const COMMAND_WRAPPERS = new Set(["command", "env", "sudo"])
const MAX_SHELL_UNWRAP_DEPTH = 8

function getStringField(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key]

    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
  }

  return null
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim()
  const quote = trimmed[0]

  if ((quote === "\"" || quote === "'") && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1).replace(/\\"/g, "\"").replace(/\\'/g, "'")
  }

  return trimmed
}

function getCommandTokens(command: string): string[] {
  return command.match(/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|\S+/g) ?? []
}

function getExecutableName(token: string | undefined): string | null {
  if (!token) {
    return null
  }

  const executable = stripWrappingQuotes(token).split(/[\\/]/).at(-1)?.toLowerCase()

  return executable?.replace(/\.(?:exe|cmd|bat|ps1)$/i, "") ?? null
}

function getShellCommandArgument(tokens: string[]): string | null {
  const shellName = getExecutableName(tokens[0])

  if (!shellName || !SHELL_LAUNCHERS.has(shellName)) {
    return null
  }

  const commandFlagIndex = tokens.findIndex((token) => SHELL_COMMAND_FLAGS.has(stripWrappingQuotes(token)))

  if (commandFlagIndex === -1) {
    return null
  }

  const commandArgument = tokens[commandFlagIndex + 1]

  return commandArgument ? stripWrappingQuotes(commandArgument) : null
}

function unwrapShellLaunchers(command: string): string {
  let current = stripWrappingQuotes(command)

  for (let depth = 0; depth < MAX_SHELL_UNWRAP_DEPTH; depth += 1) {
    const next = getShellCommandArgument(getCommandTokens(current))

    if (!next || next === current) {
      break
    }

    current = stripWrappingQuotes(next)
  }

  return current
}

export function getCommandLabel(command: unknown): string {
  if (typeof command !== "string" || !command.trim()) {
    return "command"
  }

  const normalized = unwrapShellLaunchers(command).trim()

  return normalized || command
}

function getCommandExecutables(command: string): string[] {
  return getCommandLabel(command)
    .split(/\s*(?:&&|\|\||[;|])\s*/)
    .flatMap((segment) => {
      const tokens = getCommandTokens(segment)
      let index = 0

      while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(tokens[index] ?? "")) {
        index += 1
      }

      while (COMMAND_WRAPPERS.has(getExecutableName(tokens[index]) ?? "")) {
        index += 1

        while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(tokens[index] ?? "")) {
          index += 1
        }
      }

      const executable = getExecutableName(tokens[index] ?? "")

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
