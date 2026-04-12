import { describe, expect, test } from "bun:test"
import {
  getDesktopRuntimeEnvEntries,
  stringifyDesktopRuntimeEnv,
} from "./write-desktop-runtime-env"

describe("writeDesktopRuntimeEnv", () => {
  test("keeps only supported runtime keys with trimmed values", () => {
    expect(
      getDesktopRuntimeEnvEntries({
        POSTHOG_API_KEY: "  phc_test_key  ",
        POSTHOG_ENABLED: " true ",
        POSTHOG_HOST: " https://eu.i.posthog.com ",
        OTHER_KEY: "ignored",
      }),
    ).toEqual([
      ["POSTHOG_API_KEY", "phc_test_key"],
      ["POSTHOG_ENABLED", "true"],
      ["POSTHOG_HOST", "https://eu.i.posthog.com"],
    ])
  })

  test("quotes values that need dotenv escaping", () => {
    expect(
      stringifyDesktopRuntimeEnv([
        ["POSTHOG_API_KEY", "phc_test_key"],
        ["POSTHOG_HOST", "https://example.com/with query"],
      ]),
    ).toBe('POSTHOG_API_KEY=phc_test_key\nPOSTHOG_HOST="https://example.com/with query"\n')
  })
})
