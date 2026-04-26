import { nanoid } from "nanoid"
import { createTextMessage } from "../domain/runtimeMessages"
import type {
  HarnessAdapter,
  HarnessCreateSessionOptions,
  HarnessCommandInput,
  HarnessDefinition,
  HarnessId,
  HarnessPromptInput,
  HarnessTurnInput,
  HarnessTurnResult,
  RuntimeSession,
} from "../types"
import { DesktopRuntimeHarnessAdapter } from "./desktopRuntimeAdapter"

class PlaceholderHarnessAdapter implements HarnessAdapter {
  constructor(public definition: HarnessDefinition) {}

  async initialize(): Promise<void> {}

  async createSession(
    projectPath: string,
    options?: HarnessCreateSessionOptions
  ): Promise<RuntimeSession> {
    return {
      id: nanoid(),
      harnessId: this.definition.id,
      runtimeMode: options?.runtimeMode,
      projectPath,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  }

  async listAgents() {
    return []
  }

  async listCommands(_projectPath?: string) {
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
      turnId: input.prompt.kind === "approval" ? input.prompt.approval.turnId : `prompt:${input.prompt.id}`,
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
      supportsReasoningEffort: true,
      supportsFastMode: true,
    },
  },
  {
    id: "claude-code",
    label: "Claude Code",
    description: "Anthropic Claude Code CLI harness",
    adapterStatus: "experimental",
    capabilities: {
      supportsCommands: false,
      supportsAgentMentions: false,
      supportsFileSearch: false,
      supportsSubagents: false,
      supportsArchive: true,
      supportsDelete: true,
      supportsReasoningEffort: true,
      supportsFastMode: true,
    },
  },
  {
    id: "opencode",
    label: "OpenCode",
    description: "OpenCode local server harness",
    adapterStatus: "experimental",
    capabilities: {
      supportsCommands: true,
      supportsAgentMentions: true,
      supportsFileSearch: true,
      supportsSubagents: false,
      supportsArchive: true,
      supportsDelete: true,
      supportsReasoningEffort: false,
      supportsFastMode: false,
    },
  },
]

const HARNESS_ADAPTERS = Object.fromEntries(
  HARNESS_DEFINITIONS.map((definition) => [
    definition.id,
    new DesktopRuntimeHarnessAdapter(definition),
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
