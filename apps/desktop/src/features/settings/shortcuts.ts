export type ShortcutModifier = "meta" | "ctrl" | "alt" | "shift"

export interface ShortcutBinding {
  key: string
  code?: string
  modifiers: ShortcutModifier[]
}

export type ShortcutId = "toggle-plan-mode"

export interface ShortcutDefinition {
  id: ShortcutId
  title: string
  description: string
  category: "composer"
  defaultBinding: ShortcutBinding
}

export type ShortcutPreferences = Partial<Record<ShortcutId, ShortcutBinding>>

const SHORTCUT_MODIFIER_ORDER: ShortcutModifier[] = ["meta", "ctrl", "alt", "shift"]
const SHORTCUT_MODIFIER_KEYS = new Set(["Meta", "Control", "Alt", "Shift"])

const SHORTCUT_MODIFIER_LABELS: Record<ShortcutModifier, string> = {
  meta: "Cmd",
  ctrl: "Ctrl",
  alt: "Alt",
  shift: "Shift",
}

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  {
    id: "toggle-plan-mode",
    title: "Toggle plan mode",
    description: "Switch the chat composer between default and plan mode.",
    category: "composer",
    defaultBinding: {
      key: "P",
      code: "KeyP",
      modifiers: ["meta", "shift"],
    },
  },
]

export function getShortcutDefinition(id: ShortcutId): ShortcutDefinition {
  const definition = SHORTCUT_DEFINITIONS.find((candidate) => candidate.id === id)

  if (!definition) {
    throw new Error(`Unknown shortcut definition: ${id}`)
  }

  return definition
}

export function getShortcutBinding(
  id: ShortcutId,
  preferences?: ShortcutPreferences,
): ShortcutBinding {
  return preferences?.[id] ?? getShortcutDefinition(id).defaultBinding
}

export function formatShortcutBinding(binding: ShortcutBinding): string {
  const modifierLabels = SHORTCUT_MODIFIER_ORDER
    .filter((modifier) => binding.modifiers.includes(modifier))
    .map((modifier) => SHORTCUT_MODIFIER_LABELS[modifier])

  return [...modifierLabels, normalizeShortcutKey(binding.key)].join(" ")
}

export function normalizeShortcutKey(key: string): string {
  if (key === " ") {
    return "Space"
  }

  if (key === "Esc") {
    return "Escape"
  }

  return key.length === 1 ? key.toUpperCase() : key
}

export function getShortcutModifiers(
  event: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
): ShortcutModifier[] {
  return SHORTCUT_MODIFIER_ORDER.filter((modifier) => {
    switch (modifier) {
      case "meta":
        return event.metaKey
      case "ctrl":
        return event.ctrlKey
      case "alt":
        return event.altKey
      case "shift":
        return event.shiftKey
      default:
        return false
    }
  })
}

export function hasShortcutModifier(binding: ShortcutBinding): boolean {
  return binding.modifiers.length > 0
}

export function createShortcutBindingFromKeyboardEvent(
  event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
): ShortcutBinding | null {
  if (SHORTCUT_MODIFIER_KEYS.has(event.key)) {
    return null
  }

  return {
    key: normalizeShortcutKey(event.key),
    code: event.code || undefined,
    modifiers: getShortcutModifiers(event),
  }
}

export function matchesShortcutBinding(
  event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  binding: ShortcutBinding,
): boolean {
  const modifierSet = new Set(binding.modifiers)
  const normalizedKey = normalizeShortcutKey(event.key)

  if (binding.code && event.code !== binding.code) {
    return false
  }

  if (normalizedKey !== normalizeShortcutKey(binding.key)) {
    return false
  }

  return (
    event.metaKey === modifierSet.has("meta") &&
    event.ctrlKey === modifierSet.has("ctrl") &&
    event.altKey === modifierSet.has("alt") &&
    event.shiftKey === modifierSet.has("shift")
  )
}
