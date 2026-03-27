import { readdir, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import os from "node:os"
import type { SkillsSyncResponse } from "../../src/desktop/contracts"

interface ParsedSkillDocument {
  name: string | null
  description: string | null
  body: string
  hasFrontmatter: boolean
}

function parseSkillDocument(content: string): ParsedSkillDocument {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith("---")) {
    return {
      name: null,
      description: null,
      body: content.trim(),
      hasFrontmatter: false,
    }
  }

  const lines = trimmed.split(/\r?\n/)
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---")
  if (closingIndex === -1) {
    return {
      name: null,
      description: null,
      body: content.trim(),
      hasFrontmatter: false,
    }
  }

  const frontmatter = lines.slice(1, closingIndex)
  const body = lines.slice(closingIndex + 1).join("\n").trim()
  const fields = new Map<string, string>()

  for (const line of frontmatter) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.+)\s*$/)
    if (!match) {
      continue
    }
    fields.set(match[1].toLowerCase(), match[2].trim())
  }

  return {
    name: fields.get("name") ?? null,
    description: fields.get("description") ?? null,
    body,
    hasFrontmatter: true,
  }
}

function fallbackSkillName(skillId: string, body: string): string {
  const heading = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("# "))

  return heading?.replace(/^#\s+/, "").trim() || skillId
}

function fallbackSkillDescription(body: string): string {
  const paragraph = body
    .split(/\r?\n\r?\n/)
    .map((section) => section.replace(/^#+\s+/gm, "").trim())
    .find(Boolean)

  return paragraph ?? ""
}

export class SkillsService {
  async list(): Promise<SkillsSyncResponse> {
    const managedRootPath = join(os.homedir(), ".agents", "skills")

    if (!existsSync(managedRootPath)) {
      return {
        managedRootPath,
        skills: [],
      }
    }

    const entries = await readdir(managedRootPath, { withFileTypes: true })
    const skills = []

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }

      const directoryPath = join(managedRootPath, entry.name)
      const entryPath = join(directoryPath, "SKILL.md")

      if (!existsSync(entryPath)) {
        continue
      }

      let content = ""
      try {
        content = await readFile(entryPath, "utf8")
      } catch (error) {
        console.warn(`[skills] Failed to read ${entryPath}:`, error)
        continue
      }

      const parsed = parseSkillDocument(content)

      skills.push({
        id: entry.name,
        name: parsed.name?.trim() || fallbackSkillName(entry.name, parsed.body),
        description:
          parsed.description?.trim() || fallbackSkillDescription(parsed.body),
        directoryPath,
        entryPath,
        body: parsed.body,
        hasFrontmatter: parsed.hasFrontmatter,
      })
    }

    skills.sort((left, right) => left.name.localeCompare(right.name))

    return {
      managedRootPath,
      skills,
    }
  }
}
