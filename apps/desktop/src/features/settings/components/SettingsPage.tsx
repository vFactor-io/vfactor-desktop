import { useEffect, useMemo, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ChevronDownIcon } from "@/components/icons"
import { Button } from "@/features/shared/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/features/shared/components/ui/collapsible"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldTitle,
} from "@/features/shared/components/ui/field"
import { ButtonGroup, ButtonGroupText } from "@/features/shared/components/ui/button-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/features/shared/components/ui/select"
import { SearchableSelect } from "@/features/shared/components/ui/searchable-select"
import { Switch } from "@/features/shared/components/ui/switch"
import { Textarea } from "@/features/shared/components/ui/textarea"
import { getHarnessDefinition } from "@/features/chat/runtime/harnesses"
import { useModels } from "@/features/chat/hooks/useModels"
import { getRuntimeModelLabel } from "@/features/chat/domain/runtimeModels"
import type { HarnessId, RuntimeModel } from "@/features/chat/types"
import {
  DEFAULT_TEXT_SIZE_PX,
  DEFAULT_THEME_ID,
  MAX_TEXT_SIZE_PX,
  MIN_TEXT_SIZE_PX,
  TEXT_SIZE_STEP_PX,
  THEME_OPTIONS,
  useAppearance,
} from "@/features/shared/appearance"
import {
  resolveEffectiveComposerModelId,
} from "@/features/chat/components/chatInputModelSelection"
import type { SettingsSectionId } from "@/features/settings/config"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
import { UpdatesSection } from "@/features/updates/components/UpdatesSection"
import {
  GIT_RESOLVE_REASONS,
  GIT_RESOLVE_TEMPLATE_VARIABLES,
} from "@/features/shared/components/layout/gitResolve"
import type { GitPullRequestResolveReason } from "@/desktop/contracts"

interface SettingsPageProps {
  activeSection: SettingsSectionId
}

const RESOLVE_REASON_LABELS: Record<GitPullRequestResolveReason, string> = {
  conflicts: "Conflicts",
  behind: "Behind base branch",
  failed_checks: "Failed checks",
  blocked: "Blocked",
  draft: "Draft PR",
  unknown: "Unknown reason",
}

function useHarnessModelsState(harnessId: HarnessId) {
  const {
    models: availableModels,
    isLoading: isLoadingModels,
    error: loadError,
  } = useModels(harnessId)

  const runtimeDefaultModel = useMemo(
    () => availableModels.find((model) => model.isDefault) ?? availableModels[0] ?? null,
    [availableModels]
  )

  return {
    availableModels,
    isLoadingModels,
    loadError,
    runtimeDefaultModel,
  }
}

function buildModelOptions(
  availableModels: RuntimeModel[],
  additionalModelIds: Array<string | null | undefined> = []
) {
  const options = availableModels.map((model) => ({
    value: model.id,
    label: getRuntimeModelLabel(model, model.id),
  }))

  for (const modelId of additionalModelIds) {
    const normalizedModelId = modelId?.trim() ?? ""
    if (!normalizedModelId || options.some((option) => option.value === normalizedModelId)) {
      continue
    }

    options.unshift({ value: normalizedModelId, label: normalizedModelId })
  }

  return options
}

function buildReasoningOptions(model: RuntimeModel | null, additionalEffort?: string) {
  const options = Array.from(
    new Set(
      (model?.supportedReasoningEfforts ?? [])
        .map((effort) => effort.trim())
        .filter((effort) => effort.length > 0)
    )
  ).map((effort) => ({
    value: effort,
    label: effort,
  }))

  const normalizedAdditionalEffort = additionalEffort?.trim() ?? ""
  if (
    normalizedAdditionalEffort.length > 0 &&
    !options.some((option) => option.value === normalizedAdditionalEffort)
  ) {
    options.unshift({
      value: normalizedAdditionalEffort,
      label: normalizedAdditionalEffort,
    })
  }

  return options
}

function GitSettingsSection() {
  const gitGenerationModel = useSettingsStore((state) => state.gitGenerationModel)
  const gitResolvePrompts = useSettingsStore((state) => state.gitResolvePrompts)
  const workspaceSetupModel = useSettingsStore((state) => state.workspaceSetupModel)
  const hasLoaded = useSettingsStore((state) => state.hasLoaded)
  const initialize = useSettingsStore((state) => state.initialize)
  const setGitGenerationModel = useSettingsStore((state) => state.setGitGenerationModel)
  const setGitResolvePrompt = useSettingsStore((state) => state.setGitResolvePrompt)
  const resetGitResolvePrompts = useSettingsStore((state) => state.resetGitResolvePrompts)
  const resetGitGenerationModel = useSettingsStore((state) => state.resetGitGenerationModel)
  const setWorkspaceSetupModel = useSettingsStore((state) => state.setWorkspaceSetupModel)
  const resetWorkspaceSetupModel = useSettingsStore((state) => state.resetWorkspaceSetupModel)
  const [openResolvePrompts, setOpenResolvePrompts] = useState<
    Partial<Record<GitPullRequestResolveReason, boolean>>
  >({})
  const isSettingsLoading = !hasLoaded
  const { availableModels, isLoadingModels, loadError, runtimeDefaultModel } = useHarnessModelsState("codex")

  useEffect(() => {
    void initialize()
  }, [initialize])

  const modelOptions = useMemo(
    () => buildModelOptions(availableModels, [gitGenerationModel, workspaceSetupModel]),
    [availableModels, gitGenerationModel, workspaceSetupModel]
  )

  return (
    <section className="rounded-xl border border-border/80 bg-card text-card-foreground shadow-sm">
      <div className="px-4 py-4">
        <FieldGroup className="gap-3">
          <Field>
            <FieldTitle>Workspace setup model</FieldTitle>
            <SearchableSelect
              value={workspaceSetupModel || null}
              onValueChange={setWorkspaceSetupModel}
              options={modelOptions}
              placeholder={runtimeDefaultModel ? runtimeDefaultModel.id : "Select a model"}
              searchPlaceholder="Search models"
              emptyMessage="No matching models found."
              disabled={isSettingsLoading || isLoadingModels}
              className="mt-2"
              errorMessage={loadError}
              statusMessage={
                isSettingsLoading ? "Loading saved settings…" : isLoadingModels ? "Loading models…" : null
              }
            />
          </Field>

          <Field>
            <FieldTitle>Generation model</FieldTitle>
            <SearchableSelect
              value={gitGenerationModel || null}
              onValueChange={setGitGenerationModel}
              options={modelOptions}
              placeholder={runtimeDefaultModel ? runtimeDefaultModel.id : "Select a model"}
              searchPlaceholder="Search models"
              emptyMessage="No matching models found."
              disabled={isSettingsLoading || isLoadingModels}
              className="mt-2"
              errorMessage={loadError}
              statusMessage={
                isSettingsLoading ? "Loading saved settings…" : isLoadingModels ? "Loading models…" : null
              }
            />
          </Field>
        </FieldGroup>

        <div className="mt-6 space-y-3">
          <div className="space-y-1">
            <h2 className="text-sm font-medium text-card-foreground">Resolve prompts</h2>
            <p className="text-sm text-muted-foreground">
              These prompts are used when the header shows <span className="font-medium text-card-foreground">Resolve</span> for a blocked PR state.
            </p>
            <p className="text-xs leading-5 text-muted-foreground">
              Variables:{" "}
              {GIT_RESOLVE_TEMPLATE_VARIABLES.map((variable, index) => (
                <span key={variable}>
                  <code>{`{{${variable}}}`}</code>
                  {index < GIT_RESOLVE_TEMPLATE_VARIABLES.length - 1 ? ", " : ""}
                </span>
              ))}
            </p>
          </div>

          <FieldGroup className="gap-4">
            {GIT_RESOLVE_REASONS.map((reason) => (
              <Collapsible
                key={reason}
                open={openResolvePrompts[reason] === true}
                onOpenChange={(open) =>
                  setOpenResolvePrompts((current) => ({
                    ...current,
                    [reason]: open,
                  }))
                }
              >
                <div className="rounded-lg border border-border/70 bg-background/40">
                  <CollapsibleTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-auto w-full justify-between rounded-lg px-3 py-3 text-left"
                      />
                    }
                  >
                    <span className="flex flex-col items-start gap-1">
                      <span className="text-sm font-medium text-card-foreground">
                        {RESOLVE_REASON_LABELS[reason]}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Edit the prompt sent when GitHub reports this Resolve state.
                      </span>
                    </span>
                    <ChevronDownIcon className="size-4 shrink-0 transition-transform in-aria-[expanded=false]:-rotate-90" />
                  </CollapsibleTrigger>

                  <CollapsibleContent className="border-t border-border/70 px-3 py-3">
                    <Field>
                      <FieldDescription>
                        This prompt will be sent when GitHub reports this PR as needing the matching Resolve flow.
                      </FieldDescription>
                      <Textarea
                        className="mt-2 min-h-32 font-mono text-xs leading-5"
                        value={gitResolvePrompts[reason]}
                        onChange={(event) => setGitResolvePrompt(reason, event.target.value)}
                        disabled={isSettingsLoading}
                        spellCheck={false}
                      />
                    </Field>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            ))}
          </FieldGroup>
        </div>

        <div className="mt-3 flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={resetGitResolvePrompts} disabled={isSettingsLoading}>
            Reset resolve prompts
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={resetWorkspaceSetupModel} disabled={isSettingsLoading}>
            Reset setup model
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={resetGitGenerationModel} disabled={isSettingsLoading}>
            Reset generation model
          </Button>
        </div>
      </div>
    </section>
  )
}

function AppearanceSettingsSection() {
  const appearanceThemeId = useSettingsStore((state) => state.appearanceThemeId)
  const appearanceTextSizePx = useSettingsStore((state) => state.appearanceTextSizePx)
  const terminalLinkTarget = useSettingsStore((state) => state.terminalLinkTarget)
  const hasLoaded = useSettingsStore((state) => state.hasLoaded)
  const initialize = useSettingsStore((state) => state.initialize)
  const setAppearanceThemeId = useSettingsStore((state) => state.setAppearanceThemeId)
  const resetAppearanceThemeId = useSettingsStore((state) => state.resetAppearanceThemeId)
  const setAppearanceTextSizePx = useSettingsStore((state) => state.setAppearanceTextSizePx)
  const resetAppearanceTextSizePx = useSettingsStore((state) => state.resetAppearanceTextSizePx)
  const setTerminalLinkTarget = useSettingsStore((state) => state.setTerminalLinkTarget)
  const resetTerminalLinkTarget = useSettingsStore((state) => state.resetTerminalLinkTarget)
  const { resolvedAppearance, resolvedThemeId, monacoThemeId, pierreDiffTheme } = useAppearance()

  useEffect(() => {
    void initialize()
  }, [initialize])

  const isSettingsLoading = !hasLoaded
  const canDecreaseTextSize = appearanceTextSizePx > MIN_TEXT_SIZE_PX
  const canIncreaseTextSize = appearanceTextSizePx < MAX_TEXT_SIZE_PX
  const resolvedThemeLabel =
    THEME_OPTIONS.find((option) => option.id === resolvedThemeId)?.label ?? resolvedThemeId

  return (
    <section className="rounded-xl border border-border/80 bg-card text-card-foreground shadow-sm">
      <div className="space-y-5 px-4 py-4">
        <div className="space-y-1">
          <h2 className="text-sm font-medium text-card-foreground">App appearance</h2>
          <p className="text-sm text-muted-foreground">
            Theme and interface text size apply across the whole desktop app and stay local to this installation.
          </p>
        </div>

        <FieldGroup className="gap-4">
          <Field>
            <FieldTitle>Theme</FieldTitle>
            <FieldDescription>
              Choose a fixed theme or follow the operating system with the Nucleus light and dark pair.
            </FieldDescription>
            <Select
              value={appearanceThemeId}
              onValueChange={(value) => setAppearanceThemeId(value as typeof appearanceThemeId)}
            >
              <SelectTrigger className="mt-2 w-full" disabled={isSettingsLoading}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                {THEME_OPTIONS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {appearanceThemeId === "system"
                ? `Following system ${resolvedAppearance} mode using ${resolvedThemeLabel}.`
                : `${resolvedThemeLabel} is active with ${resolvedAppearance} appearance.`}
            </p>
          </Field>

          <Field>
            <FieldTitle>Interface text size</FieldTitle>
            <FieldDescription>
              Scales shared app chrome like settings, menus, sidebars, notices, and controls without changing editor or terminal fonts.
            </FieldDescription>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <ButtonGroup>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isSettingsLoading || !canDecreaseTextSize}
                  onClick={() => setAppearanceTextSizePx(appearanceTextSizePx - TEXT_SIZE_STEP_PX)}
                >
                  -
                </Button>
                <ButtonGroupText className="min-w-[4.5rem] justify-center tabular-nums">
                  {appearanceTextSizePx}px
                </ButtonGroupText>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isSettingsLoading || !canIncreaseTextSize}
                  onClick={() => setAppearanceTextSizePx(appearanceTextSizePx + TEXT_SIZE_STEP_PX)}
                >
                  +
                </Button>
              </ButtonGroup>
              <p className="text-xs leading-5 text-muted-foreground">
                Range {MIN_TEXT_SIZE_PX}px to {MAX_TEXT_SIZE_PX}px. Default is {DEFAULT_TEXT_SIZE_PX}px.
              </p>
            </div>
          </Field>

          <Field>
            <FieldTitle>Theme adapters</FieldTitle>
            <FieldDescription>
              Monaco and the PR patch viewer switch with appearance changes while the terminal continues reading CSS variables from the active theme.
            </FieldDescription>
            <div className="mt-2 rounded-lg border border-border/70 bg-background/45 px-3 py-3 text-sm text-muted-foreground">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>Resolved theme: <span className="font-medium text-foreground">{resolvedThemeLabel}</span></span>
                <span>Monaco: <span className="font-medium text-foreground">{monacoThemeId}</span></span>
                <span>Diffs: <span className="font-medium text-foreground">{pierreDiffTheme}</span></span>
              </div>
            </div>
          </Field>

          <Field>
            <FieldTitle>Dev terminal links</FieldTitle>
            <FieldDescription>
              Choose where clickable local dev server links from the project terminal should open.
            </FieldDescription>
            <Select
              value={terminalLinkTarget}
              onValueChange={(value) => setTerminalLinkTarget(value as typeof terminalLinkTarget)}
            >
              <SelectTrigger className="mt-2 w-full" disabled={isSettingsLoading}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                <SelectItem value="in-app">Open in app browser</SelectItem>
                <SelectItem value="system-browser">Open in system browser</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              The default is the in-app browser so local dev links open immediately inside Nucleus.
            </p>
          </Field>
        </FieldGroup>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={resetTerminalLinkTarget} disabled={isSettingsLoading || terminalLinkTarget === "in-app"}>
            Reset link target
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={resetAppearanceTextSizePx} disabled={isSettingsLoading || appearanceTextSizePx === DEFAULT_TEXT_SIZE_PX}>
            Reset text size
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={resetAppearanceThemeId} disabled={isSettingsLoading || appearanceThemeId === DEFAULT_THEME_ID}>
            Reset theme
          </Button>
        </div>
      </div>
    </section>
  )
}

function HarnessSettingsSection({ harnessId }: { harnessId: HarnessId }) {
  const isCodexHarness = harnessId === "codex"
  const harnessLabel = getHarnessDefinition(harnessId).label
  const codexDefaultModel = useSettingsStore((state) => state.codexDefaultModel)
  const codexDefaultReasoningEffort = useSettingsStore((state) => state.codexDefaultReasoningEffort)
  const codexDefaultFastMode = useSettingsStore((state) => state.codexDefaultFastMode)
  const claudeDefaultModel = useSettingsStore((state) => state.claudeDefaultModel)
  const claudeDefaultReasoningEffort = useSettingsStore((state) => state.claudeDefaultReasoningEffort)
  const claudeDefaultFastMode = useSettingsStore((state) => state.claudeDefaultFastMode)
  const hasLoaded = useSettingsStore((state) => state.hasLoaded)
  const initialize = useSettingsStore((state) => state.initialize)
  const setCodexDefaultModel = useSettingsStore((state) => state.setCodexDefaultModel)
  const resetCodexDefaultModel = useSettingsStore((state) => state.resetCodexDefaultModel)
  const setCodexDefaultReasoningEffort = useSettingsStore((state) => state.setCodexDefaultReasoningEffort)
  const resetCodexDefaultReasoningEffort = useSettingsStore((state) => state.resetCodexDefaultReasoningEffort)
  const setCodexDefaultFastMode = useSettingsStore((state) => state.setCodexDefaultFastMode)
  const resetCodexDefaultFastMode = useSettingsStore((state) => state.resetCodexDefaultFastMode)
  const setClaudeDefaultModel = useSettingsStore((state) => state.setClaudeDefaultModel)
  const resetClaudeDefaultModel = useSettingsStore((state) => state.resetClaudeDefaultModel)
  const setClaudeDefaultReasoningEffort = useSettingsStore((state) => state.setClaudeDefaultReasoningEffort)
  const resetClaudeDefaultReasoningEffort = useSettingsStore((state) => state.resetClaudeDefaultReasoningEffort)
  const setClaudeDefaultFastMode = useSettingsStore((state) => state.setClaudeDefaultFastMode)
  const resetClaudeDefaultFastMode = useSettingsStore((state) => state.resetClaudeDefaultFastMode)
  const isSettingsLoading = !hasLoaded
  const { availableModels, isLoadingModels, loadError, runtimeDefaultModel } = useHarnessModelsState(harnessId)

  useEffect(() => {
    void initialize()
  }, [initialize])

  const defaultModelValue = isCodexHarness ? codexDefaultModel : claudeDefaultModel
  const defaultReasoningEffortValue = isCodexHarness
    ? codexDefaultReasoningEffort
    : claudeDefaultReasoningEffort
  const defaultFastModeValue = isCodexHarness ? codexDefaultFastMode : claudeDefaultFastMode
  const setDefaultModel = isCodexHarness ? setCodexDefaultModel : setClaudeDefaultModel
  const resetDefaultModel = isCodexHarness ? resetCodexDefaultModel : resetClaudeDefaultModel
  const setDefaultReasoningEffort = isCodexHarness
    ? setCodexDefaultReasoningEffort
    : setClaudeDefaultReasoningEffort
  const resetDefaultReasoningEffort = isCodexHarness
    ? resetCodexDefaultReasoningEffort
    : resetClaudeDefaultReasoningEffort
  const setDefaultFastMode = isCodexHarness ? setCodexDefaultFastMode : setClaudeDefaultFastMode
  const resetDefaultFastMode = isCodexHarness ? resetCodexDefaultFastMode : resetClaudeDefaultFastMode

  const modelOptions = useMemo(
    () => buildModelOptions(availableModels, [defaultModelValue]),
    [availableModels, defaultModelValue]
  )
  const effectiveDefaultModelId = useMemo(
    () =>
      resolveEffectiveComposerModelId({
        activeSessionModelId: null,
        defaultModelId: defaultModelValue || null,
        availableModelIds: availableModels.map((model) => model.id),
        runtimeDefaultModelId: runtimeDefaultModel?.id ?? null,
      }),
    [availableModels, defaultModelValue, runtimeDefaultModel?.id]
  )
  const effectiveDefaultModel = useMemo(
    () => availableModels.find((model) => model.id === effectiveDefaultModelId) ?? null,
    [availableModels, effectiveDefaultModelId]
  )
  const reasoningOptions = useMemo(
    () => buildReasoningOptions(effectiveDefaultModel, defaultReasoningEffortValue),
    [defaultReasoningEffortValue, effectiveDefaultModel]
  )
  const supportsFastMode = effectiveDefaultModel?.supportsFastMode === true
  const reasoningPlaceholder =
    effectiveDefaultModel?.defaultReasoningEffort?.trim() || reasoningOptions[0]?.value || "Select reasoning"

  useEffect(() => {
    if (!hasLoaded || isLoadingModels || !defaultFastModeValue || supportsFastMode) {
      return
    }

    setDefaultFastMode(false)
  }, [defaultFastModeValue, hasLoaded, isLoadingModels, setDefaultFastMode, supportsFastMode])

  const introCopy = isCodexHarness
    ? "Choose the model behavior new Codex chats should start from. Fast mode is available when the selected model supports it and trades higher usage for more speed."
    : "Choose the model behavior new Claude chats should start from. Fast mode is currently available on Opus 4.6 and can deliver up to 2.5x faster output at premium API pricing."
  const fastModeDescription = isCodexHarness
    ? "Uses Codex fast mode when the selected model supports it. Faster responses at 2x usage."
    : "Uses Claude fast mode when the selected model supports it. Up to 2.5x faster output at premium API pricing."
  const unavailableFastModeCopy = isCodexHarness
    ? "Fast mode is not available for the current default model, so it stays off."
    : "Fast mode is not available for the current default Claude model, so it stays off."

  return (
    <section className="rounded-xl border border-border/80 bg-card text-card-foreground shadow-sm">
      <div className="space-y-5 px-4 py-4">
        <div className="space-y-1">
          <h2 className="text-sm font-medium text-card-foreground">{harnessLabel} runtime defaults</h2>
          <p className="text-sm text-muted-foreground">
            {introCopy}
          </p>
        </div>

        <FieldGroup className="gap-4">
          <Field>
            <FieldTitle>Default model</FieldTitle>
            <FieldDescription>
              Applies when a session has no explicit model override.
            </FieldDescription>
            <SearchableSelect
              value={defaultModelValue || null}
              onValueChange={setDefaultModel}
              options={modelOptions}
              placeholder={
                runtimeDefaultModel
                  ? getRuntimeModelLabel(runtimeDefaultModel, runtimeDefaultModel.id)
                  : "Select a model"
              }
              searchPlaceholder="Search models"
              emptyMessage="No matching models found."
              disabled={isSettingsLoading || isLoadingModels}
              className="mt-2"
              errorMessage={loadError}
              statusMessage={
                isSettingsLoading ? "Loading saved settings…" : isLoadingModels ? "Loading models…" : null
              }
            />
          </Field>

          <Field>
            <FieldTitle>Default reasoning</FieldTitle>
            <FieldDescription>
              Falls back to the model default when left unset or unsupported.
            </FieldDescription>
            <SearchableSelect
              value={defaultReasoningEffortValue || null}
              onValueChange={setDefaultReasoningEffort}
              options={reasoningOptions}
              placeholder={reasoningPlaceholder}
              searchPlaceholder="Search reasoning levels"
              emptyMessage="No reasoning options available for this model."
              disabled={isSettingsLoading || isLoadingModels || effectiveDefaultModel == null}
              className="mt-2"
              errorMessage={loadError}
              statusMessage={
                isSettingsLoading
                  ? "Loading saved settings…"
                  : isLoadingModels
                    ? "Loading models…"
                    : effectiveDefaultModel == null
                      ? "Choose a model first."
                      : null
              }
            />
          </Field>

          <Field orientation="horizontal" className="items-start gap-3">
            <div className="flex-1 space-y-1">
              <FieldTitle>Fast mode by default</FieldTitle>
              <FieldDescription>
                {fastModeDescription}
              </FieldDescription>
            </div>
            <Switch
              checked={defaultFastModeValue}
              onCheckedChange={(checked) => setDefaultFastMode(checked === true)}
              disabled={isSettingsLoading || isLoadingModels || !supportsFastMode}
              aria-label={`Toggle ${harnessLabel} fast mode default`}
            />
          </Field>
          {!supportsFastMode ? (
            <p className="text-xs leading-5 text-muted-foreground">
              {unavailableFastModeCopy}
            </p>
          ) : null}
        </FieldGroup>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={resetDefaultFastMode} disabled={isSettingsLoading}>
            Reset fast mode
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={resetDefaultReasoningEffort} disabled={isSettingsLoading}>
            Reset reasoning
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={resetDefaultModel} disabled={isSettingsLoading}>
            Reset model
          </Button>
        </div>
      </div>
    </section>
  )
}

function getSettingsSectionTitle(activeSection: SettingsSectionId): string {
  if (activeSection === "appearance") {
    return "Appearance"
  }

  if (activeSection === "git") {
    return "Git"
  }

  if (activeSection === "updates") {
    return "Updates"
  }

  return getHarnessDefinition(activeSection).label
}

function renderSettingsSection(activeSection: SettingsSectionId) {
  if (activeSection === "appearance") {
    return <AppearanceSettingsSection />
  }

  if (activeSection === "git") {
    return <GitSettingsSection />
  }

  if (activeSection === "updates") {
    return <UpdatesSection />
  }

  if (activeSection === "codex" || activeSection === "claude-code") {
    return <HarnessSettingsSection harnessId={activeSection} />
  }

  return null
}

export function SettingsPage({ activeSection }: SettingsPageProps) {
  const sectionTitle = getSettingsSectionTitle(activeSection)

  return (
    <section className="h-full overflow-y-auto bg-main-content px-4 py-4 text-main-content-foreground sm:px-5">
      <div className="mx-auto flex max-w-[860px] flex-col gap-4 pb-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeSection}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-4"
          >
            <h1 className="px-1 pt-1 text-2xl font-medium tracking-tight text-main-content-foreground">
              {sectionTitle}
            </h1>

            {renderSettingsSection(activeSection)}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  )
}
