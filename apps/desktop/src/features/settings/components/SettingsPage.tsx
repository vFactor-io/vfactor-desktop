import { useEffect, useMemo, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { getHarnessAdapter } from "@/features/chat/runtime/harnesses"
import type { RuntimeModel } from "@/features/chat/types"
import type { SettingsSectionId } from "@/features/settings/config"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
import { Button } from "@/features/shared/components/ui/button"
import {
  Field,
  FieldGroup,
  FieldTitle,
} from "@/features/shared/components/ui/field"
import { SearchableSelect } from "@/features/shared/components/ui/searchable-select"
import { UpdatesSection } from "@/features/updates/components/UpdatesSection"

interface SettingsPageProps {
  activeSection: SettingsSectionId
}

const SECTION_COPY: Record<SettingsSectionId, { title: string }> = {
  git: { title: "Git" },
  updates: { title: "Updates" },
}

function GitSettingsSection() {
  const gitGenerationModel = useSettingsStore((state) => state.gitGenerationModel)
  const initialize = useSettingsStore((state) => state.initialize)
  const setGitGenerationModel = useSettingsStore((state) => state.setGitGenerationModel)
  const resetGitGenerationModel = useSettingsStore((state) => state.resetGitGenerationModel)
  const [availableModels, setAvailableModels] = useState<RuntimeModel[]>([])
  const [isLoadingModels, setIsLoadingModels] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    void initialize()
  }, [initialize])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      setIsLoadingModels(true)
      setLoadError(null)

      try {
        const models = await getHarnessAdapter("codex").listModels()
        if (!cancelled) {
          setAvailableModels(models)
        }
      } catch (error) {
        console.error("[SettingsPage] Failed to load Codex models:", error)
        if (!cancelled) {
          setAvailableModels([])
          setLoadError(error instanceof Error ? error.message : "Unable to load models")
        }
      } finally {
        if (!cancelled) {
          setIsLoadingModels(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const defaultModel = useMemo(
    () => availableModels.find((model) => model.isDefault) ?? null,
    [availableModels]
  )

  const modelOptions = useMemo(() => {
    const opts = availableModels.map((m) => ({ value: m.id, label: m.id }))

    if (gitGenerationModel && !opts.some((o) => o.value === gitGenerationModel)) {
      opts.unshift({ value: gitGenerationModel, label: gitGenerationModel })
    }

    return opts
  }, [availableModels, gitGenerationModel])

  return (
    <section className="rounded-xl border border-border/80 bg-card text-card-foreground shadow-sm">
      <div className="px-4 py-4">
        <FieldGroup className="gap-3">
          <Field>
            <FieldTitle>Generation model</FieldTitle>
            <SearchableSelect
              value={gitGenerationModel || null}
              onValueChange={setGitGenerationModel}
              options={modelOptions}
              placeholder={defaultModel ? defaultModel.id : "Select a model"}
              searchPlaceholder="Search models"
              emptyMessage="No matching models found."
              disabled={isLoadingModels}
              className="mt-2"
              errorMessage={loadError}
              statusMessage={isLoadingModels ? "Loading models…" : null}
            />
          </Field>
        </FieldGroup>

        <div className="mt-3 flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={resetGitGenerationModel}>
            Use default
          </Button>
        </div>
      </div>
    </section>
  )
}

export function SettingsPage({ activeSection }: SettingsPageProps) {
  const section = SECTION_COPY[activeSection]

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
              {section.title}
            </h1>

            {activeSection === "git" ? <GitSettingsSection /> : <UpdatesSection />}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  )
}
