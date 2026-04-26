export type ResolvedAppearance = "light" | "dark"

export type CornerStyle = "square" | "soft" | "rounded"

export type ThemeId =
  | "system"
  | "vfactor-light"
  | "vfactor-dark"
  | "tokyonight"
  | "everforest"
  | "ayu"
  | "catppuccin"
  | "catppuccin-latte"
  | "catppuccin-macchiato"
  | "catppuccin-mocha"
  | "gruvbox"
  | "kanagawa"
  | "rose-pine-dawn"
  | "rose-pine-main"
  | "henna"
  | "github-light"
  | "tokyo-night-storm"
  | "nord"
  | "matrix"
  | "night-owl"
  | "dracula"
  | "ayu-light"
  | "ayu-mirage"
  | "kanagawa-lotus"
  | "kanagawa-dragon"
  | "noctis"
  | "rainglow"
  | "cyberpunk"
  | "gruvbox-material"
  | "moonlight"
  | "aurora-x"
  | "field-lights"
  | "just-black"

export type ConcreteThemeId = Exclude<ThemeId, "system">
export type PierreThemeName = "pierre-light" | "pierre-dark"

export const THEME_TOKEN_NAMES = [
  "background",
  "foreground",
  "content-strong",
  "content",
  "content-subtle",
  "content-muted",
  "icon-strong",
  "icon",
  "icon-subtle",
  "icon-muted",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "destructive-surface",
  "destructive-surface-foreground",
  "destructive-border",
  "border",
  "control-border",
  "input",
  "ring",
  "cta",
  "cta-foreground",
  "toggle-on",
  "skill-accent",
  "skill-icon",
  "skill-surface",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-glass",
  "sidebar-glass-strong",
  "sidebar-item-hover",
  "sidebar-item-active",
  "sidebar-border",
  "sidebar-ring",
  "main-content",
  "main-content-foreground",
  "terminal-font-family",
  "terminal",
  "terminal-foreground",
  "terminal-cursor",
  "terminal-selection",
  "terminal-border",
  "chat-file-accent",
  "chat-plan-surface",
  "chat-plan-border",
  "chat-plan-accent",
  "chat-plan-accent-foreground",
  "chat-approval-surface",
  "chat-approval-surface-strong",
  "chat-approval-border",
  "chat-approval-badge",
  "chat-approval-emphasis",
  "chat-approval-emphasis-foreground",
  "scrollbar-thumb",
  "message-user-bubble",
  "message-user-bubble-foreground",
  "success",
  "success-foreground",
  "success-surface",
  "success-surface-foreground",
  "success-border",
  "warning",
  "warning-foreground",
  "warning-surface",
  "warning-surface-foreground",
  "warning-border",
  "info",
  "info-foreground",
  "info-surface",
  "info-surface-foreground",
  "info-border",
  "vcs-added",
  "vcs-added-surface",
  "vcs-modified",
  "vcs-modified-surface",
  "vcs-deleted",
  "vcs-deleted-surface",
  "vcs-renamed",
  "vcs-renamed-surface",
  "vcs-ignored",
  "vcs-ignored-surface",
  "vcs-ahead",
  "vcs-behind",
  "vcs-diverged",
  "vcs-merged",
  "vcs-pr-open",
  "vcs-pr-closed",
] as const

export type ThemeTokenName = (typeof THEME_TOKEN_NAMES)[number]
export type ThemeTokens = Record<ThemeTokenName, string>

export interface MonacoThemeMetadata {
  id: string
  base: "vs" | "vs-dark"
  inherit: boolean
  rules: Array<{
    token: string
    foreground?: string
    background?: string
    fontStyle?: string
  }>
  colors: Record<string, string>
}

export interface ThemeDefinition {
  id: ConcreteThemeId
  label: string
  appearance: ResolvedAppearance
  tokens: ThemeTokens
  monaco: MonacoThemeMetadata
  adapters: {
    terminal: {
      usesCssVariables: true
      backgroundVariable: "--terminal"
      foregroundVariable: "--terminal-foreground"
      cursorVariable: "--terminal-cursor"
    }
    diff: {
      pierreTheme: PierreThemeName
    }
  }
}

export interface AppearanceSnapshot {
  themeId: ThemeId
  resolvedAppearance: ResolvedAppearance
  resolvedThemeId: ConcreteThemeId
  textSizePx: number
  cornerStyle: CornerStyle
  theme: ThemeDefinition
  monacoThemeId: string
  pierreDiffTheme: PierreThemeName
}
