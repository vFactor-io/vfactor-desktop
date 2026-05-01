import { memo, type Dispatch, type SetStateAction } from "react"
import {
  CaretDown,
  CheckCircle,
  Compass,
  Heart,
  MagnifyingGlass,
  Zap,
} from "@/components/icons"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/features/shared/components/ui/dropdown-menu"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/features/shared/components/ui/input-group"
import type { HarnessId, RuntimeModel } from "../types"
import { listHarnesses } from "../runtime/harnesses"
import { getRuntimeModelLabel } from "../domain/runtimeModels"
import { ModelLogo, type ModelLogoKind } from "./ModelLogo"
import { cn } from "@/lib/utils"

export const MODEL_HARNESS_IDS: HarnessId[] = listHarnesses().map((harness) => harness.id)

export type ModelCatalogEntry = {
  key: string
  harnessId: HarnessId
  harnessLabel: string
  harnessLogoKind: ModelLogoKind
  model: RuntimeModel
  label: string
  subtitle: string
  searchText: string
  disabled: boolean
}

export type ModelGroup = {
  key: string
  label: string
  logoKind: ModelLogoKind
  harnessId: HarnessId
  isLoading: boolean
  models: Array<{
    model: RuntimeModel
    logoKind: ModelLogoKind
  }>
}

export type ModelHarnessFilter = "favorites" | "all" | HarnessId

export function getHarnessGroupMeta(selectedHarnessId: HarnessId | null): {
  key: string
  label: string
  logoKind: ModelLogoKind
} {
  if (selectedHarnessId === "opencode") {
    return {
      key: "opencode",
      label: "OpenCode",
      logoKind: "opencode",
    }
  }

  if (selectedHarnessId === "claude-code") {
    return {
      key: "claude",
      label: "Claude",
      logoKind: "claude",
    }
  }

  return {
    key: "codex",
    label: "Codex",
    logoKind: "codex",
  }
}

interface ModelPickerDropdownContentProps {
  canSwitchHarnessForModelSelection: boolean
  effectiveModelId: string | null
  favoriteModelKeySet: Set<string>
  favoriteModels: string[]
  isAnyModelCatalogLoading: boolean
  modelGroups: ModelGroup[]
  modelHarnessFilter: ModelHarnessFilter
  modelSearchQuery: string
  selectedHarnessId: HarnessId | null
  setModelHarnessFilter: Dispatch<SetStateAction<ModelHarnessFilter>>
  setModelSearchQuery: Dispatch<SetStateAction<string>>
  toggleFavoriteModel: (modelKey: string) => void
  visibleModelCatalogEntries: ModelCatalogEntry[]
  onSelectModel: (harnessId: HarnessId, modelId: string | null) => void
}

const ModelPickerDropdownContent = memo(function ModelPickerDropdownContent({
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
  onSelectModel,
}: ModelPickerDropdownContentProps) {
  return (
    <div className="flex h-full min-w-0 bg-card">
      <div className="flex w-14 shrink-0 flex-col border-r border-border/70 bg-[color-mix(in_oklab,var(--muted)_18%,transparent)] p-1.5">
        <div className="space-y-0.5">
          <button
            type="button"
            onClick={() =>
              setModelHarnessFilter((current) =>
                current === "favorites" ? "all" : "favorites"
              )
            }
            aria-label="Show favorite models"
            title="Favorite models"
            className={cn(
              "model-picker-control group relative isolate flex h-10 w-full items-center justify-center overflow-hidden rounded-md transition-colors",
              modelHarnessFilter === "favorites"
                ? "text-foreground"
                : "text-muted-foreground hover:bg-[var(--sidebar-item-hover)] hover:text-foreground"
            )}
          >
            {modelHarnessFilter === "favorites" ? (
              <div
                className="model-picker-control absolute inset-0 z-0 rounded-md bg-[var(--sidebar-item-active)]"
              />
            ) : null}
            <span className="relative z-10 flex items-center justify-center">
              <Heart
                className="size-4.5 shrink-0"
                weight={favoriteModels.length > 0 ? "fill" : "regular"}
              />
            </span>
          </button>
          <button
            type="button"
            onClick={() => setModelHarnessFilter("all")}
            aria-label="Show all harnesses"
            title="All harnesses"
            className={cn(
              "model-picker-control group relative isolate flex h-10 w-full items-center justify-center overflow-hidden rounded-md transition-colors",
              modelHarnessFilter === "all"
                ? "text-foreground"
                : "text-muted-foreground hover:bg-[var(--sidebar-item-hover)] hover:text-foreground"
            )}
          >
            {modelHarnessFilter === "all" ? (
              <div
                className="model-picker-control absolute inset-0 z-0 rounded-md bg-[var(--sidebar-item-active)]"
              />
            ) : null}
            <span className="relative z-10 flex items-center justify-center">
              <Compass className="size-4.5 shrink-0" />
            </span>
          </button>
          {modelGroups.map((group) => (
            <button
              key={group.key}
              type="button"
              onClick={() =>
                setModelHarnessFilter((current) =>
                  current === group.harnessId ? "all" : group.harnessId
                )
              }
              aria-label={group.label}
              title={group.label}
              className={cn(
                "model-picker-control group relative isolate flex h-10 w-full items-center justify-center overflow-hidden rounded-md transition-colors",
                modelHarnessFilter === group.harnessId
                  ? "text-foreground"
                  : "text-muted-foreground hover:bg-[var(--sidebar-item-hover)] hover:text-foreground"
              )}
            >
              {modelHarnessFilter === group.harnessId ? (
                <div
                  className="model-picker-control absolute inset-0 z-0 rounded-md bg-[var(--sidebar-item-active)]"
                />
              ) : null}
              <span className="relative z-10 flex items-center justify-center">
                <ModelLogo kind={group.logoKind} className="size-5 shrink-0" />
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-border/70 px-2 py-2">
          <InputGroup className="h-8">
            <InputGroupAddon align="inline-start">
              <MagnifyingGlass className="size-3.5" />
            </InputGroupAddon>
            <InputGroupInput
              value={modelSearchQuery}
              onChange={(event) => setModelSearchQuery(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
              placeholder="Search models..."
              autoComplete="off"
            />
          </InputGroup>
          {!canSwitchHarnessForModelSelection ? (
            <p className="mt-2 text-xs text-muted-foreground">
              This chat is locked to {getHarnessGroupMeta(selectedHarnessId).label}. Start a new chat to switch harnesses.
            </p>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {visibleModelCatalogEntries.length > 0 ? (
            <div className="space-y-0.5">
              {visibleModelCatalogEntries.map((entry) => {
                const isSelected =
                  entry.model.id === effectiveModelId &&
                  entry.harnessId === selectedHarnessId

                return (
                  <div
                    key={entry.key}
                    className={cn(
                      "model-picker-row flex h-7 items-center gap-1 rounded-md px-1 text-left transition-colors",
                      isSelected
                        ? "bg-[var(--sidebar-item-active)] text-foreground"
                        : "hover:bg-[var(--sidebar-item-hover)] hover:text-foreground",
                      entry.disabled && "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-inherit"
                    )}
                  >
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        toggleFavoriteModel(entry.key)
                      }}
                      aria-label={
                        favoriteModelKeySet.has(entry.key)
                          ? `Remove ${entry.label} from favorites`
                          : `Add ${entry.label} to favorites`
                      }
                      title={
                        favoriteModelKeySet.has(entry.key)
                          ? "Remove from favorites"
                          : "Add to favorites"
                      }
                      className={cn(
                        "model-picker-icon-button flex size-6 shrink-0 items-center justify-center rounded-sm transition-colors",
                        isSelected
                          ? "text-foreground/78 hover:text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Heart
                        className="size-3.5"
                        weight={favoriteModelKeySet.has(entry.key) ? "fill" : "regular"}
                      />
                    </button>
                    <button
                      type="button"
                      disabled={entry.disabled}
                      onClick={() => onSelectModel(entry.harnessId, entry.model.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 disabled:cursor-not-allowed"
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        {modelHarnessFilter === "all" || modelHarnessFilter === "favorites" ? (
                          <ModelLogo
                            kind={entry.harnessLogoKind}
                            className="size-3.5 shrink-0"
                          />
                        ) : null}
                        <span className="truncate text-sm font-medium leading-5">
                          {entry.label}
                        </span>
                        <span className={cn(
                          "shrink-0 text-xs leading-4",
                          isSelected ? "text-foreground/70" : "text-muted-foreground"
                        )}>
                          {entry.subtitle}
                        </span>
                      </span>
                      {isSelected ? (
                        <CheckCircle className="size-3 shrink-0 text-foreground/70" />
                      ) : null}
                    </button>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex h-full min-h-32 items-center justify-center px-4 text-center text-sm text-muted-foreground">
              {isAnyModelCatalogLoading
                ? "Loading models..."
                : modelSearchQuery.trim().length > 0
                  ? "No models match that search."
                  : "No models available."}
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

interface ModelPickerProps extends ModelPickerDropdownContentProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  selectedModelLabel: string
  selectedModelLogoKind: ModelLogoKind
  fastMode: boolean
  supportsFastMode: boolean
}

export const ModelPicker = memo(function ModelPicker({
  isOpen,
  onOpenChange,
  selectedModelLabel,
  selectedModelLogoKind,
  fastMode,
  supportsFastMode,
  ...contentProps
}: ModelPickerProps) {
  return (
    <DropdownMenu open={isOpen} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        className="model-picker-trigger inline-flex h-7 items-center gap-2 rounded-md px-1 text-sm text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
        aria-label={selectedModelLabel}
        title={selectedModelLabel}
      >
        {fastMode && supportsFastMode ? (
          <Zap weight="fill" className="size-4 shrink-0 text-[color:var(--color-warning)]" />
        ) : (
          <ModelLogo kind={selectedModelLogoKind} className="size-[18px] shrink-0" />
        )}
        <span>{selectedModelLabel}</span>
        <CaretDown className="size-3 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="model-picker-surface composer-layer-surface h-[min(24rem,calc(100vh-1rem))] w-[min(30rem,calc(100vw-1rem))] overflow-hidden rounded-xl p-0"
      >
        <ModelPickerDropdownContent {...contentProps} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
