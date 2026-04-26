import { useCallback, useEffect, useMemo, useState, startTransition, type ComponentProps } from "react"
import { flushSync } from "react-dom"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
import { useChatStore } from "../store"
import { getHarnessDefinition } from "../runtime/harnesses"
import { useModels } from "../hooks/useModels"
import { getRuntimeModelLabel } from "../domain/runtimeModels"
import {
  type HarnessId,
  type RuntimeReasoningEffort,
  type RuntimeSession,
} from "../types"
import {
  resolveDefaultFastMode,
  resolveDefaultModelVariant,
  resolveDefaultReasoningEffort,
  resolveEffectiveComposerModelId,
  resolveSessionSelectedModelId,
  shouldShowModelVariantSelector,
  shouldShowReasoningEffortSelector,
} from "./chatInputModelSelection"
import { getModelLogoKind } from "./ModelLogo"
import {
  MODEL_HARNESS_IDS,
  ModelPicker,
  getHarnessGroupMeta,
  type ModelCatalogEntry,
  type ModelGroup,
  type ModelHarnessFilter,
} from "./ModelPicker"

type ModelPickerProps = ComponentProps<typeof ModelPicker>

export function useComposerModelSelection({
  activeSession,
  activeSessionModelId,
  isDraftSession,
  persistedHarnessId,
  selectedWorktreeId,
}: {
  activeSession: RuntimeSession | null
  activeSessionModelId: string | null
  isDraftSession: boolean
  persistedHarnessId: HarnessId | null
  selectedWorktreeId: string | null
}) {
  const harnessDefaults = useSettingsStore((state) => state.harnessDefaults)
  const favoriteModels = useSettingsStore((state) => state.favoriteModels)
  const toggleFavoriteModel = useSettingsStore((state) => state.toggleFavoriteModel)
  const setSessionModel = useChatStore((state) => state.setSessionModel)
  const setSessionModelPreferences = useChatStore((state) => state.setSessionModelPreferences)
  const {
    models: codexModels,
    isLoading: isLoadingCodexModels,
  } = useModels("codex")
  const {
    models: claudeModels,
    isLoading: isLoadingClaudeModels,
  } = useModels("claude-code")
  const {
    models: openCodeModels,
    isLoading: isLoadingOpenCodeModels,
  } = useModels("opencode")
  const [selectedHarnessOverride, setSelectedHarnessOverride] = useState<HarnessId | null>(null)
  const selectedHarnessId = selectedHarnessOverride ?? persistedHarnessId
  const canSwitchHarnessForModelSelection = !activeSession?.id || isDraftSession
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false)
  const [modelSearchQuery, setModelSearchQuery] = useState("")
  const [modelHarnessFilter, setModelHarnessFilter] = useState<ModelHarnessFilter>("all")
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [reasoningEffortOverride, setReasoningEffortOverride] = useState<RuntimeReasoningEffort | null>(null)
  const [modelVariantOverride, setModelVariantOverride] = useState<string | null | undefined>(undefined)
  const [fastModeOverride, setFastModeOverride] = useState<boolean | null>(null)

  useEffect(() => {
    setSelectedHarnessOverride(null)
  }, [selectedWorktreeId, activeSession?.id])

  useEffect(() => {
    if (selectedHarnessOverride && persistedHarnessId === selectedHarnessOverride) {
      setSelectedHarnessOverride(null)
    }
  }, [persistedHarnessId, selectedHarnessOverride])

  useEffect(() => {
    if (isModelPickerOpen) {
      setModelHarnessFilter("favorites")
    }
  }, [isModelPickerOpen])

  const modelsByHarness = useMemo<Record<HarnessId, typeof codexModels>>(
    () => ({
      codex: codexModels,
      "claude-code": claudeModels,
      opencode: openCodeModels,
    }),
    [claudeModels, codexModels, openCodeModels]
  )
  const modelLoadingByHarness = useMemo<Record<HarnessId, boolean>>(
    () => ({
      codex: isLoadingCodexModels,
      "claude-code": isLoadingClaudeModels,
      opencode: isLoadingOpenCodeModels,
    }),
    [isLoadingClaudeModels, isLoadingCodexModels, isLoadingOpenCodeModels]
  )
  const availableModels = selectedHarnessId ? modelsByHarness[selectedHarnessId] : codexModels
  const isLoadingModels = selectedHarnessId ? modelLoadingByHarness[selectedHarnessId] : isLoadingCodexModels
  const defaultModel = useMemo(
    () => availableModels.find((model) => model.isDefault) ?? availableModels[0] ?? null,
    [availableModels]
  )
  const sessionModelIdForComposer = activeSessionModelId
  const selectedHarnessDefaults = selectedHarnessId ? harnessDefaults[selectedHarnessId] : null
  const selectedHarnessDefinition = selectedHarnessId ? getHarnessDefinition(selectedHarnessId) : null
  const harnessDefaultModelId = selectedHarnessDefaults?.model ?? ""
  const effectiveModelId = useMemo(
    () =>
      resolveEffectiveComposerModelId({
        activeSessionModelId: sessionModelIdForComposer,
        composerSelectedModelId: selectedModelId,
        defaultModelId: harnessDefaultModelId || null,
        availableModelIds: availableModels.map((model) => model.id),
        runtimeDefaultModelId: defaultModel?.id ?? null,
      }),
    [
      availableModels,
      defaultModel?.id,
      harnessDefaultModelId,
      sessionModelIdForComposer,
      selectedModelId,
    ]
  )
  const effectiveModel = useMemo(
    () => availableModels.find((model) => model.id === effectiveModelId) ?? null,
    [availableModels, effectiveModelId]
  )
  const selectedModelLogoKind = useMemo(
    () =>
      effectiveModel
        ? getModelLogoKind(
            `${effectiveModel.displayName ?? ""} ${effectiveModel.id ?? ""}`,
            selectedHarnessId
          )
        : selectedModelId
          ? getModelLogoKind(selectedModelId, selectedHarnessId)
          : (selectedHarnessId
              ? getHarnessGroupMeta(selectedHarnessId).logoKind
              : "default"),
    [effectiveModel, selectedHarnessId, selectedModelId]
  )
  const modelGroups = useMemo<ModelGroup[]>(() => {
    const harnessIds = [
      ...(selectedHarnessId ? [selectedHarnessId] : []),
      ...MODEL_HARNESS_IDS.filter((harnessId) => harnessId !== selectedHarnessId),
    ]

    return harnessIds.map((harnessId) => {
      const harnessGroup = getHarnessGroupMeta(harnessId)
      const harnessModels = modelsByHarness[harnessId] ?? []

      return {
        ...harnessGroup,
        harnessId,
        isLoading: modelLoadingByHarness[harnessId] ?? false,
        models: harnessModels.map((model) => ({
          model,
          logoKind: getModelLogoKind(
            `${model.displayName ?? ""} ${model.id ?? ""}`,
            harnessId
          ),
        })),
      }
    })
  }, [modelLoadingByHarness, modelsByHarness, selectedHarnessId])
  const modelCatalogEntries = useMemo<ModelCatalogEntry[]>(
    () =>
      modelGroups.flatMap((group) =>
        group.models.map(({ model }) => ({
          key: `${group.harnessId}:${model.id}`,
          harnessId: group.harnessId,
          harnessLabel: group.label,
          harnessLogoKind: group.logoKind,
          model,
          label: getRuntimeModelLabel(model),
          subtitle: model.providerName ?? group.label,
          searchText: [
            getRuntimeModelLabel(model),
            model.id,
            model.providerName,
            group.label,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase(),
          disabled:
            !canSwitchHarnessForModelSelection && selectedHarnessId !== group.harnessId,
        }))
      ),
    [canSwitchHarnessForModelSelection, modelGroups, selectedHarnessId]
  )
  const favoriteModelKeySet = useMemo(() => new Set(favoriteModels), [favoriteModels])
  const catalogPinnedHarnessId =
    activeSession?.id || selectedModelId ? selectedHarnessId : null
  const catalogPinnedModelId =
    activeSession?.id || selectedModelId ? effectiveModelId : null
  const visibleModelCatalogEntries = useMemo(() => {
    const normalizedQuery = modelSearchQuery.trim().toLowerCase()

    const filteredEntries = modelCatalogEntries.filter((entry) => {
      if (modelHarnessFilter === "favorites") {
        if (!favoriteModelKeySet.has(entry.key)) {
          return false
        }
      } else if (modelHarnessFilter !== "all" && entry.harnessId !== modelHarnessFilter) {
        return false
      }

      if (!normalizedQuery) {
        return true
      }

      return entry.searchText.includes(normalizedQuery)
    })

    return [...filteredEntries].sort((left, right) => {
      const leftSelected = left.model.id === catalogPinnedModelId && left.harnessId === catalogPinnedHarnessId
      const rightSelected = right.model.id === catalogPinnedModelId && right.harnessId === catalogPinnedHarnessId
      if (leftSelected !== rightSelected) {
        return leftSelected ? -1 : 1
      }

      if (left.model.isDefault !== right.model.isDefault) {
        return left.model.isDefault ? -1 : 1
      }

      const labelComparison = left.label.localeCompare(right.label)
      if (labelComparison !== 0) {
        return labelComparison
      }

      return left.subtitle.localeCompare(right.subtitle)
    })
  }, [
    catalogPinnedHarnessId,
    catalogPinnedModelId,
    favoriteModelKeySet,
    modelCatalogEntries,
    modelHarnessFilter,
    modelSearchQuery,
  ])
  const availableReasoningEfforts = useMemo(() => {
    const supported = effectiveModel?.supportedReasoningEfforts?.filter((effort) => effort.trim().length > 0) ?? []
    const defaultEffort = effectiveModel?.defaultReasoningEffort?.trim() ?? null

    if (supported.length > 0) {
      return Array.from(new Set(supported))
    }

    return defaultEffort ? [defaultEffort] : []
  }, [effectiveModel])
  const harnessDefaultReasoningEffort = selectedHarnessDefaults?.reasoningEffort ?? null
  const reasoningEffort = useMemo(
    () =>
      resolveDefaultReasoningEffort({
        overrideReasoningEffort: reasoningEffortOverride,
        defaultReasoningEffort: harnessDefaultReasoningEffort,
        modelDefaultReasoningEffort: effectiveModel?.defaultReasoningEffort ?? null,
        supportedReasoningEfforts: availableReasoningEfforts,
      }),
    [
      availableReasoningEfforts,
      effectiveModel?.defaultReasoningEffort,
      harnessDefaultReasoningEffort,
      reasoningEffortOverride,
    ]
  )
  const availableModelVariants = useMemo(
    () =>
      (effectiveModel?.modelVariants ?? [])
        .map((variant) => ({
          ...variant,
          id: variant.id.trim(),
        }))
        .filter((variant) => variant.id.length > 0),
    [effectiveModel]
  )
  const modelVariantIds = useMemo(
    () => availableModelVariants.map((variant) => variant.id),
    [availableModelVariants]
  )
  const harnessDefaultModelVariant = selectedHarnessDefaults?.modelVariant ?? null
  const modelVariant = useMemo(
    () =>
      resolveDefaultModelVariant({
        overrideModelVariant: modelVariantOverride,
        defaultModelVariant: harnessDefaultModelVariant,
        modelDefaultVariant: effectiveModel?.defaultModelVariant ?? null,
        supportedModelVariants: modelVariantIds,
      }),
    [
      effectiveModel?.defaultModelVariant,
      harnessDefaultModelVariant,
      modelVariantIds,
      modelVariantOverride,
    ]
  )
  const supportsFastMode = effectiveModel?.supportsFastMode === true
  const harnessDefaultFastMode = selectedHarnessDefaults?.fastMode ?? false
  const fastMode = useMemo(
    () =>
      resolveDefaultFastMode({
        overrideFastMode: fastModeOverride,
        defaultFastMode: harnessDefaultFastMode,
        supportsFastMode,
      }),
    [fastModeOverride, harnessDefaultFastMode, supportsFastMode]
  )
  const toggleFastMode = useCallback(() => {
    const nextFastMode = fastModeOverride == null ? !fastMode : !fastModeOverride
    setFastModeOverride(nextFastMode)
    if (activeSession?.id) {
      void setSessionModelPreferences(activeSession.id, { fastMode: nextFastMode })
    }
  }, [activeSession?.id, fastMode, fastModeOverride, setSessionModelPreferences])
  const selectedModelLabel = effectiveModel
    ? getRuntimeModelLabel(effectiveModel)
    : selectedModelId
      ? selectedModelId
      : (isLoadingModels ? "Loading models..." : "Select model")
  const showReasoningEffortSelector = shouldShowReasoningEffortSelector({
    supportsReasoningEffort: selectedHarnessDefinition?.capabilities.supportsReasoningEffort === true,
    availableReasoningEfforts,
  })
  const showModelVariantSelector = shouldShowModelVariantSelector({
    availableModelVariants: modelVariantIds,
  })
  const isAnyModelCatalogLoading = modelGroups.some((group) => group.isLoading)
  const fastModeTooltipLabel = !supportsFastMode
    ? "Fast mode is not available for the selected model."
    : selectedHarnessId === "claude-code"
      ? "Up to 2.5x faster output at premium API pricing."
      : "Faster responses at 2x usage."

  useEffect(() => {
    if (!activeSession?.id) {
      return
    }

    const resolvedModelId = resolveSessionSelectedModelId(
      activeSessionModelId,
      availableModels.map((model) => model.id)
    )

    setSelectedModelId(resolvedModelId)
  }, [
    activeSession?.id,
    activeSessionModelId,
    availableModels,
    selectedHarnessId,
    selectedWorktreeId,
  ])

  useEffect(() => {
    setReasoningEffortOverride(activeSession?.reasoningEffort ?? null)
    setModelVariantOverride(
      activeSession && Object.prototype.hasOwnProperty.call(activeSession, "modelVariant")
        ? activeSession.modelVariant ?? null
        : undefined
    )
    setFastModeOverride(activeSession?.fastMode ?? null)
  }, [
    activeSession?.fastMode,
    activeSession?.id,
    activeSession?.modelVariant,
    activeSession?.reasoningEffort,
    selectedHarnessId,
    selectedWorktreeId,
  ])

  useEffect(() => {
    if (isModelPickerOpen) {
      return
    }

    setModelSearchQuery("")
    setModelHarnessFilter("all")
  }, [isModelPickerOpen])

  const handleSelectModel = useCallback(
    async (harnessId: HarnessId, modelId: string | null) => {
      const trimmedModelId = modelId?.trim() || null

      if (activeSession?.id && !isDraftSession && activeSession.harnessId !== harnessId) {
        return
      }

      flushSync(() => {
        setIsModelPickerOpen(false)
      })

      startTransition(() => {
        setSelectedModelId(trimmedModelId)
        setSelectedHarnessOverride(harnessId === persistedHarnessId ? null : harnessId)
      })

      if (!activeSession?.id) {
        return
      }

      void setSessionModel(activeSession.id, trimmedModelId)
    },
    [
      activeSession?.id,
      activeSession?.harnessId,
      isDraftSession,
      persistedHarnessId,
      setSessionModel,
    ]
  )
  const handleSelectReasoningEffort = useCallback(
    (effort: RuntimeReasoningEffort) => {
      setReasoningEffortOverride(effort)
      if (activeSession?.id) {
        void setSessionModelPreferences(activeSession.id, { reasoningEffort: effort })
      }
    },
    [activeSession?.id, setSessionModelPreferences]
  )
  const handleSelectModelVariant = useCallback(
    (variant: string | null) => {
      setModelVariantOverride(variant)
      if (activeSession?.id) {
        void setSessionModelPreferences(activeSession.id, { modelVariant: variant })
      }
    },
    [activeSession?.id, setSessionModelPreferences]
  )
  const modelPickerProps = useMemo<ModelPickerProps>(
    () => ({
      isOpen: isModelPickerOpen,
      onOpenChange: setIsModelPickerOpen,
      selectedModelLabel,
      selectedModelLogoKind,
      fastMode,
      supportsFastMode,
      canSwitchHarnessForModelSelection,
      effectiveModelId,
      favoriteModelKeySet,
      favoriteModels,
      isAnyModelCatalogLoading,
      modelGroups,
      modelHarnessFilter,
      modelSearchQuery,
      selectedHarnessId,
      setModelHarnessFilter,
      setModelSearchQuery,
      toggleFavoriteModel,
      visibleModelCatalogEntries,
      onSelectModel: handleSelectModel,
    }),
    [
      canSwitchHarnessForModelSelection,
      effectiveModelId,
      fastMode,
      favoriteModelKeySet,
      favoriteModels,
      handleSelectModel,
      isAnyModelCatalogLoading,
      isModelPickerOpen,
      modelGroups,
      modelHarnessFilter,
      modelSearchQuery,
      selectedHarnessId,
      selectedModelLabel,
      selectedModelLogoKind,
      supportsFastMode,
      toggleFavoriteModel,
      visibleModelCatalogEntries,
    ]
  )

  return {
    availableReasoningEfforts,
    availableModelVariants,
    effectiveModel,
    fastMode,
    fastModeTooltipLabel,
    handleSelectModelVariant,
    handleSelectReasoningEffort,
    isLoadingModels,
    modelVariant,
    modelPickerProps,
    reasoningEffort,
    selectedHarnessId,
    showModelVariantSelector,
    showReasoningEffortSelector,
    supportsFastMode,
    toggleFastMode,
  }
}
