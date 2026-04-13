import type {
  HarnessCommandInput,
  HarnessId,
  HarnessPromptInput,
  HarnessTurnInput,
  HarnessTurnResult,
  RuntimeAgent,
  RuntimeCommand,
  RuntimeModel,
  RuntimeSession,
} from "@/features/chat/types"

export interface PersistedRuntimeSessionMetadata {
  harnessId: HarnessId
  projectPath: string
  state: Record<string, unknown>
  updatedAt: number
}

export interface RuntimeProviderPersistence {
  load: (remoteId: string) => Promise<PersistedRuntimeSessionMetadata | null>
  save: (remoteId: string, metadata: PersistedRuntimeSessionMetadata) => Promise<void>
  delete: (remoteId: string) => Promise<void>
}

export interface RuntimeProviderContext {
  emitUpdate: (remoteId: string, harnessId: HarnessId, result: HarnessTurnResult) => void
  persistence: RuntimeProviderPersistence
}

export interface RuntimeProviderAdapter {
  harnessId: HarnessId
  createSession: (projectPath: string) => Promise<RuntimeSession>
  listAgents: () => Promise<RuntimeAgent[]>
  listCommands: (projectPath?: string) => Promise<RuntimeCommand[]>
  listModels: () => Promise<RuntimeModel[]>
  sendTurn: (input: HarnessTurnInput) => Promise<HarnessTurnResult>
  answerPrompt: (input: HarnessPromptInput) => Promise<HarnessTurnResult>
  executeCommand?: (input: HarnessCommandInput) => Promise<HarnessTurnResult>
  interruptTurn: (session: RuntimeSession) => Promise<void>
  getActiveTurnCount: () => number
  dispose: () => void | Promise<void>
}
