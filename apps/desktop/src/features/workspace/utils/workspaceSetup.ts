import { getHarnessAdapter } from "@/features/chat/runtime/harnesses"
import type { MessageWithParts } from "@/features/chat/types"
import {
  createSlug,
  createWorkspaceDisplayName,
  getWorkspaceSlugFromBranchName,
} from "./worktrees"

export interface WorkspaceSetupSuggestion {
  branchName: string
  workspaceName: string
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "from",
  "in",
  "into",
  "it",
  "of",
  "on",
  "our",
  "please",
  "the",
  "this",
  "to",
  "we",
  "with",
])

function normalizeBranchName(value: string): string {
  const segments = value
    .trim()
    .toLowerCase()
    .split("/")
    .map((segment) => createSlug(segment))
    .filter(Boolean)

  return segments.join("/") || "task"
}

function normalizeWorkspaceName(value: string, branchName: string): string {
  const normalized = value.trim().replace(/\s+/g, " ")
  return normalized || createWorkspaceDisplayName(getWorkspaceSlugFromBranchName(branchName))
}

function getAssistantText(messages: MessageWithParts[]): string {
  type TextPart = Extract<MessageWithParts["parts"][number], { type: "text" }>

  return messages
    .flatMap((message) => message.parts)
    .filter((part): part is TextPart => part.type === "text")
    .map((part) => part.text)
    .join("\n")
}

function extractJsonCandidate(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) {
    return null
  }

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim()
  }

  const firstBrace = trimmed.indexOf("{")
  const lastBrace = trimmed.lastIndexOf("}")
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1)
  }

  return null
}

function extractBalancedJsonObjects(text: string): string[] {
  const candidates: string[] = []
  let depth = 0
  let startIndex = -1
  let inString = false
  let isEscaped = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]

    if (isEscaped) {
      isEscaped = false
      continue
    }

    if (character === "\\") {
      isEscaped = true
      continue
    }

    if (character === "\"") {
      inString = !inString
      continue
    }

    if (inString) {
      continue
    }

    if (character === "{") {
      if (depth === 0) {
        startIndex = index
      }
      depth += 1
      continue
    }

    if (character === "}" && depth > 0) {
      depth -= 1
      if (depth === 0 && startIndex >= 0) {
        candidates.push(text.slice(startIndex, index + 1))
        startIndex = -1
      }
    }
  }

  return candidates
}

export function parseWorkspaceSetupSuggestion(text: string): WorkspaceSetupSuggestion | null {
  const jsonCandidates = [
    extractJsonCandidate(text),
    ...extractBalancedJsonObjects(text),
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const jsonCandidate of jsonCandidates) {
    try {
      const parsed = JSON.parse(jsonCandidate) as {
        branchName?: unknown
        workspaceName?: unknown
      }
      const branchName =
        typeof parsed.branchName === "string" ? normalizeBranchName(parsed.branchName) : ""
      if (!branchName) {
        continue
      }

      return {
        branchName,
        workspaceName: normalizeWorkspaceName(
          typeof parsed.workspaceName === "string" ? parsed.workspaceName : "",
          branchName
        ),
      }
    } catch {
      continue
    }
  }

  return null
}

export function deriveWorkspaceSetupFallback(prompt: string): WorkspaceSetupSuggestion {
  const tokens = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !STOP_WORDS.has(token))
    .slice(0, 5)

  const branchName = normalizeBranchName(tokens.join("-") || "task")

  return {
    branchName,
    workspaceName: createWorkspaceDisplayName(getWorkspaceSlugFromBranchName(branchName)),
  }
}

export async function suggestWorkspaceSetup(input: {
  projectPath: string
  currentBranchName: string
  prompt: string
  model?: string | null
}): Promise<WorkspaceSetupSuggestion> {
  const fallback = deriveWorkspaceSetupFallback(input.prompt)
  const trimmedModel = input.model?.trim() || undefined

  console.info("[workspaceSetup] start", {
    projectPath: input.projectPath,
    currentBranchName: input.currentBranchName,
    model: trimmedModel ?? null,
    prompt: input.prompt.trim(),
    fallback,
  })

  try {
    const adapter = getHarnessAdapter("codex")
    await adapter.initialize()
    console.info("[workspaceSetup] adapter initialized")

    const session = await adapter.createSession(input.projectPath)
    console.info("[workspaceSetup] session created", {
      sessionId: session.id,
      remoteId: session.remoteId ?? null,
      projectPath: session.projectPath ?? null,
    })

    const result = await adapter.sendMessage({
      session,
      projectPath: input.projectPath,
      model: trimmedModel,
      text: [
        "You are preparing a brand-new coding workspace before the real task starts.",
        "Read the user's first message, inspect the repository briefly if needed, and respond with JSON only.",
        'Return exactly: {"branchName":"...","workspaceName":"..."}',
        "Rules:",
        "- branchName must be concise, lowercase, and use slash-separated kebab-case when helpful",
        "- workspaceName should be short and human-readable",
        "- do not include markdown fences or explanations",
        "- do not edit files or run mutating commands",
        `Current temporary branch: ${input.currentBranchName}`,
        `User request: ${input.prompt.trim()}`,
      ].join("\n"),
    })

    const assistantText = getAssistantText(result.messages ?? [])
    const parsed = parseWorkspaceSetupSuggestion(assistantText)

    console.info("[workspaceSetup] response received", {
      sessionId: session.id,
      remoteId: session.remoteId ?? null,
      messageCount: result.messages?.length ?? 0,
      assistantText,
      parsed,
    })

    if (!parsed) {
      console.warn("[workspaceSetup] parsed response was empty; using fallback", {
        fallback,
      })
    }

    return parsed ?? fallback
  } catch (error) {
    console.warn("[workspaceSetup] Falling back to local naming:", error)
    return fallback
  }
}
