import { useSyncExternalStore } from "react"
import { desktop, loadDesktopStore } from "@/desktop/client"
import {
  clampTextSizePx,
  DEFAULT_CORNER_STYLE,
  DEFAULT_TEXT_SIZE_PX,
  DEFAULT_THEME_ID,
  getCornerStyleRadius,
  isCornerStyle,
  getThemeDefinition,
  normalizeThemeId,
  resolveThemeIdForAppearance,
} from "./themeRegistry"
import type { AppearanceSnapshot, ConcreteThemeId, CornerStyle, ResolvedAppearance, ThemeId } from "./types"

const SETTINGS_STORE_FILE = "settings.json"
const APPEARANCE_THEME_ID_KEY = "appearanceThemeId"
const APPEARANCE_TEXT_SIZE_KEY = "appearanceTextSizePx"
const APPEARANCE_CORNER_STYLE_KEY = "appearanceCornerStyle"

type AppearanceOverrides = {
  themeId?: ThemeId
  textSizePx?: number
  cornerStyle?: CornerStyle
  systemAppearance?: ResolvedAppearance
}

const listeners = new Set<() => void>()
let mediaQueryList: MediaQueryList | null = null
let mediaQueryCleanup: (() => void) | null = null
let lastSyncedWindowThemeKey: string | null = null

function getSystemAppearance(): ResolvedAppearance {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light"
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

function buildSnapshot(
  themeId: ThemeId,
  textSizePx: number,
  cornerStyle: CornerStyle,
  systemAppearance: ResolvedAppearance
): AppearanceSnapshot {
  const resolvedAppearance =
    themeId === "system" ? systemAppearance : getThemeDefinition(themeId).appearance
  const resolvedThemeId: ConcreteThemeId =
    themeId === "system" ? resolveThemeIdForAppearance(resolvedAppearance) : themeId
  const theme = getThemeDefinition(resolvedThemeId)

  return {
    themeId,
    resolvedAppearance,
    resolvedThemeId,
    textSizePx: clampTextSizePx(textSizePx),
    cornerStyle,
    theme,
    monacoThemeId: theme.monaco.id,
    pierreDiffTheme: theme.adapters.diff.pierreTheme,
  }
}

let snapshot = buildSnapshot(DEFAULT_THEME_ID, DEFAULT_TEXT_SIZE_PX, DEFAULT_CORNER_STYLE, "light")

function shouldSyncWindowTheme(
  previous: AppearanceSnapshot,
  next: AppearanceSnapshot
): boolean {
  return (
    previous.themeId !== next.themeId ||
    previous.resolvedAppearance !== next.resolvedAppearance ||
    previous.theme.tokens.background !== next.theme.tokens.background
  )
}

function syncWindowTheme(next: AppearanceSnapshot): void {
  const themeSource = next.themeId === "system" ? "system" : next.resolvedAppearance
  const syncKey = `${themeSource}:${next.resolvedAppearance}:${next.theme.tokens.background}`

  if (lastSyncedWindowThemeKey === syncKey) {
    return
  }

  lastSyncedWindowThemeKey = syncKey

  void desktop.app
    .syncWindowTheme({
      themeSource,
      resolvedAppearance: next.resolvedAppearance,
      backgroundColor: next.theme.tokens.background,
    })
    .catch((error) => {
      console.warn("[appearance] Failed to sync native window theme:", error)
    })
}

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

function syncSystemAppearanceListener(themeId: ThemeId): void {
  if (themeId !== "system") {
    mediaQueryCleanup?.()
    mediaQueryCleanup = null
    mediaQueryList = null
    return
  }

  if (!mediaQueryList && typeof window !== "undefined" && typeof window.matchMedia === "function") {
    mediaQueryList = window.matchMedia("(prefers-color-scheme: dark)")
  }

  if (!mediaQueryList || mediaQueryCleanup) {
    return
  }

  const handleChange = (event: MediaQueryListEvent) => {
    setAppearanceState({
      systemAppearance: event.matches ? "dark" : "light",
    })
  }

  mediaQueryList.addEventListener("change", handleChange)
  mediaQueryCleanup = () => {
    mediaQueryList?.removeEventListener("change", handleChange)
  }
}

export function applyAppearance(overrides: AppearanceOverrides = {}): AppearanceSnapshot {
  const next = buildSnapshot(
    overrides.themeId ?? snapshot.themeId,
    overrides.textSizePx ?? snapshot.textSizePx,
    overrides.cornerStyle ?? snapshot.cornerStyle,
    overrides.systemAppearance ?? getSystemAppearance()
  )

  if (typeof document === "undefined") {
    return next
  }

  const root = document.documentElement
  root.dataset.theme = next.themeId
  root.dataset.resolvedTheme = next.resolvedThemeId
  root.dataset.appearance = next.resolvedAppearance
  root.dataset.cornerStyle = next.cornerStyle
  root.classList.toggle("dark", next.resolvedAppearance === "dark")
  root.style.colorScheme = next.resolvedAppearance
  root.style.setProperty("--radius", getCornerStyleRadius(next.cornerStyle))
  root.style.setProperty("--app-text-size", `${next.textSizePx}px`)

  for (const [name, value] of Object.entries(next.theme.tokens)) {
    root.style.setProperty(`--${name}`, value)
  }

  return next
}

export function setAppearanceState(overrides: AppearanceOverrides, options?: { notify?: boolean }) {
  const previous = snapshot
  snapshot = applyAppearance(overrides)
  syncSystemAppearanceListener(snapshot.themeId)

  if (shouldSyncWindowTheme(previous, snapshot)) {
    syncWindowTheme(snapshot)
  }

  if (options?.notify !== false) {
    notify()
  }

  return snapshot
}

export async function bootstrapAppearance(): Promise<AppearanceSnapshot> {
  const store = await loadDesktopStore(SETTINGS_STORE_FILE)
  const persistedThemeId = await store.get<string>(APPEARANCE_THEME_ID_KEY)
  const persistedTextSizePx = await store.get<number>(APPEARANCE_TEXT_SIZE_KEY)
  const persistedCornerStyle = await store.get<string>(APPEARANCE_CORNER_STYLE_KEY)

  return setAppearanceState(
    {
      themeId: normalizeThemeId(persistedThemeId),
      textSizePx: clampTextSizePx(persistedTextSizePx),
      cornerStyle: isCornerStyle(persistedCornerStyle) ? persistedCornerStyle : DEFAULT_CORNER_STYLE,
      systemAppearance: getSystemAppearance(),
    },
    { notify: false }
  )
}

export function getAppearanceSnapshot(): AppearanceSnapshot {
  return snapshot
}

export function subscribeToAppearance(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setAppearanceThemeId(themeId: ThemeId): void {
  setAppearanceState({ themeId })
}

export function setAppearanceTextSizePx(textSizePx: number): void {
  setAppearanceState({ textSizePx })
}

export function setAppearanceCornerStyle(cornerStyle: CornerStyle): void {
  setAppearanceState({ cornerStyle })
}

export function useAppearance(): AppearanceSnapshot {
  return useSyncExternalStore(subscribeToAppearance, getAppearanceSnapshot, getAppearanceSnapshot)
}
