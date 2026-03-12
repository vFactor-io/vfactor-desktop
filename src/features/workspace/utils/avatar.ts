const DICEBEAR_BOTTTS_NEUTRAL_BASE_URL = "https://api.dicebear.com/9.x/bottts-neutral/svg"
const AGENT_AVATAR_BACKGROUND_COLORS = [
  "334155",
  "1d4ed8",
  "0369a1",
  "0f766e",
  "047857",
  "3f3f46",
  "854d0e",
  "b45309",
  "9a3412",
  "be123c",
  "1f2937",
  "155e75",
]

export function createAgentAvatarSeed(): string {
  return crypto.randomUUID()
}

export function getAgentAvatarUrl(seed: string): string {
  const params = new URLSearchParams({
    seed,
    backgroundType: "solid",
    backgroundColor: AGENT_AVATAR_BACKGROUND_COLORS.join(","),
  })

  return `${DICEBEAR_BOTTTS_NEUTRAL_BASE_URL}?${params.toString()}`
}
