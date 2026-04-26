import {
  getThemeDefinition,
  normalizeThemeId,
  resolveThemeIdForAppearance,
} from "../../src/features/shared/appearance/themeRegistry"
import type { ResolvedAppearance } from "../../src/features/shared/appearance/types"
import type { AppWindowThemeSyncInput } from "../../src/desktop/contracts"

export const SETTINGS_STORE_FILE = "settings.json"
export const APPEARANCE_THEME_ID_KEY = "appearanceThemeId"
export const WINDOW_CONTROLS_OVERLAY_HEIGHT = 44

const LIGHT_OVERLAY_SYMBOL_COLOR = "#6b6d76"
const DARK_OVERLAY_SYMBOL_COLOR = "#9ca3af"

export interface WindowThemeState extends AppWindowThemeSyncInput {}

export function areWindowThemeStatesEqual(
  left: Pick<WindowThemeState, "themeSource" | "resolvedAppearance" | "backgroundColor">,
  right: Pick<WindowThemeState, "themeSource" | "resolvedAppearance" | "backgroundColor">
): boolean {
  return (
    left.themeSource === right.themeSource &&
    left.resolvedAppearance === right.resolvedAppearance &&
    left.backgroundColor === right.backgroundColor
  )
}

function getSystemResolvedAppearance(shouldUseDarkColors: boolean): ResolvedAppearance {
  return shouldUseDarkColors ? "dark" : "light"
}

function getThemeBackground(appearance: ResolvedAppearance): string {
  return getThemeDefinition(resolveThemeIdForAppearance(appearance)).tokens.background
}

export function resolveWindowThemeState(
  themeId: string | null | undefined,
  shouldUseDarkColors: boolean
): WindowThemeState {
  const normalizedThemeId = normalizeThemeId(themeId)

  if (normalizedThemeId === "system") {
    const resolvedAppearance = getSystemResolvedAppearance(shouldUseDarkColors)

    return {
      themeSource: "system",
      resolvedAppearance,
      backgroundColor: getThemeBackground(resolvedAppearance),
    }
  }

  const theme = getThemeDefinition(normalizedThemeId)

  return {
    themeSource: theme.appearance,
    resolvedAppearance: theme.appearance,
    backgroundColor: theme.tokens.background,
  }
}

export function normalizeWindowThemeState(
  input: AppWindowThemeSyncInput,
  shouldUseDarkColors: boolean
): WindowThemeState {
  const themeSource =
    input.themeSource === "light" || input.themeSource === "dark" || input.themeSource === "system"
      ? input.themeSource
      : "system"
  const fallbackAppearance =
    themeSource === "system" ? getSystemResolvedAppearance(shouldUseDarkColors) : themeSource
  const resolvedAppearance =
    input.resolvedAppearance === "dark" || input.resolvedAppearance === "light"
      ? input.resolvedAppearance
      : fallbackAppearance
  const backgroundColor =
    typeof input.backgroundColor === "string" && input.backgroundColor.trim().length > 0
      ? input.backgroundColor.trim()
      : getThemeBackground(resolvedAppearance)

  return {
    themeSource,
    resolvedAppearance,
    backgroundColor,
  }
}

export function getWindowControlsOverlayStyle(theme: Pick<WindowThemeState, "backgroundColor" | "resolvedAppearance">) {
  return {
    color: theme.backgroundColor,
    symbolColor:
      theme.resolvedAppearance === "dark"
        ? DARK_OVERLAY_SYMBOL_COLOR
        : LIGHT_OVERLAY_SYMBOL_COLOR,
    height: WINDOW_CONTROLS_OVERLAY_HEIGHT,
  }
}
