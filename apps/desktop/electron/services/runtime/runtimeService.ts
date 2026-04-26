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
  RuntimeProviderStatusesResult,
  RuntimeRefreshProviderStatusInput,
  RuntimeSearchFilesInput,
  RuntimeFileSearchResultSet,
  RuntimeModelsResult,
  RuntimeSendTurnInput,
  RuntimeSessionResult,
  RuntimeTurnUpdateEvent,
} from "@/desktop/contracts"
import { EVENT_CHANNELS } from "../../ipc/channels"
import { CodexServerService } from "../codexServer"
import { OpenCodeServerService } from "../opencodeServer"
import { JsonStoreService } from "../store"
import { ClaudeRuntimeProvider } from "./claudeProvider"
import { CodexRuntimeProvider } from "./codexProvider"
import { OpenCodeRuntimeProvider } from "./opencodeProvider"
import type { RuntimeProviderAdapter } from "./providerTypes"
import { ProviderRuntimeManager } from "./providerRuntimeManager"
import { ProviderSettingsService } from "./providerSettings"
import { RuntimeSessionStore } from "./runtimeSessionStore"
import {
  captureRuntimeError,
  captureRuntimeEvent,
} from "./runtimeTelemetry"

type EventSender = (channel: string, payload: unknown) => void

export class RuntimeService {
  private readonly sessionStore: RuntimeSessionStore
  private readonly providers: Record<HarnessId, RuntimeProviderAdapter>
  private readonly providerManager: ProviderRuntimeManager

  constructor(
    private readonly sendEvent: EventSender,
    storeService: JsonStoreService,
    _gitService: unknown,
    codexServerService: CodexServerService,
    openCodeServerService: OpenCodeServerService,
    providerSettingsService: ProviderSettingsService
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
      codex: new CodexRuntimeProvider(context, codexServerService, providerSettingsService),
      "claude-code": new ClaudeRuntimeProvider(context, providerSettingsService),
      opencode: new OpenCodeRuntimeProvider(
        context,
        openCodeServerService,
        providerSettingsService
      ),
    }
    this.providerManager = new ProviderRuntimeManager(
      providerSettingsService,
      (harnessId) => this.getProvider(harnessId)
    )
  }

  async createSession(input: RuntimeCreateSessionInput): Promise<RuntimeSessionResult> {
    return {
      session: await this.getProvider(input.harnessId).createSession(input.projectPath, {
        runtimeMode: input.runtimeMode,
      }),
    }
  }

  async listModels(input: RuntimeListModelsInput): Promise<RuntimeModelsResult> {
    return this.captureRuntimeOperation(
      {
        harnessId: input.harnessId,
        phase: "runtime.list_models",
      },
      async () => ({
        models: await this.getProvider(input.harnessId).listModels(),
      })
    )
  }

  async listProviderStatuses(): Promise<RuntimeProviderStatusesResult> {
    return {
      statuses: await this.providerManager.listProviderStatuses(),
    }
  }

  async refreshProviderStatus(
    input: RuntimeRefreshProviderStatusInput
  ): Promise<RuntimeProviderStatusesResult> {
    return {
      statuses: [await this.providerManager.refreshProviderStatus(input.harnessId)],
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

  async searchFiles(input: RuntimeSearchFilesInput): Promise<RuntimeFileSearchResultSet> {
    return {
      results: await this.getProvider(input.harnessId).searchFiles(
        input.query,
        input.directory
      ),
    }
  }

  async sendTurn(input: RuntimeSendTurnInput) {
    return this.captureRuntimeOperation(
      {
        harnessId: input.harnessId,
        phase: "runtime.send_turn",
        session: input.session,
        model: input.model,
        runtimeMode: input.runtimeMode,
      },
      () => this.getProvider(input.harnessId).sendTurn(this.toHarnessTurnInput(input))
    )
  }

  async answerPrompt(input: RuntimeAnswerPromptInput) {
    return this.captureRuntimeOperation(
      {
        harnessId: input.harnessId,
        phase: "runtime.answer_prompt",
        session: input.session,
      },
      () => this.getProvider(input.harnessId).answerPrompt(this.toHarnessPromptInput(input))
    )
  }

  async interruptTurn(input: RuntimeInterruptTurnInput): Promise<void> {
    return this.captureRuntimeOperation(
      {
        harnessId: input.harnessId,
        phase: "runtime.interrupt_turn",
        session: input.session,
      },
      () => this.getProvider(input.harnessId).interruptTurn(input.session)
    )
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

  private async captureRuntimeOperation<T>(
    input: Parameters<typeof captureRuntimeEvent>[1],
    operation: () => Promise<T>
  ): Promise<T> {
    const startedAt = Date.now()
    captureRuntimeEvent("runtime_operation_started", input)

    try {
      const result = await operation()
      captureRuntimeEvent("runtime_operation_completed", {
        ...input,
        durationMs: Date.now() - startedAt,
      })
      return result
    } catch (error) {
      captureRuntimeError("runtime_operation_failed", error, {
        ...input,
        durationMs: Date.now() - startedAt,
      })
      throw error
    }
  }

  private toHarnessTurnInput(input: RuntimeSendTurnInput): HarnessTurnInput {
    return {
      session: input.session,
      turnId: input.turnId,
      projectPath: input.projectPath,
      text: input.text,
      agent: input.agent,
      collaborationMode: input.collaborationMode,
      runtimeMode: input.runtimeMode,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      modelVariant: input.modelVariant,
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
