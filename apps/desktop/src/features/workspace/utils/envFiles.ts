import { desktop } from "@/desktop/client"

export interface ProjectSecretFieldDefinition {
  key: string
  label: string
  placeholder: string
  savedValue: string
  sourceFile: string | null
  writeTargetFile: string
}

interface DefaultSecretFieldDefinition {
  key: string
  label: string
  placeholder: string
}

interface ParsedEnvFile {
  name: string
  path: string
  values: Map<string, string>
}

const DEFAULT_SECRET_FIELDS: DefaultSecretFieldDefinition[] = [
  {
    key: "OPENAI_API_KEY",
    label: "OpenAI API Key",
    placeholder: "sk-...",
  },
  {
    key: "ANTHROPIC_API_KEY",
    label: "Anthropic API Key",
    placeholder: "sk-ant-...",
  },
  {
    key: "LINEAR_API_KEY",
    label: "Linear API Key",
    placeholder: "lin_api_...",
  },
]

const ENV_LOCAL_FILES = [
  ".env.local",
  ".env.development.local",
  ".env.production.local",
  ".env.test.local",
] as const

const ENV_REFERENCE_FILES = [
  ".env",
  ".env.example",
  ".env.development",
  ".env.production",
  ".env.test",
] as const

const ENV_DISCOVERY_FILES = [...ENV_LOCAL_FILES, ...ENV_REFERENCE_FILES]

const SECRET_KEY_PATTERN =
  /(API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|ACCESS_KEY|DATABASE_URL|CONNECTION_STRING)$/i
const NON_SECRET_KEY_PATTERN = /(^NODE_ENV$|^PORT$|^HOST$|^MODE$|PUBLIC|^VITE_)/i
const SAFE_UNQUOTED_VALUE_PATTERN = /^[A-Za-z0-9_./:@+-]+$/

export async function loadProjectSecrets(
  projectPath: string,
): Promise<ProjectSecretFieldDefinition[]> {
  const parsedFiles = await readParsedEnvFiles(projectPath)
  const parsedFilesByName = new Map(parsedFiles.map((file) => [file.name, file]))
  const discoveredKeys = new Set<string>()

  for (const file of parsedFiles) {
    for (const key of file.values.keys()) {
      if (ENV_LOCAL_FILES.includes(file.name as (typeof ENV_LOCAL_FILES)[number]) || shouldIncludeEnvKey(key)) {
        discoveredKeys.add(key)
      }
    }
  }

  const fields = Array.from(discoveredKeys)
    .sort(compareSecretKeys)
    .map((key) => buildProjectSecretField(key, parsedFilesByName))

  return fields
}

export async function saveProjectSecret(
  projectPath: string,
  key: string,
  value: string,
): Promise<void> {
  const parsedFiles = await readParsedEnvFiles(projectPath)
  const existingLocalFile = ENV_LOCAL_FILES.find((fileName) =>
    parsedFiles.some((file) => file.name === fileName && file.values.has(key)),
  )
  const targetFileName = existingLocalFile ?? ".env.local"
  const targetPath = `${projectPath}/${targetFileName}`
  const existingContent = (await desktop.fs.exists(targetPath))
    ? await desktop.fs.readTextFile(targetPath)
    : ""
  const nextContent = upsertEnvValue(existingContent, key, value)

  await desktop.fs.writeTextFile(targetPath, nextContent, { create: true })
}

function buildProjectSecretField(
  key: string,
  parsedFilesByName: Map<string, ParsedEnvFile>,
): ProjectSecretFieldDefinition {
  const defaultField = DEFAULT_SECRET_FIELDS.find((field) => field.key === key)
  const localSourceFile = ENV_LOCAL_FILES.find((fileName) =>
    parsedFilesByName.get(fileName)?.values.has(key),
  )
  const referenceSourceFile = ENV_REFERENCE_FILES.find((fileName) =>
    parsedFilesByName.get(fileName)?.values.has(key),
  )
  const resolvedSourceFile = localSourceFile ?? referenceSourceFile ?? null
  const savedValue =
    resolvedSourceFile == null || resolvedSourceFile.endsWith(".example")
      ? ""
      : parsedFilesByName.get(resolvedSourceFile)?.values.get(key) ?? ""

  return {
    key,
    label: defaultField?.label ?? formatSecretLabel(key),
    placeholder: defaultField?.placeholder ?? "Enter value",
    savedValue,
    sourceFile: resolvedSourceFile,
    writeTargetFile: localSourceFile ?? ".env.local",
  }
}

async function readParsedEnvFiles(projectPath: string): Promise<ParsedEnvFile[]> {
  const parsedFiles: ParsedEnvFile[] = []

  for (const fileName of ENV_DISCOVERY_FILES) {
    const path = `${projectPath}/${fileName}`
    if (!(await desktop.fs.exists(path))) {
      continue
    }

    parsedFiles.push({
      name: fileName,
      path,
      values: parseEnvFile(await desktop.fs.readTextFile(path)),
    })
  }

  return parsedFiles
}

function parseEnvFile(content: string): Map<string, string> {
  const values = new Map<string, string>()
  const lines = content.split(/\r?\n/)

  for (const line of lines) {
    const parsedLine = parseEnvLine(line)
    if (parsedLine) {
      values.set(parsedLine.key, parsedLine.value)
    }
  }

  return values
}

function parseEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim()
  if (trimmed.length === 0 || trimmed.startsWith("#")) {
    return null
  }

  const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
  if (!match) {
    return null
  }

  return {
    key: match[1],
    value: parseEnvValue(match[2]?.trim() ?? ""),
  }
}

function parseEnvValue(rawValue: string): string {
  if (
    rawValue.length >= 2 &&
    ((rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'")))
  ) {
    const innerValue = rawValue.slice(1, -1)

    if (rawValue.startsWith('"')) {
      return innerValue
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\")
    }

    return innerValue
  }

  return rawValue.split(/\s+#/u, 1)[0]?.trim() ?? ""
}

function upsertEnvValue(content: string, key: string, value: string): string {
  const lines = content.length > 0 ? content.split(/\r?\n/) : []
  const nextLine = `${key}=${formatEnvValue(value)}`
  let didUpdateExistingLine = false

  const nextLines = lines.map((line) => {
    if (isEnvAssignmentLine(line, key)) {
      didUpdateExistingLine = true
      return nextLine
    }

    return line
  })

  if (!didUpdateExistingLine) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1]?.trim() !== "") {
      nextLines.push("")
    }
    nextLines.push(nextLine)
  }

  return nextLines.join("\n")
}

function isEnvAssignmentLine(line: string, key: string): boolean {
  return new RegExp(`^\\s*(?:export\\s+)?${escapeRegExp(key)}\\s*=`).test(line)
}

function formatEnvValue(value: string): string {
  if (value.length === 0) {
    return '""'
  }

  if (SAFE_UNQUOTED_VALUE_PATTERN.test(value)) {
    return value
  }

  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")}"`
}

function shouldIncludeEnvKey(key: string): boolean {
  if (NON_SECRET_KEY_PATTERN.test(key)) {
    return false
  }

  return SECRET_KEY_PATTERN.test(key)
}

function formatSecretLabel(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((segment) => {
      const upperSegment = segment.toUpperCase()
      if (upperSegment === "API" || upperSegment === "URL" || upperSegment === "ID") {
        return upperSegment
      }

      return segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase()
    })
    .join(" ")
}

function compareSecretKeys(left: string, right: string): number {
  const leftDefaultIndex = DEFAULT_SECRET_FIELDS.findIndex((field) => field.key === left)
  const rightDefaultIndex = DEFAULT_SECRET_FIELDS.findIndex((field) => field.key === right)

  if (leftDefaultIndex !== -1 || rightDefaultIndex !== -1) {
    if (leftDefaultIndex === -1) {
      return 1
    }
    if (rightDefaultIndex === -1) {
      return -1
    }
    return leftDefaultIndex - rightDefaultIndex
  }

  return left.localeCompare(right)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
