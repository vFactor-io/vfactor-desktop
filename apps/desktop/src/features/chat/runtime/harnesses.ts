import { nanoid } from "nanoid"
import { createTextMessage } from "../domain/runtimeMessages"
import type {
  HarnessAdapter,
  HarnessCommandInput,
  HarnessDefinition,
  HarnessId,
  HarnessPromptInput,
  HarnessTurnInput,
  HarnessTurnResult,
  RuntimeSession,
} from "../types"
import { CodexHarnessAdapter } from "./codexAdapter"

class PlaceholderHarnessAdapter implements HarnessAdapter {
  constructor(public definition: HarnessDefinition) {}

  async initialize(): Promise<void> {}

  async createSession(projectPath: string): Promise<RuntimeSession> {
    return {
      id: nanoid(),
      harnessId: this.definition.id,
      projectPath,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  }

  async listAgents() {
    return []
  }

  async listCommands() {
    return []
  }

  async listModels() {
    return []
  }

  async searchFiles() {
    return []
  }

  async sendMessage(input: HarnessTurnInput): Promise<HarnessTurnResult> {
    return {
      messages: [
        createTextMessage(
          input.session.id,
          "assistant",
          `${this.definition.label} is selected for this chat, but the runtime adapter is not wired up yet. This session is now using the shared UI layer instead of the old OpenCode integration.`
        ),
      ],
    }
  }

  async answerPrompt(input: HarnessPromptInput): Promise<HarnessTurnResult> {
    return this.sendMessage({
      session: input.session,
      projectPath: input.projectPath,
      text: input.response.text,
    })
  }

  async executeCommand(input: HarnessCommandInput): Promise<HarnessTurnResult> {
    return {
      messages: [
        createTextMessage(
          input.session.id,
          "assistant",
          `${this.definition.label} does not have command execution wired up yet. The requested command was \`/${input.command}\`.`
        ),
      ],
    }
  }

  async abortSession(): Promise<void> {}
}

const HARNESS_DEFINITIONS: HarnessDefinition[] = [
  {
    id: "codex",
    label: "Codex",
    description: "OpenAI Codex App Server / CLI harness",
    adapterStatus: "experimental",
    capabilities: {
      supportsCommands: false,
      supportsAgentMentions: false,
      supportsFileSearch: false,
      supportsSubagents: false,
      supportsArchive: true,
      supportsDelete: true,
    },
  },
  {
    id: "claude-code",
    label: "Claude Code",
    description: "Anthropic Claude Code CLI harness",
    adapterStatus: "planned",
    capabilities: {
      supportsCommands: false,
      supportsAgentMentions: false,
      supportsFileSearch: false,
      supportsSubagents: false,
      supportsArchive: true,
      supportsDelete: true,
    },
  },
]

const HARNESS_ADAPTERS = Object.fromEntries(
  HARNESS_DEFINITIONS.map((definition) => [
    definition.id,
    definition.id === "codex"
      ? new CodexHarnessAdapter(definition)
      : new PlaceholderHarnessAdapter(definition),
  ])
) as unknown as Record<HarnessId, HarnessAdapter>

export function listHarnesses(): HarnessDefinition[] {
  return HARNESS_DEFINITIONS
}

export function getHarnessDefinition(id: HarnessId): HarnessDefinition {
  return HARNESS_DEFINITIONS.find((harness) => harness.id === id) ?? HARNESS_DEFINITIONS[0]
}

export function getHarnessAdapter(id: HarnessId): HarnessAdapter {
  return HARNESS_ADAPTERS[id]
}

export const DEFAULT_HARNESS_ID: HarnessId = "codex"
