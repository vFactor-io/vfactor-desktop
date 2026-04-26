import { describe, expect, test } from "bun:test"
import {
  CONCRETE_THEMES,
  DEFAULT_TEXT_SIZE_PX,
  DEFAULT_THEME_ID,
  MAX_TEXT_SIZE_PX,
  MIN_TEXT_SIZE_PX,
  clampTextSizePx,
  normalizeThemeId,
  resolveThemeIdForAppearance,
} from "./themeRegistry"
import { THEME_TOKEN_NAMES } from "./types"
import type { ThemeTokens } from "./types"

function parseHexColor(value: string): [number, number, number] | null {
  const trimmed = value.trim()
  if (!trimmed.startsWith("#")) {
    return null
  }

  const raw = trimmed.slice(1)
  const hex = raw.length === 3
    ? raw.split("").map((character) => `${character}${character}`).join("")
    : raw

  if (hex.length !== 6) {
    return null
  }

  const numericValue = Number.parseInt(hex, 16)
  return [
    (numericValue >> 16) & 255,
    (numericValue >> 8) & 255,
    numericValue & 255,
  ]
}

function resolveTestColor(value: string): [number, number, number] | null {
  const mixMatch = value.match(
    /^color-mix\(in oklab,\s*(#[0-9a-fA-F]{6})\s*([0-9.]+)%,\s*(#[0-9a-fA-F]{6})\)$/
  )

  if (!mixMatch) {
    return parseHexColor(value)
  }

  const foreground = parseHexColor(mixMatch[1] ?? "")
  const background = parseHexColor(mixMatch[3] ?? "")
  if (!foreground || !background) {
    return null
  }

  const foregroundWeight = Number(mixMatch[2]) / 100
  return foreground.map((channel, index) =>
    Math.round(channel * foregroundWeight + background[index] * (1 - foregroundWeight))
  ) as [number, number, number]
}

function luminance(rgb: [number, number, number]): number {
  const [red, green, blue] = rgb.map((channel) => {
    const normalized = channel / 255
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  })

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function approximateContrast(
  tokens: ThemeTokens,
  firstToken: keyof ThemeTokens,
  secondToken: keyof ThemeTokens
): number {
  const first = resolveTestColor(tokens[firstToken])
  const second = resolveTestColor(tokens[secondToken])

  if (!first || !second) {
    return Number.POSITIVE_INFINITY
  }

  const firstLuminance = luminance(first)
  const secondLuminance = luminance(second)
  return (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
}

describe("themeRegistry", () => {
  test("every shipped theme provides the full token contract", () => {
    for (const theme of CONCRETE_THEMES) {
      for (const tokenName of THEME_TOKEN_NAMES) {
        expect(theme.tokens[tokenName], `${theme.id} is missing ${tokenName}`).toBeTruthy()
      }
    }
  })

  test("interactive surface tokens keep enough visual separation across themes", () => {
    const expectations: Array<{
      first: keyof ThemeTokens
      second: keyof ThemeTokens
      minimumContrast: number
    }> = [
      { first: "border", second: "background", minimumContrast: 1.3 },
      { first: "border", second: "card", minimumContrast: 1.2 },
      { first: "control-border", second: "background", minimumContrast: 1.16 },
      { first: "input", second: "background", minimumContrast: 1.14 },
      { first: "sidebar-item-active", second: "sidebar", minimumContrast: 1.16 },
      { first: "sidebar-item-hover", second: "sidebar", minimumContrast: 1.1 },
      { first: "accent", second: "popover", minimumContrast: 1.2 },
      { first: "muted", second: "card", minimumContrast: 1.1 },
      { first: "secondary", second: "background", minimumContrast: 1.12 },
    ]

    for (const theme of CONCRETE_THEMES) {
      for (const expectation of expectations) {
        expect(
          approximateContrast(theme.tokens, expectation.first, expectation.second),
          `${theme.id} ${expectation.first}/${expectation.second} is too subtle`
        ).toBeGreaterThanOrEqual(expectation.minimumContrast)
      }
    }
  })

  test("user message bubbles follow each theme's accent tokens", () => {
    for (const theme of CONCRETE_THEMES) {
      expect(theme.tokens["message-user-bubble"], `${theme.id} user bubble background`).toBe(
        theme.tokens.accent
      )
      expect(
        theme.tokens["message-user-bubble-foreground"],
        `${theme.id} user bubble foreground`
      ).toBe(theme.tokens["accent-foreground"])
    }
  })

  test("includes the imported theme set exposed in the command menu", () => {
    expect(CONCRETE_THEMES.map((theme) => theme.id)).toEqual(
      expect.arrayContaining([
        "tokyonight",
        "everforest",
        "ayu",
        "catppuccin",
        "catppuccin-macchiato",
        "gruvbox",
        "kanagawa",
        "nord",
        "matrix",
        "night-owl",
      ])
    )
  })

  test("system defaults map to the vFactor light and dark pair", () => {
    expect(DEFAULT_THEME_ID).toBe("system")
    expect(resolveThemeIdForAppearance("light")).toBe("vfactor-light")
    expect(resolveThemeIdForAppearance("dark")).toBe("vfactor-dark")
  })

  test("legacy nucleus theme ids normalize to the vFactor replacements", () => {
    expect(normalizeThemeId("nucleus-light")).toBe("vfactor-light")
    expect(normalizeThemeId("nucleus-dark")).toBe("vfactor-dark")
    expect(normalizeThemeId("vfactor-dark")).toBe("vfactor-dark")
    expect(normalizeThemeId("missing-theme")).toBe(DEFAULT_THEME_ID)
  })

  test("text size is clamped to the supported interface range", () => {
    expect(DEFAULT_TEXT_SIZE_PX).toBe(13)
    expect(clampTextSizePx(MIN_TEXT_SIZE_PX - 10)).toBe(MIN_TEXT_SIZE_PX)
    expect(clampTextSizePx(MAX_TEXT_SIZE_PX + 10)).toBe(MAX_TEXT_SIZE_PX)
  })
})
