import { desktop } from "@/desktop/client"
import type {
  HarnessAdapter,
  HarnessCommandInput,
  HarnessDefinition,
  HarnessPromptInput,
  HarnessTurnInput,
  HarnessTurnResult,
  RuntimeSession,
} from "../types"

export class DesktopRuntimeHarnessAdapter implements HarnessAdapter {
  constructor(public definition: HarnessDefinition) {}

  async initialize(): Promise<void> {}

  async createSession(projectPath: string): Promise<RuntimeSession> {
    const result = await desktop.runtime.createSession({
      harnessId: this.definition.id,
      projectPath,
    })

    return result.session
  }

  async listAgents() {
    return (await desktop.runtime.listAgents({ harnessId: this.definition.id })).agents
  }

  async listCommands() {
    return (await desktop.runtime.listCommands({ harnessId: this.definition.id })).commands
  }

  async listModels() {
    return (await desktop.runtime.listModels({ harnessId: this.definition.id })).models
  }

  async searchFiles() {
    return []
  }

  async sendMessage(input: HarnessTurnInput): Promise<HarnessTurnResult> {
    const remoteId = input.session.remoteId ?? input.session.id
    const unsubscribe = desktop.runtime.onEvent((event) => {
      if (event.harnessId !== this.definition.id || event.remoteId !== remoteId) {
        return
      }

      input.onUpdate?.(event.result)
    })

    try {
      return (await desktop.runtime.sendTurn({
        harnessId: this.definition.id,
        session: input.session,
        projectPath: input.projectPath,
        text: input.text,
        agent: input.agent,
        collaborationMode: input.collaborationMode,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        fastMode: input.fastMode,
      })) as HarnessTurnResult
    } finally {
      unsubscribe()
    }
  }

  async answerPrompt(input: HarnessPromptInput): Promise<HarnessTurnResult> {
    return (await desktop.runtime.answerPrompt({
      harnessId: this.definition.id,
      session: input.session,
      projectPath: input.projectPath,
      prompt: input.prompt,
      response: input.response,
    })) as HarnessTurnResult
  }

  async executeCommand(input: HarnessCommandInput): Promise<HarnessTurnResult> {
    const now = Date.now()

    return {
      messages: [
        {
          info: {
            id: `command:${now}:message`,
            sessionId: input.session.id,
            role: "assistant",
            createdAt: now,
          },
          parts: [
            {
              id: `command:${now}:text`,
              type: "text",
              text: `${this.definition.label} does not have command execution wired up yet. Requested command: /${input.command}${input.args ? ` ${input.args}` : ""}`,
            },
          ],
        },
      ],
    }
  }

  async abortSession(session: RuntimeSession): Promise<void> {
    await desktop.runtime.interruptTurn({
      harnessId: this.definition.id,
      session,
    })
  }
}
