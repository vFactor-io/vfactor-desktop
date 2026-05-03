import interfaceRemoveUrl from "@/assets/sounds/interface-remove.wav"
import interfaceStartUrl from "@/assets/sounds/interface-start.wav"
import magicRingUrl from "@/assets/sounds/magic-ring.wav"
import optionSelectUrl from "@/assets/sounds/option-select.wav"
import quickToneUrl from "@/assets/sounds/quick-tone.wav"
import sciFiRejectUrl from "@/assets/sounds/sci-fi-reject.wav"
import softPopUrl from "@/assets/sounds/soft-pop.wav"
import successToneUrl from "@/assets/sounds/success-tone.wav"
import tileRevealUrl from "@/assets/sounds/tile-reveal.wav"

export const AGENT_FINISH_SOUND_OPTIONS = [
  {
    id: "magic-ring",
    label: "Magic ring",
    description: "Bright notification ring",
    url: magicRingUrl,
  },
  {
    id: "success-tone",
    label: "Success tone",
    description: "Warm completion chime",
    url: successToneUrl,
  },
  {
    id: "quick-tone",
    label: "Quick tone",
    description: "Short digital ping",
    url: quickToneUrl,
  },
  {
    id: "option-select",
    label: "Option select",
    description: "Crisp interface tick",
    url: optionSelectUrl,
  },
  {
    id: "soft-pop",
    label: "Soft pop",
    description: "Rounded pop",
    url: softPopUrl,
  },
  {
    id: "tile-reveal",
    label: "Tile reveal",
    description: "Playful reveal tone",
    url: tileRevealUrl,
  },
  {
    id: "interface-start",
    label: "Interface start",
    description: "Soft startup cue",
    url: interfaceStartUrl,
  },
  {
    id: "interface-remove",
    label: "Interface remove",
    description: "Lower interface cue",
    url: interfaceRemoveUrl,
  },
  {
    id: "sci-fi-reject",
    label: "Sci-fi reject",
    description: "Sharper alert tone",
    url: sciFiRejectUrl,
  },
] as const

export type AgentFinishSoundId = (typeof AGENT_FINISH_SOUND_OPTIONS)[number]["id"]

export const DEFAULT_AGENT_FINISH_SOUND_ID: AgentFinishSoundId = "magic-ring"

export function normalizeAgentFinishSoundId(
  value: string | null | undefined
): AgentFinishSoundId {
  return AGENT_FINISH_SOUND_OPTIONS.some((option) => option.id === value)
    ? (value as AgentFinishSoundId)
    : DEFAULT_AGENT_FINISH_SOUND_ID
}

export function getAgentFinishSoundOption(soundId: AgentFinishSoundId) {
  return (
    AGENT_FINISH_SOUND_OPTIONS.find((option) => option.id === soundId) ??
    AGENT_FINISH_SOUND_OPTIONS[0]
  )
}

export async function playAgentFinishSound(soundId: AgentFinishSoundId): Promise<void> {
  const sound = getAgentFinishSoundOption(soundId)
  const audio = new Audio(sound.url)
  audio.volume = 0.72
  await audio.play()
}
