import { describe, expect, test } from "bun:test"
import {
  CODEX_FAST_MODE_MODEL_ALLOWLIST,
  codexModelSupportsFastMode,
  mapCodexFastModeToServiceTier,
} from "./codexFastMode"

describe("codexFastMode", () => {
  test("keeps the current fast-mode allowlist centralized", () => {
    expect(Array.from(CODEX_FAST_MODE_MODEL_ALLOWLIST)).toEqual([
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.3-codex",
      "gpt-5.3-codex-spark",
      "gpt-5.2-codex",
      "gpt-5.2",
    ])
    expect(codexModelSupportsFastMode("gpt-5.4")).toBe(true)
    expect(codexModelSupportsFastMode("gpt-5.4-mini")).toBe(true)
  })

  test("maps enabled fast mode to the fast service tier", () => {
    expect(mapCodexFastModeToServiceTier(true)).toBe("fast")
    expect(mapCodexFastModeToServiceTier(false)).toBeNull()
  })
})
