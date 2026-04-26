import { describe, expect, test } from "bun:test"
import {
  areWindowThemeStatesEqual,
  getWindowControlsOverlayStyle,
  normalizeWindowThemeState,
  resolveWindowThemeState,
} from "./windowTheme"

describe("windowTheme", () => {
  test("resolves system themes against the current OS appearance", () => {
    expect(resolveWindowThemeState("system", false)).toEqual({
      themeSource: "system",
      resolvedAppearance: "light",
      backgroundColor: "#f5f7fb",
    })

    expect(resolveWindowThemeState("system", true)).toEqual({
      themeSource: "system",
      resolvedAppearance: "dark",
      backgroundColor: "#0b0f14",
    })
  })

  test("resolves concrete app themes to their native light or dark appearance", () => {
    expect(resolveWindowThemeState("catppuccin-latte", true)).toEqual({
      themeSource: "light",
      resolvedAppearance: "light",
      backgroundColor: "#eff1f5",
    })

    expect(resolveWindowThemeState("kanagawa-dragon", false)).toEqual({
      themeSource: "dark",
      resolvedAppearance: "dark",
      backgroundColor: "#181616",
    })
  })

  test("normalizes sync payloads and falls back to the resolved appearance background", () => {
    expect(
      normalizeWindowThemeState(
        {
          themeSource: "system",
          resolvedAppearance: "dark",
          backgroundColor: "",
        },
        false
      )
    ).toEqual({
      themeSource: "system",
      resolvedAppearance: "dark",
      backgroundColor: "#0b0f14",
    })
  })

  test("uses contrasting symbol colors for light and dark overlays", () => {
    expect(
      getWindowControlsOverlayStyle({
        backgroundColor: "#f5f7fb",
        resolvedAppearance: "light",
      })
    ).toEqual({
      color: "#f5f7fb",
      symbolColor: "#6b6d76",
      height: 44,
    })

    expect(
      getWindowControlsOverlayStyle({
        backgroundColor: "#0b0f14",
        resolvedAppearance: "dark",
      })
    ).toEqual({
      color: "#0b0f14",
      symbolColor: "#9ca3af",
      height: 44,
    })
  })

  test("detects when a window theme state is unchanged", () => {
    expect(
      areWindowThemeStatesEqual(
        {
          themeSource: "system",
          resolvedAppearance: "dark",
          backgroundColor: "#0b0f14",
        },
        {
          themeSource: "system",
          resolvedAppearance: "dark",
          backgroundColor: "#0b0f14",
        }
      )
    ).toBe(true)

    expect(
      areWindowThemeStatesEqual(
        {
          themeSource: "system",
          resolvedAppearance: "dark",
          backgroundColor: "#0b0f14",
        },
        {
          themeSource: "system",
          resolvedAppearance: "light",
          backgroundColor: "#f5f7fb",
        }
      )
    ).toBe(false)
  })
})
