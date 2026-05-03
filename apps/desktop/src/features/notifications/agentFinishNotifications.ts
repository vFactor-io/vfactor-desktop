import { desktop } from "@/desktop/client"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
import { getHarnessDefinition } from "@/features/chat/runtime/harnesses"
import type { HarnessId } from "@/features/chat/types"
import { playAgentFinishSound } from "./agentFinishSounds"

interface NotifyAgentFinishedInput {
  turnId: string
  sessionId: string
  harnessId: HarnessId
  sessionTitle?: string | null
}

const notifiedTurnIds = new Set<string>()

export async function notifyAgentFinished(input: NotifyAgentFinishedInput): Promise<void> {
  if (notifiedTurnIds.has(input.turnId)) {
    return
  }

  notifiedTurnIds.add(input.turnId)

  try {
    await useSettingsStore.getState().initialize()
    const settings = useSettingsStore.getState()

    if (!settings.agentFinishNotificationsEnabled) {
      return
    }

    const harnessLabel = getHarnessDefinition(input.harnessId).label
    const result = await desktop.app.notifyAgentFinished({
      turnId: input.turnId,
      sessionId: input.sessionId,
      harnessLabel,
      sessionTitle: input.sessionTitle,
    })

    if (!result.shown || !settings.agentFinishSoundEnabled) {
      return
    }

    await playAgentFinishSound(settings.agentFinishSoundId)
  } catch (error) {
    console.warn("[agent-finish-notifications] Failed to notify:", error)
  }
}
