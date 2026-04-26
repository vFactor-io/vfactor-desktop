import { describe, expect, test } from "bun:test"
import { getChatInputPlaceholder } from "./chatInputConfig"
import { getActiveSlashCommandQuery } from "./chatInputSlashCommands"
import {
  resolveDefaultFastMode,
  resolveDefaultModelVariant,
  resolveDefaultReasoningEffort,
  resolveEffectiveComposerModelId,
  resolveSessionSelectedModelId,
  shouldShowModelVariantSelector,
  shouldShowReasoningEffortSelector,
} from "./chatInputModelSelection"

describe("getChatInputPlaceholder", () => {
  test("uses the intro placeholder for the first-prompt empty state", () => {
    expect(getChatInputPlaceholder("intro")).toBe("Describe the feature, fix, or idea...")
  })

  test("keeps the existing docked placeholder for the standard composer", () => {
    expect(getChatInputPlaceholder("docked")).toBe("Ask anything")
  })
})

describe("resolveSessionSelectedModelId", () => {
  test("clears the local composer selection when the active session has no explicit model", () => {
    expect(resolveSessionSelectedModelId(null, ["gpt-5", "gpt-5-mini"])).toBeNull()
    expect(resolveSessionSelectedModelId("   ", ["gpt-5", "gpt-5-mini"])).toBeNull()
  })

  test("keeps the active session model when it is available", () => {
    expect(resolveSessionSelectedModelId(" gpt-5-mini ", ["gpt-5", "gpt-5-mini"])).toBe("gpt-5-mini")
  })

  test("drops unavailable session overrides instead of carrying stale state forward", () => {
    expect(resolveSessionSelectedModelId("gpt-4.1", ["gpt-5", "gpt-5-mini"])).toBeNull()
  })
})

describe("resolveEffectiveComposerModelId", () => {
  test("falls back to the saved global default model when the session has no explicit override", () => {
    expect(
      resolveEffectiveComposerModelId({
        activeSessionModelId: null,
        composerSelectedModelId: null,
        defaultModelId: "gpt-5.4",
        availableModelIds: ["gpt-5.4", "gpt-5.4-mini"],
        runtimeDefaultModelId: "gpt-5.4-mini",
      })
    ).toBe("gpt-5.4")
  })

  test("prefers a newer GPT runtime default over an older saved release default", () => {
    expect(
      resolveEffectiveComposerModelId({
        activeSessionModelId: null,
        composerSelectedModelId: null,
        defaultModelId: "gpt-5.4",
        availableModelIds: ["gpt-5.5", "gpt-5.4"],
        runtimeDefaultModelId: "gpt-5.5",
      })
    ).toBe("gpt-5.5")
  })

  test("uses the draft composer selection before the first session exists", () => {
    expect(
      resolveEffectiveComposerModelId({
        activeSessionModelId: null,
        composerSelectedModelId: "gpt-5.4-mini",
        defaultModelId: "gpt-5.4",
        availableModelIds: ["gpt-5.4", "gpt-5.4-mini"],
        runtimeDefaultModelId: "gpt-5.4",
      })
    ).toBe("gpt-5.4-mini")
  })

  test("uses the live composer selection when a draft session suppresses the persisted session model", () => {
    expect(
      resolveEffectiveComposerModelId({
        activeSessionModelId: null,
        composerSelectedModelId: "claude-opus-4-6",
        defaultModelId: "claude-sonnet-4-6",
        availableModelIds: ["claude-sonnet-4-6", "claude-opus-4-6"],
        runtimeDefaultModelId: "claude-sonnet-4-6",
      })
    ).toBe("claude-opus-4-6")
  })
})

describe("resolveDefaultReasoningEffort", () => {
  test("falls back when the saved default reasoning is unsupported", () => {
    expect(
      resolveDefaultReasoningEffort({
        overrideReasoningEffort: null,
        defaultReasoningEffort: "max",
        modelDefaultReasoningEffort: "medium",
        supportedReasoningEfforts: ["low", "medium", "high"],
      })
    ).toBe("medium")
  })

  test("does not leak saved defaults onto models without reasoning options", () => {
    expect(
      resolveDefaultReasoningEffort({
        overrideReasoningEffort: null,
        defaultReasoningEffort: "high",
        modelDefaultReasoningEffort: null,
        supportedReasoningEfforts: [],
      })
    ).toBeNull()
  })
})

describe("resolveDefaultFastMode", () => {
  test("disables fast mode when the model does not support it", () => {
    expect(
      resolveDefaultFastMode({
        overrideFastMode: null,
        defaultFastMode: true,
        supportsFastMode: false,
      })
    ).toBe(false)
  })
})

describe("resolveDefaultModelVariant", () => {
  test("uses the saved default variant when supported", () => {
    expect(
      resolveDefaultModelVariant({
        overrideModelVariant: undefined,
        defaultModelVariant: "high",
        modelDefaultVariant: null,
        supportedModelVariants: ["low", "high"],
      })
    ).toBe("high")
  })

  test("lets the composer explicitly fall back to the provider default", () => {
    expect(
      resolveDefaultModelVariant({
        overrideModelVariant: null,
        defaultModelVariant: "high",
        modelDefaultVariant: "low",
        supportedModelVariants: ["low", "high"],
      })
    ).toBeNull()
  })

  test("does not leak stale variants onto models that no longer support them", () => {
    expect(
      resolveDefaultModelVariant({
        overrideModelVariant: undefined,
        defaultModelVariant: "max",
        modelDefaultVariant: null,
        supportedModelVariants: ["low", "high"],
      })
    ).toBeNull()
  })
})

describe("shouldShowReasoningEffortSelector", () => {
  test("hides the effort selector when the harness does not support effort controls", () => {
    expect(
      shouldShowReasoningEffortSelector({
        supportsReasoningEffort: false,
        availableReasoningEfforts: ["low", "medium", "high"],
      })
    ).toBe(false)
  })

  test("hides the effort selector when the selected model exposes no effort options", () => {
    expect(
      shouldShowReasoningEffortSelector({
        supportsReasoningEffort: true,
        availableReasoningEfforts: [],
      })
    ).toBe(false)
  })

  test("shows the effort selector when the harness supports it and options are available", () => {
    expect(
      shouldShowReasoningEffortSelector({
        supportsReasoningEffort: true,
        availableReasoningEfforts: ["medium"],
      })
    ).toBe(true)
  })
})

describe("shouldShowModelVariantSelector", () => {
  test("shows the selector only when variants are available", () => {
    expect(shouldShowModelVariantSelector({ availableModelVariants: ["low"] })).toBe(true)
    expect(shouldShowModelVariantSelector({ availableModelVariants: [] })).toBe(false)
  })
})

describe("getActiveSlashCommandQuery", () => {
  test("returns the current query when the composer only contains a slash command token", () => {
    expect(getActiveSlashCommandQuery("/")).toBe("")
    expect(getActiveSlashCommandQuery("/figma")).toBe("figma")
    expect(getActiveSlashCommandQuery("/\n")).toBe("")
    expect(getActiveSlashCommandQuery("/figma\n")).toBe("figma")
  })

  test("stops treating the input as a slash command once the user continues normal text", () => {
    expect(getActiveSlashCommandQuery("/figma landing page")).toBeNull()
    expect(getActiveSlashCommandQuery("please use /figma")).toBeNull()
    expect(getActiveSlashCommandQuery("/figma\nnext line")).toBeNull()
  })
})
