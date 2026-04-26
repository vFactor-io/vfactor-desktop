export function resolveSessionSelectedModelId(
  activeSessionModelId: string | null,
  availableModelIds: string[]
): string | null {
  const normalizedModelId = activeSessionModelId?.trim() ?? null

  if (!normalizedModelId) {
    return null
  }

  return availableModelIds.includes(normalizedModelId) ? normalizedModelId : null
}

interface ResolveComposerModelIdParams {
  activeSessionModelId: string | null
  composerSelectedModelId?: string | null
  defaultModelId: string | null
  availableModelIds: string[]
  runtimeDefaultModelId: string | null
}

function normalizeModelId(modelId: string | null | undefined): string | null {
  const normalizedModelId = modelId?.trim() ?? null
  return normalizedModelId ? normalizedModelId : null
}

function parseGptReleaseModelId(modelId: string | null | undefined): {
  major: number
  minor: number
} | null {
  const match = modelId?.trim().match(/^gpt-(\d+)\.(\d+)$/)
  if (!match) {
    return null
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
  }
}

function shouldPreferNewerRuntimeDefault(
  defaultModelId: string | null,
  runtimeDefaultModelId: string | null
): boolean {
  const savedDefault = parseGptReleaseModelId(defaultModelId)
  const runtimeDefault = parseGptReleaseModelId(runtimeDefaultModelId)

  if (!savedDefault || !runtimeDefault) {
    return false
  }

  return (
    runtimeDefault.major > savedDefault.major ||
    (runtimeDefault.major === savedDefault.major && runtimeDefault.minor > savedDefault.minor)
  )
}

export function resolveEffectiveComposerModelId({
  activeSessionModelId,
  composerSelectedModelId,
  defaultModelId,
  availableModelIds,
  runtimeDefaultModelId,
}: ResolveComposerModelIdParams): string | null {
  const normalizedSessionModelId = normalizeModelId(activeSessionModelId)
  if (normalizedSessionModelId && availableModelIds.includes(normalizedSessionModelId)) {
    return normalizedSessionModelId
  }

  const normalizedComposerSelectedModelId = normalizeModelId(composerSelectedModelId)
  if (
    normalizedComposerSelectedModelId &&
    availableModelIds.includes(normalizedComposerSelectedModelId)
  ) {
    return normalizedComposerSelectedModelId
  }

  const normalizedDefaultModelId = normalizeModelId(defaultModelId)
  const normalizedRuntimeDefaultModelId = normalizeModelId(runtimeDefaultModelId)

  if (
    normalizedRuntimeDefaultModelId &&
    availableModelIds.includes(normalizedRuntimeDefaultModelId) &&
    shouldPreferNewerRuntimeDefault(normalizedDefaultModelId, normalizedRuntimeDefaultModelId)
  ) {
    return normalizedRuntimeDefaultModelId
  }

  if (normalizedDefaultModelId && availableModelIds.includes(normalizedDefaultModelId)) {
    return normalizedDefaultModelId
  }

  if (
    normalizedRuntimeDefaultModelId &&
    availableModelIds.includes(normalizedRuntimeDefaultModelId)
  ) {
    return normalizedRuntimeDefaultModelId
  }

  return availableModelIds[0] ?? null
}

interface ResolveReasoningEffortParams {
  overrideReasoningEffort: string | null
  defaultReasoningEffort: string | null
  modelDefaultReasoningEffort: string | null | undefined
  supportedReasoningEfforts: string[] | null | undefined
}

function normalizeReasoningEffort(effort: string | null | undefined): string | null {
  const normalizedEffort = effort?.trim() ?? null
  return normalizedEffort ? normalizedEffort : null
}

export function resolveDefaultReasoningEffort({
  overrideReasoningEffort,
  defaultReasoningEffort,
  modelDefaultReasoningEffort,
  supportedReasoningEfforts,
}: ResolveReasoningEffortParams): string | null {
  const normalizedSupportedReasoningEfforts = Array.from(
    new Set(
      (supportedReasoningEfforts ?? [])
        .map((effort) => effort.trim())
        .filter((effort) => effort.length > 0)
    )
  )
  const supportsReasoningEffort = (effort: string | null) =>
    effort != null && normalizedSupportedReasoningEfforts.includes(effort)

  const normalizedOverrideReasoningEffort = normalizeReasoningEffort(overrideReasoningEffort)
  if (supportsReasoningEffort(normalizedOverrideReasoningEffort)) {
    return normalizedOverrideReasoningEffort
  }

  const normalizedDefaultReasoningEffort = normalizeReasoningEffort(defaultReasoningEffort)
  if (supportsReasoningEffort(normalizedDefaultReasoningEffort)) {
    return normalizedDefaultReasoningEffort
  }

  const normalizedModelDefaultReasoningEffort = normalizeReasoningEffort(
    modelDefaultReasoningEffort
  )
  if (supportsReasoningEffort(normalizedModelDefaultReasoningEffort)) {
    return normalizedModelDefaultReasoningEffort
  }

  return normalizedSupportedReasoningEfforts[0] ?? null
}

interface ResolveDefaultModelVariantParams {
  overrideModelVariant: string | null | undefined
  defaultModelVariant: string | null
  modelDefaultVariant: string | null | undefined
  supportedModelVariants: string[] | null | undefined
}

function normalizeModelVariant(variant: string | null | undefined): string | null {
  const normalizedVariant = variant?.trim() ?? null
  return normalizedVariant ? normalizedVariant : null
}

export function resolveDefaultModelVariant({
  overrideModelVariant,
  defaultModelVariant,
  modelDefaultVariant,
  supportedModelVariants,
}: ResolveDefaultModelVariantParams): string | null {
  const normalizedSupportedModelVariants = Array.from(
    new Set(
      (supportedModelVariants ?? [])
        .map((variant) => variant.trim())
        .filter((variant) => variant.length > 0)
    )
  )
  const supportsModelVariant = (variant: string | null) =>
    variant != null && normalizedSupportedModelVariants.includes(variant)

  const normalizedOverrideModelVariant = normalizeModelVariant(overrideModelVariant)
  if (overrideModelVariant === null) {
    return null
  }

  if (supportsModelVariant(normalizedOverrideModelVariant)) {
    return normalizedOverrideModelVariant
  }

  const normalizedDefaultModelVariant = normalizeModelVariant(defaultModelVariant)
  if (supportsModelVariant(normalizedDefaultModelVariant)) {
    return normalizedDefaultModelVariant
  }

  const normalizedModelDefaultVariant = normalizeModelVariant(modelDefaultVariant)
  if (supportsModelVariant(normalizedModelDefaultVariant)) {
    return normalizedModelDefaultVariant
  }

  return null
}

interface ResolveFastModeParams {
  overrideFastMode: boolean | null
  defaultFastMode: boolean
  supportsFastMode: boolean
}

export function resolveDefaultFastMode({
  overrideFastMode,
  defaultFastMode,
  supportsFastMode,
}: ResolveFastModeParams): boolean {
  if (!supportsFastMode) {
    return false
  }

  if (overrideFastMode != null) {
    return overrideFastMode
  }

  return defaultFastMode === true
}

interface ShouldShowReasoningEffortSelectorParams {
  supportsReasoningEffort: boolean
  availableReasoningEfforts: string[]
}

export function shouldShowReasoningEffortSelector({
  supportsReasoningEffort,
  availableReasoningEfforts,
}: ShouldShowReasoningEffortSelectorParams): boolean {
  if (!supportsReasoningEffort) {
    return false
  }

  return availableReasoningEfforts.some((effort) => effort.trim().length > 0)
}

interface ShouldShowModelVariantSelectorParams {
  availableModelVariants: string[]
}

export function shouldShowModelVariantSelector({
  availableModelVariants,
}: ShouldShowModelVariantSelectorParams): boolean {
  return availableModelVariants.some((variant) => variant.trim().length > 0)
}
