import { useEffect } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { SETTINGS_SECTIONS, type SettingsSectionId } from "@/features/settings/config"
import { DEFAULT_PR_TARGET_BRANCH } from "@/features/settings/createPrMessage"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
import { Button } from "@/features/shared/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldTitle,
} from "@/features/shared/components/ui/field"
import { Textarea } from "@/features/shared/components/ui/textarea"
import { UpdatesSection } from "@/features/updates/components/UpdatesSection"

interface SettingsPageProps {
  activeSection: SettingsSectionId
}

const SECTION_COPY: Record<SettingsSectionId, { title: string; description: string }> = {
  git: {
    title: "Git",
    description: "A built-in PR workflow message is generated automatically from git state. Add optional extra instructions here.",
  },
  updates: {
    title: "Updates",
    description: "Check for and install app updates.",
  },
}

function GitSettingsSection() {
  const createPrInstructions = useSettingsStore((state) => state.createPrInstructions)
  const initialize = useSettingsStore((state) => state.initialize)
  const setCreatePrInstructions = useSettingsStore((state) => state.setCreatePrInstructions)
  const resetCreatePrInstructions = useSettingsStore((state) => state.resetCreatePrInstructions)

  useEffect(() => {
    void initialize()
  }, [initialize])

  return (
    <section className="overflow-hidden rounded-xl border border-border/80 bg-card text-card-foreground shadow-sm">
      <div className="px-4 py-4">
        <FieldGroup className="gap-3">
          <Field>
            <FieldTitle>Additional PR instructions</FieldTitle>
            <FieldDescription>
              Appended after the built-in PR workflow message when the toolbar Create PR button is clicked.
            </FieldDescription>
            <Textarea
              value={createPrInstructions}
              onChange={(event) => setCreatePrInstructions(event.target.value)}
              className="mt-2 min-h-28 rounded-xl"
              placeholder="Optional extra instructions for PR creation"
            />
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Variables available here: <code>{"{{currentBranch}}"}</code>, <code>{"{{targetBranch}}"}</code>,{" "}
              <code>{"{{upstreamBranch}}"}</code>, <code>{"{{uncommittedChanges}}"}</code>. The default target branch is{" "}
              <code>{DEFAULT_PR_TARGET_BRANCH}</code>.
            </p>
          </Field>
        </FieldGroup>

        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs leading-5 text-muted-foreground">Stored locally on this machine.</p>
          <Button type="button" variant="outline" size="sm" onClick={resetCreatePrInstructions}>
            Clear
          </Button>
        </div>
      </div>
    </section>
  )
}

export function SettingsPage({ activeSection }: SettingsPageProps) {
  const sectionMeta = SETTINGS_SECTIONS.find((item) => item.id === activeSection)
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
            <header className="space-y-1 px-1 pt-1">
              <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/75">
                {sectionMeta?.label ?? "Settings"}
              </div>
              <h1 className="text-2xl font-medium tracking-tight text-main-content-foreground">
                {section.title}
              </h1>
              <p className="text-sm leading-6 text-muted-foreground">{section.description}</p>
            </header>

            {activeSection === "git" ? <GitSettingsSection /> : <UpdatesSection />}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  )
}
