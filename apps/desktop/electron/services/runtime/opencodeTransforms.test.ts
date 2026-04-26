import { describe, expect, test } from "bun:test"
import {
  flattenOpenCodeModels,
  getOpenCodePermissionRuleset,
} from "./opencodeTransforms"

describe("opencodeTransforms", () => {
  test("flattens only connected models and marks provider defaults", () => {
    const models = flattenOpenCodeModels({
      all: [
        {
          id: "openai",
          name: "OpenAI",
          env: [],
          models: {
            "gpt-5.4": {
              id: "gpt-5.4",
              name: "GPT-5.4",
              release_date: "2026-01-01",
              attachment: true,
              reasoning: true,
              temperature: false,
              tool_call: true,
              limit: { context: 200000, output: 32000 },
              options: {},
              variants: {
                low: {},
                high: {},
                disabled: { disabled: true },
              },
            },
          },
        },
        {
          id: "anthropic",
          name: "Anthropic",
          env: [],
          models: {
            "claude-opus-4-6": {
              id: "claude-opus-4-6",
              name: "Claude Opus 4.6",
              release_date: "2026-01-01",
              attachment: true,
              reasoning: true,
              temperature: false,
              tool_call: true,
              limit: { context: 200000, output: 32000 },
              options: {},
            },
          },
        },
      ],
      default: {
        openai: "gpt-5.4",
      },
      connected: ["openai"],
    })

    expect(models).toEqual([
      {
        id: "openai/gpt-5.4",
        displayName: "GPT-5.4",
        providerName: "OpenAI",
        isDefault: true,
        supportedReasoningEfforts: [],
        defaultReasoningEffort: null,
        defaultModelVariant: null,
        modelVariants: [
          { id: "low", label: "Low" },
          { id: "high", label: "High" },
        ],
        supportsFastMode: false,
      },
    ])
  })

  test("maps runtime modes to the expected OpenCode permission rules", () => {
    const approvalRequired = getOpenCodePermissionRuleset("approval-required")
    const autoAcceptEdits = getOpenCodePermissionRuleset("auto-accept-edits")
    const fullAccess = getOpenCodePermissionRuleset("full-access")

    expect(approvalRequired).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ permission: "read", action: "allow" }),
        expect.objectContaining({ permission: "edit", action: "ask" }),
        expect.objectContaining({ permission: "bash", action: "ask" }),
      ])
    )

    expect(autoAcceptEdits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ permission: "edit", action: "allow" }),
        expect.objectContaining({ permission: "bash", action: "ask" }),
        expect.objectContaining({ permission: "external_directory", action: "ask" }),
      ])
    )

    expect(fullAccess).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ permission: "edit", action: "allow" }),
        expect.objectContaining({ permission: "bash", action: "allow" }),
        expect.objectContaining({ permission: "websearch", action: "allow" }),
      ])
    )
  })
})
