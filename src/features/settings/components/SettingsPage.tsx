import { motion, AnimatePresence } from "framer-motion"
import { SETTINGS_SECTIONS, type SettingsSectionId } from "@/features/settings/config"
import { Switch } from "@/features/shared/components/ui/switch"
import { cn } from "@/lib/utils"

type SettingControl =
  | { type: "pill"; value: string }
  | { type: "toggle"; enabled: boolean }
  | { type: "segmented"; value: string; options: string[] }
  | { type: "input"; value: string; suffix?: string }

interface SettingRowDefinition {
  title: string
  description: string
  control: SettingControl
}

interface SettingGroupDefinition {
  title?: string
  rows: SettingRowDefinition[]
}

interface SettingsPageProps {
  activeSection: SettingsSectionId
}

const SETTINGS_CONTENT: Record<
  SettingsSectionId,
  { title: string; description: string; groups: SettingGroupDefinition[] }
> = {
  general: {
    title: "General",
    description: "Core behavior, thread defaults, and basic application preferences.",
    groups: [
      {
        rows: [
          {
            title: "Default open destination",
            description: "Where files and folders open by default.",
            control: { type: "pill", value: "Current project" },
          },
          {
            title: "Language",
            description: "Language for the app UI.",
            control: { type: "pill", value: "Auto detect" },
          },
          {
            title: "Thread detail",
            description: "Choose how much command output to show in threads.",
            control: { type: "pill", value: "Steps with code commands" },
          },
          {
            title: "Prevent sleep while running",
            description: "Keep your computer awake while an agent is running a thread.",
            control: { type: "toggle", enabled: true },
          },
          {
            title: "Require Cmd + Enter for long prompts",
            description: "When enabled, multiline prompts require Cmd + Enter to send.",
            control: { type: "toggle", enabled: false },
          },
          {
            title: "Speed",
            description: "Choose how quickly inference runs across threads and subagents.",
            control: { type: "pill", value: "Fast" },
          },
          {
            title: "Follow-up behavior",
            description: "Queue follow-ups while a run is active or steer the current run.",
            control: { type: "segmented", value: "Queue", options: ["Queue", "Steer"] },
          },
        ],
      },
      {
        title: "Appearance",
        rows: [
          {
            title: "Theme",
            description: "Use light, dark, or match your system.",
            control: { type: "segmented", value: "System", options: ["Light", "Dark", "System"] },
          },
          {
            title: "Use opaque window background",
            description: "Use a solid background rather than system translucency.",
            control: { type: "toggle", enabled: false },
          },
          {
            title: "Use pointer cursors",
            description: "Change the cursor to a pointer over interactive elements.",
            control: { type: "toggle", enabled: true },
          },
        ],
      },
    ],
  },
  configuration: {
    title: "Configuration",
    description: "Stubbed configuration surfaces for runtime and connection defaults.",
    groups: [
      {
        rows: [
          {
            title: "Default harness",
            description: "Choose which agent harness new threads use by default.",
            control: { type: "pill", value: "Ask each time" },
          },
          {
            title: "Connection profile",
            description: "Define how local runtimes are discovered and attached.",
            control: { type: "pill", value: "Local desktop" },
          },
          {
            title: "Experimental features",
            description: "Reserved area for upcoming harness-specific experiments.",
            control: { type: "toggle", enabled: false },
          },
        ],
      },
    ],
  },
  personalization: {
    title: "Personalization",
    description: "Stubs for typography, density, and layout preferences.",
    groups: [
      {
        rows: [
          {
            title: "Sidebar density",
            description: "Control how compact projects and threads feel.",
            control: { type: "pill", value: "Comfortable" },
          },
          {
            title: "Message text size",
            description: "Choose the default reading size inside threads.",
            control: { type: "input", value: "14", suffix: "px" },
          },
          {
            title: "Accent treatment",
            description: "Reserved for future brand and accent controls.",
            control: { type: "pill", value: "Subtle" },
          },
        ],
      },
    ],
  },
  "mcp-servers": {
    title: "MCP servers",
    description: "A placeholder area for server connections and permissions.",
    groups: [
      {
        rows: [
          {
            title: "Server registry",
            description: "Review and manage configured MCP endpoints.",
            control: { type: "pill", value: "Coming soon" },
          },
          {
            title: "Trust prompts",
            description: "Decide how server permissions should be confirmed.",
            control: { type: "pill", value: "Ask before connect" },
          },
        ],
      },
    ],
  },
  git: {
    title: "Git",
    description: "Reserved settings for repository actions and branch behavior.",
    groups: [
      {
        rows: [
          {
            title: "Default branch prefix",
            description: "Used when Nucleus creates working branches on your behalf.",
            control: { type: "input", value: "codex/" },
          },
          {
            title: "Show diff previews",
            description: "Automatically surface file diffs when tools modify code.",
            control: { type: "toggle", enabled: true },
          },
        ],
      },
    ],
  },
  environments: {
    title: "Environments",
    description: "Stubbed controls for shells, paths, and execution defaults.",
    groups: [
      {
        rows: [
          {
            title: "Default shell",
            description: "Choose which shell new command sessions use.",
            control: { type: "pill", value: "zsh" },
          },
          {
            title: "Workspace root policy",
            description: "Define how project roots are exposed to harnesses.",
            control: { type: "pill", value: "Project scoped" },
          },
        ],
      },
    ],
  },
  worktrees: {
    title: "Worktrees",
    description: "Reserved space for isolated branches and workspace clones.",
    groups: [
      {
        rows: [
          {
            title: "Create disposable worktrees",
            description: "Spin up temporary working copies for risky changes.",
            control: { type: "toggle", enabled: false },
          },
          {
            title: "Default location",
            description: "Choose where generated worktrees live on disk.",
            control: { type: "pill", value: "Next to project" },
          },
        ],
      },
    ],
  },
  "archived-threads": {
    title: "Archived threads",
    description: "A placeholder for future thread retention and recovery settings.",
    groups: [
      {
        rows: [
          {
            title: "Auto-archive completed runs",
            description: "Move quiet threads out of the main list after inactivity.",
            control: { type: "toggle", enabled: false },
          },
          {
            title: "Retention window",
            description: "Choose how long archived threads remain visible.",
            control: { type: "pill", value: "Keep indefinitely" },
          },
        ],
      },
    ],
  },
}

function SettingPill({ value }: { value: string }) {
  return (
    <div className="inline-flex min-h-10 min-w-[248px] items-center rounded-2xl border border-border/80 bg-muted/50 px-4 text-sm font-medium text-foreground">
      {value}
    </div>
  )
}

function SettingToggle({ enabled }: { enabled: boolean }) {
  return <Switch checked={enabled} disabled className="opacity-100" />
}

function SettingSegmented({
  value,
  options,
}: {
  value: string
  options: string[]
}) {
  return (
    <div className="inline-flex min-h-10 items-center rounded-2xl border border-border/80 bg-muted/50 p-1 text-sm text-muted-foreground">
      {options.map((option) => {
        const isActive = option === value

        return (
          <div
            key={option}
            className={cn(
              "rounded-xl px-3 py-1.5 font-medium transition-colors",
              isActive ? "bg-card text-card-foreground ring-1 ring-border/70" : "text-muted-foreground",
            )}
          >
            {option}
          </div>
        )
      })}
    </div>
  )
}

function SettingInput({
  value,
  suffix,
}: {
  value: string
  suffix?: string
}) {
  return (
    <div className="inline-flex min-h-10 items-center gap-2 text-sm text-muted-foreground">
      <div className="inline-flex min-w-[108px] items-center justify-center rounded-2xl border border-border/80 bg-muted/50 px-4 py-2.5 font-medium text-foreground">
        {value}
      </div>
      {suffix ? <span>{suffix}</span> : null}
    </div>
  )
}

function SettingControlView({ control }: { control: SettingControl }) {
  switch (control.type) {
    case "pill":
      return <SettingPill value={control.value} />
    case "toggle":
      return <SettingToggle enabled={control.enabled} />
    case "segmented":
      return <SettingSegmented value={control.value} options={control.options} />
    case "input":
      return <SettingInput value={control.value} suffix={control.suffix} />
  }
}

function SettingsGroup({ title, rows }: SettingGroupDefinition) {
  return (
    <section>
      {title ? (
        <div className="mb-4 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/80">
          {title}
        </div>
      ) : null}
      <div className="overflow-hidden rounded-[22px] border border-border/80 bg-card text-card-foreground shadow-sm">
        {rows.map((row, index) => (
          <div
            key={row.title}
            className={cn(
              "flex min-h-[92px] items-center justify-between gap-8 px-5 py-4",
              index !== 0 && "border-t border-border/70",
            )}
          >
            <div className="max-w-[440px]">
              <div className="text-sm font-medium tracking-tight text-card-foreground">{row.title}</div>
              <div className="mt-1.5 text-sm leading-6 text-muted-foreground">{row.description}</div>
            </div>
            <div className="shrink-0">
              <SettingControlView control={row.control} />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export function SettingsPage({ activeSection }: SettingsPageProps) {
  const section = SETTINGS_CONTENT[activeSection]
  const sectionMeta = SETTINGS_SECTIONS.find((item) => item.id === activeSection)

  return (
    <section className="h-full overflow-y-auto bg-main-content px-6 py-7 text-main-content-foreground sm:px-8">
      <div className="mx-auto flex max-w-[980px] flex-col gap-7 pb-12 pt-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeSection}
            initial={{ opacity: 0, y: 10, filter: "blur(10px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -8, filter: "blur(10px)" }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-8"
          >
            <header className="pt-6">
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/75">
                {sectionMeta?.label ?? "Settings"}
              </div>
              <h1 className="mt-3 text-3xl font-medium tracking-tight text-main-content-foreground">
                {section.title}
              </h1>
              <p className="mt-3 max-w-[680px] text-sm leading-7 text-muted-foreground">
                {section.description}
              </p>
            </header>

            {section.groups.map((group, index) => (
              <SettingsGroup key={`${section.title}-${index}`} title={group.title} rows={group.rows} />
            ))}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  )
}
