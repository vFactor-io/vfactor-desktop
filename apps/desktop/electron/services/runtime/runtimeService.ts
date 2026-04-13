import type {
  HarnessId,
  HarnessPromptInput,
  HarnessTurnInput,
  RuntimeSession,
} from "@/features/chat/types"
import type {
  RuntimeAnswerPromptInput,
  RuntimeAgentsResult,
  RuntimeCommandsResult,
  RuntimeCreateSessionInput,
  RuntimeInterruptTurnInput,
  RuntimeListAgentsInput,
  RuntimeListCommandsInput,
  RuntimeListModelsInput,
  RuntimeModelsResult,
  RuntimeSendTurnInput,
  RuntimeSessionResult,
  RuntimeTurnUpdateEvent,
} from "@/desktop/contracts"
import { EVENT_CHANNELS } from "../../ipc/channels"
import { CodexServerService } from "../codexServer"
import { GitService } from "../git"
import { JsonStoreService } from "../store"
import { ClaudeRuntimeProvider } from "./claudeProvider"
import { CodexRuntimeProvider } from "./codexProvider"
import type { RuntimeProviderAdapter } from "./providerTypes"
import { RuntimeSessionStore } from "./runtimeSessionStore"

type EventSender = (channel: string, payload: unknown) => void

export class RuntimeService {
  private readonly sessionStore: RuntimeSessionStore
  private readonly providers: Record<HarnessId, RuntimeProviderAdapter>

  constructor(
    private readonly sendEvent: EventSender,
    storeService: JsonStoreService,
    gitService: GitService,
    codexServerService: CodexServerService
  ) {
    this.sessionStore = new RuntimeSessionStore(storeService)
    const context = {
      emitUpdate: (remoteId: string, harnessId: HarnessId, result: RuntimeTurnUpdateEvent["result"]) => {
        this.emitRuntimeEvent({
          harnessId,
          remoteId,
          result,
        })
      },
      persistence: {
        load: (remoteId: string) => this.sessionStore.get(remoteId),
        save: (remoteId: string, metadata: Parameters<RuntimeSessionStore["set"]>[1]) =>
          this.sessionStore.set(remoteId, metadata),
        delete: (remoteId: string) => this.sessionStore.delete(remoteId),
      },
    }

    this.providers = {
      codex: new CodexRuntimeProvider(context, gitService, codexServerService),
      "claude-code": new ClaudeRuntimeProvider(context),
    }
  }

  async createSession(input: RuntimeCreateSessionInput): Promise<RuntimeSessionResult> {
    return {
      session: await this.getProvider(input.harnessId).createSession(input.projectPath),
    }
  }

  async listModels(input: RuntimeListModelsInput): Promise<RuntimeModelsResult> {
    return {
      models: await this.getProvider(input.harnessId).listModels(),
    }
  }

  async listAgents(input: RuntimeListAgentsInput): Promise<RuntimeAgentsResult> {
    return {
      agents: await this.getProvider(input.harnessId).listAgents(),
    }
  }

  async listCommands(input: RuntimeListCommandsInput): Promise<RuntimeCommandsResult> {
    return {
      commands: await this.getProvider(input.harnessId).listCommands(input.projectPath),
    }
  }

  async sendTurn(input: RuntimeSendTurnInput) {
    return this.getProvider(input.harnessId).sendTurn(
      this.toHarnessTurnInput(input)
    )
  }

  async answerPrompt(input: RuntimeAnswerPromptInput) {
    return this.getProvider(input.harnessId).answerPrompt(
      this.toHarnessPromptInput(input)
    )
  }

  async interruptTurn(input: RuntimeInterruptTurnInput): Promise<void> {
    return this.getProvider(input.harnessId).interruptTurn(input.session)
  }

  getActiveTurnCount(): number {
    return Object.values(this.providers).reduce(
      (total, provider) => total + provider.getActiveTurnCount(),
      0
    )
  }

  dispose(): void {
    for (const provider of Object.values(this.providers)) {
      void provider.dispose()
    }
  }

  private emitRuntimeEvent(event: RuntimeTurnUpdateEvent): void {
    this.sendEvent(EVENT_CHANNELS.runtimeEvent, event)
  }

  private getProvider(harnessId: HarnessId): RuntimeProviderAdapter {
    const provider = this.providers[harnessId]
    if (!provider) {
      throw new Error(`Unsupported runtime provider: ${harnessId}`)
    }

    return provider
  }

  private toHarnessTurnInput(input: RuntimeSendTurnInput): HarnessTurnInput {
    return {
      session: input.session,
      projectPath: input.projectPath,
      text: input.text,
      agent: input.agent,
      collaborationMode: input.collaborationMode,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      fastMode: input.fastMode,
    }
  }

  private toHarnessPromptInput(input: RuntimeAnswerPromptInput): HarnessPromptInput {
    return {
      session: input.session,
      projectPath: input.projectPath,
      prompt: input.prompt,
      response: input.response,
    }
  }
}
