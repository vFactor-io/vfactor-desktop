import { readFile, writeFile } from "node:fs/promises"

type ScalarValue = boolean | number | string | null
type ManifestFileEntry = Record<string, ScalarValue>
type UpdateManifest = Record<string, ScalarValue | ManifestFileEntry[]>

function parseYamlValue(rawValue: string): ScalarValue {
  const value = rawValue.trim()

  if (value === "null") {
    return null
  }

  if (value === "true") {
    return true
  }

  if (value === "false") {
    return false
  }

  if (/^-?\d+$/.test(value)) {
    return Number(value)
  }

  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith("\"") && value.endsWith("\""))
  ) {
    return value.slice(1, -1).replace(/''/g, "'")
  }

  return value
}

function splitYamlKeyValue(line: string): [string, string] {
  const separatorIndex = line.indexOf(":")

  if (separatorIndex === -1) {
    throw new Error(`Unable to parse YAML line: ${line}`)
  }

  return [line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim()]
}

export function parseUpdateManifest(source: string): UpdateManifest {
  const manifest: UpdateManifest = {}
  const files: ManifestFileEntry[] = []
  const lines = source.split(/\r?\n/)
  let currentFile: ManifestFileEntry | null = null

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, "    ")
    const trimmed = line.trim()

    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue
    }

    if (trimmed === "files:") {
      manifest.files = files
      currentFile = null
      continue
    }

    if (line.startsWith("  - ")) {
      currentFile = {}
      files.push(currentFile)

      const inlineEntry = line.slice(4).trim()
      if (inlineEntry.length > 0) {
        const [key, rawValue] = splitYamlKeyValue(inlineEntry)
        currentFile[key] = parseYamlValue(rawValue)
      }
      continue
    }

    if (line.startsWith("    ") && currentFile) {
      const [key, rawValue] = splitYamlKeyValue(trimmed)
      currentFile[key] = parseYamlValue(rawValue)
      continue
    }

    const [key, rawValue] = splitYamlKeyValue(trimmed)
    manifest[key] = parseYamlValue(rawValue)
    currentFile = null
  }

  if (files.length > 0 && !Array.isArray(manifest.files)) {
    manifest.files = files
  }

  return manifest
}

function stringifyYamlValue(value: ScalarValue): string {
  if (value == null) {
    return "null"
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }

  if (value.length === 0 || /[:#\n\r]/.test(value) || /^\s|\s$/.test(value)) {
    return `'${value.replace(/'/g, "''")}'`
  }

  return value
}

export function stringifyUpdateManifest(manifest: UpdateManifest): string {
  const lines: string[] = []
  const preferredOrder = ["version", "files", "path", "sha512", "releaseDate"]
  const topLevelKeys = Object.keys(manifest)
  const orderedKeys = [
    ...preferredOrder.filter((key) => topLevelKeys.includes(key)),
    ...topLevelKeys.filter((key) => !preferredOrder.includes(key)).sort(),
  ]

  for (const key of orderedKeys) {
    const value = manifest[key]

    if (key === "files") {
      const files = Array.isArray(value) ? value : []
      lines.push("files:")

      for (const file of files) {
        const entries = Object.entries(file)
        if (entries.length === 0) {
          lines.push("  - {}")
          continue
        }

        const [[firstKey, firstValue], ...restEntries] = entries
        lines.push(`  - ${firstKey}: ${stringifyYamlValue(firstValue)}`)

        for (const [entryKey, entryValue] of restEntries) {
          lines.push(`    ${entryKey}: ${stringifyYamlValue(entryValue)}`)
        }
      }

      continue
    }

    if (Array.isArray(value)) {
      continue
    }

    lines.push(`${key}: ${stringifyYamlValue(value)}`)
  }

  return `${lines.join("\n")}\n`
}

function getManifestFiles(manifest: UpdateManifest): ManifestFileEntry[] {
  const files = manifest.files

  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("Mac update manifest does not contain any file entries.")
  }

  return files
}

function getFileIdentity(file: ManifestFileEntry): string {
  const url = typeof file.url === "string" ? file.url : null
  const path = typeof file.path === "string" ? file.path : null
  return url ?? path ?? JSON.stringify(file)
}

export function mergeMacUpdateManifests(
  arm64Manifest: UpdateManifest,
  x64Manifest: UpdateManifest,
): UpdateManifest {
  const armVersion =
    typeof arm64Manifest.version === "string" ? arm64Manifest.version : null
  const x64Version =
    typeof x64Manifest.version === "string" ? x64Manifest.version : null

  if (!armVersion || !x64Version) {
    throw new Error("Both mac update manifests must include a version.")
  }

  if (armVersion !== x64Version) {
    throw new Error(
      `Mac update manifests must match the same version. Received ${armVersion} and ${x64Version}.`
    )
  }

  const mergedFiles = [...getManifestFiles(arm64Manifest)]
  const seenFiles = new Set(mergedFiles.map(getFileIdentity))

  for (const file of getManifestFiles(x64Manifest)) {
    const identity = getFileIdentity(file)
    if (seenFiles.has(identity)) {
      continue
    }

    mergedFiles.push(file)
    seenFiles.add(identity)
  }

  return {
    ...arm64Manifest,
    files: mergedFiles,
  }
}

function parseCliArgs(argv: string[]) {
  const args = new Map<string, string>()

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument.startsWith("--")) {
      continue
    }

    const value = argv[index + 1]
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}.`)
    }

    args.set(argument, value)
    index += 1
  }

  const arm64 = args.get("--arm64")
  const x64 = args.get("--x64")
  const output = args.get("--output")

  if (!arm64 || !x64 || !output) {
    throw new Error("Usage: bun run scripts/merge-mac-update-manifests.ts --arm64 <path> --x64 <path> --output <path>")
  }

  return { arm64, x64, output }
}

async function main() {
  const { arm64, x64, output } = parseCliArgs(process.argv.slice(2))
  const [arm64Source, x64Source] = await Promise.all([
    readFile(arm64, "utf8"),
    readFile(x64, "utf8"),
  ])

  const merged = mergeMacUpdateManifests(
    parseUpdateManifest(arm64Source),
    parseUpdateManifest(x64Source),
  )

  await writeFile(output, stringifyUpdateManifest(merged), "utf8")
}

if (import.meta.main) {
  await main()
}
