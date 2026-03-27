export interface AgentHeaderBackground {
  id: string
  label: string
  imageUrl: string
}

export const AGENT_HEADER_BACKGROUNDS: AgentHeaderBackground[] = [
  {
    id: "studio-orange",
    label: "Studio Orange",
    imageUrl:
      "https://images.unsplash.com/photo-1461988320302-91bde64fc8e4?ixid=2yJhcHBfaWQiOjEyMDd9&auto=format&fit=crop&w=1600&h=520&q=80",
  },
  {
    id: "night-indigo",
    label: "Night Indigo",
    imageUrl:
      "https://images.unsplash.com/photo-1479030574009-1e48577746e8?ixlib=rb-1.2.1&auto=format&fit=crop&w=1600&h=520&q=80",
  },
  {
    id: "alpine-cyan",
    label: "Alpine Cyan",
    imageUrl:
      "https://images.unsplash.com/photo-1482938289607-e9573fc25ebb?ixlib=rb-1.2.1&auto=format&fit=crop&w=1600&h=520&q=80",
  },
  {
    id: "amber-dusk",
    label: "Amber Dusk",
    imageUrl:
      "https://images.unsplash.com/photo-1449182325215-d517de72c42d?ixlib=rb-1.2.1&auto=format&fit=crop&w=1600&h=520&q=80",
  },
  {
    id: "soft-sand",
    label: "Soft Sand",
    imageUrl:
      "https://images.unsplash.com/photo-1495978866932-92dbc079e62e?ixlib=rb-1.2.1&auto=format&fit=crop&w=1600&h=520&q=80",
  },
  {
    id: "rose-evening",
    label: "Rose Evening",
    imageUrl:
      "https://images.unsplash.com/photo-1479030160180-b1860951d696?ixlib=rb-1.2.1&auto=format&fit=crop&w=1600&h=520&q=80",
  },
]

function hashString(value: string): number {
  let hash = 0

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index)
    hash |= 0
  }

  return Math.abs(hash)
}

export function getDefaultAgentBackgroundUrl(seed: string): string {
  const index = hashString(seed) % AGENT_HEADER_BACKGROUNDS.length
  return AGENT_HEADER_BACKGROUNDS[index]?.imageUrl ?? AGENT_HEADER_BACKGROUNDS[0].imageUrl
}
