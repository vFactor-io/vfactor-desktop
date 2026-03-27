import { useEffect, useMemo, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { BookOpen, InformationCircle, MagnifyingGlass, Plus, Refresh } from "@/components/icons"
import { MessageResponse } from "@/features/chat/components/ai-elements/message"
import { Badge } from "@/features/shared/components/ui/badge"
import { Button } from "@/features/shared/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/features/shared/components/ui/dialog"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/features/shared/components/ui/input-group"
import { Switch } from "@/features/shared/components/ui/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/features/shared/components/ui/tooltip"
import { useSkillsStore } from "@/features/skills/store/skillsStore"
import type { ManagedSkill } from "@/features/skills/types"
import { cn } from "@/lib/utils"

type SkillCategory = "installed" | "recommended"

interface SkillDetails {
  intro: string[]
  sections: Array<{
    title: string
    items: string[]
    ordered?: boolean
  }>
}

interface SkillDefinition {
  id: string
  name: string
  description: string
  category: SkillCategory
  enabled: boolean
  tags?: string[]
  details?: SkillDetails
  body?: string
}

const RECOMMENDED_SKILLS: SkillDefinition[] = [
  {
    id: "find-skills",
    name: "Find Skills",
    description: "Help users discover and install the right skill for the job.",
    category: "recommended",
    enabled: false,
    details: {
      intro: [
        "Helps discover and install the right skill when the user is exploring capabilities rather than naming an exact implementation.",
        "Useful for routing vague requests into a concrete next step quickly, especially when the request sounds like a capability search rather than a direct build instruction.",
      ],
      sections: [
        {
          title: "When to use",
          items: [
            "The user asks whether a skill exists for a task.",
            "The request is capability-focused rather than implementation-focused.",
            "You want to suggest the minimal skill set needed for a job.",
          ],
        },
      ],
    },
  },
  {
    id: "imagegen",
    name: "Image Gen",
    description: "Generate or edit images with the OpenAI Image API from inside the app.",
    category: "recommended",
    enabled: false,
    details: {
      intro: [
        "Generates and edits images with the OpenAI Image API through the local image generation workflow.",
        "Useful for mockups, concept art, product imagery, and visual asset exploration.",
      ],
      sections: [
        {
          title: "When to use",
          items: [
            "Create a new visual from a prompt.",
            "Edit or inpaint an existing image.",
            "Generate multiple variants for comparison.",
          ],
        },
      ],
    },
  },
  {
    id: "skill-creator",
    name: "Skill Creator",
    description: "Create or refine custom skills with reusable instructions and assets.",
    category: "recommended",
    enabled: false,
    tags: ["builder"],
    details: {
      intro: [
        "Guides the creation and refinement of reusable skills with clear instructions, assets, and workflow boundaries.",
        "Best when we want to turn repeated work into a durable capability.",
      ],
      sections: [
        {
          title: "Recommended flow",
          ordered: true,
          items: [
            "Define the exact trigger and expected output.",
            "Keep the instructions concrete and progressive.",
            "Reuse scripts or templates instead of rewriting them inline.",
          ],
        },
      ],
    },
  },
]

function toInstalledSkillDefinition(skill: ManagedSkill): SkillDefinition {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    category: "installed",
    enabled: true,
    tags: skill.hasFrontmatter ? ["frontmatter"] : undefined,
    body: skill.body,
  }
}

function SkillGlyph({ className }: { className?: string } = {}) {
  return (
    <div
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-muted",
        className
      )}
    >
      <BookOpen size={18} className="text-skill-icon" strokeWidth={2} />
    </div>
  )
}

function SkillCard({
  skill,
  onSelect,
}: {
  skill: SkillDefinition
  onSelect: (skill: SkillDefinition) => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(skill)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onSelect(skill)
        }
      }}
      className="group w-full cursor-pointer rounded-xl border border-border bg-card p-4 text-left text-card-foreground shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-accent/35"
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
        <SkillGlyph />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[15px] font-medium tracking-tight text-card-foreground">
              {skill.name}
            </h3>
            {skill.tags?.length ? (
              <div className="flex shrink-0 flex-wrap gap-1.5">
                {skill.tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="outline"
                    className="border-border bg-muted text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
          <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-muted-foreground">
            {skill.description}
          </p>
        </div>
        <Switch
          checked={skill.enabled}
          disabled
          size="sm"
          aria-hidden="true"
          className="pointer-events-none opacity-100"
        />
      </div>
    </div>
  )
}

function SkillDetailsSection({
  title,
  items,
  ordered = false,
}: SkillDetails["sections"][number]) {
  const ListTag = ordered ? "ol" : "ul"

  return (
    <section className="space-y-3">
      <h3 className="text-base font-medium tracking-tight text-card-foreground">{title}</h3>
      <ListTag
        className={cn(
          "space-y-2 text-sm leading-7 text-muted-foreground",
          ordered ? "list-decimal pl-6" : "list-disc pl-5"
        )}
      >
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ListTag>
    </section>
  )
}

function SkillDetailsDialog({
  skill,
  open,
  onOpenChange,
}: {
  skill: SkillDefinition | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  if (!skill) {
    return null
  }

  const hasStructuredDetails = (skill.details?.intro.length ?? 0) > 0 || (skill.details?.sections.length ?? 0) > 0
  const hasMarkdownBody = Boolean(skill.body?.trim())

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,860px)] max-w-[860px] gap-0 overflow-hidden p-0 text-card-foreground sm:max-w-[860px]">
        <div className="flex flex-col gap-5 px-6 pb-6 pt-5">
          <DialogHeader className="pr-10">
            <div className="flex items-start gap-3">
              <SkillGlyph className="mt-0.5" />
              <div className="min-w-0 space-y-1">
                <DialogTitle className="text-[2rem] leading-none tracking-tight text-card-foreground">
                  {skill.name}
                </DialogTitle>
                <DialogDescription className="max-w-[56ch] line-clamp-2 text-base leading-6 text-muted-foreground">
                  {skill.description}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="rounded-xl border border-border bg-background">
            <div className="app-scrollbar-sm max-h-[52vh] overflow-y-auto px-5 py-5">
              {hasMarkdownBody ? (
                <MessageResponse className="space-y-4 text-sm leading-7 text-muted-foreground">
                  {skill.body}
                </MessageResponse>
              ) : hasStructuredDetails ? (
                <div className="space-y-6">
                  {skill.details?.intro.map((paragraph) => (
                    <p key={paragraph} className="text-sm leading-7 text-muted-foreground">
                      {paragraph}
                    </p>
                  ))}

                  {skill.details?.sections.map((section) => (
                    <SkillDetailsSection key={section.title} {...section} />
                  ))}
                </div>
              ) : (
                <p className="text-sm leading-7 text-muted-foreground">
                  No additional skill instructions were available to preview.
                </p>
              )}
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="button" disabled={skill.enabled}>
              {skill.enabled ? "Installed" : "Install"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SkillsSection({
  title,
  skills,
  onSelectSkill,
}: {
  title: string
  skills: SkillDefinition[]
  onSelectSkill: (skill: SkillDefinition) => void
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/80">
          {title}
        </div>
        <div className="text-xs text-muted-foreground">{skills.length} shown</div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {skills.map((skill) => (
          <SkillCard key={skill.id} skill={skill} onSelect={onSelectSkill} />
        ))}
      </div>
    </section>
  )
}

function SidebarSkillRow({
  skill,
  onSelect,
}: {
  skill: SkillDefinition
  onSelect: (skill: SkillDefinition) => void
}) {
  const actionLabel = skill.enabled ? "Installed" : "Install"

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(skill)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onSelect(skill)
        }
      }}
      className="grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent/55"
    >
      <span className="flex size-6 shrink-0 items-center justify-center">
        <BookOpen size={14} className="text-skill-icon" strokeWidth={2} />
      </span>

      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5 text-sm leading-none">
          <span className="truncate font-medium text-foreground">{skill.name}</span>
          {skill.tags?.[0] ? (
            <Badge
              variant="outline"
              className="h-5 shrink-0 rounded-full border-transparent bg-sidebar-accent px-1.5 text-[9px] font-medium uppercase tracking-[0.14em] text-sidebar-foreground/72"
            >
              {skill.tags[0]}
            </Badge>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground">
                <InformationCircle className="size-3" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="end" className="max-w-64 text-sm leading-5">
              {skill.description}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <Button
        type="button"
        size="xs"
        variant={skill.enabled ? "ghost" : "default"}
        className={cn(
          "cursor-pointer",
          skill.enabled ? "text-muted-foreground hover:text-foreground" : undefined
        )}
        onClick={(event) => {
          event.stopPropagation()
        }}
      >
        {actionLabel}
      </Button>
    </div>
  )
}

function useSkillDefinitions(query: string) {
  const managedRootPath = useSkillsStore((state) => state.managedRootPath)
  const installed = useSkillsStore((state) => state.installedSkills)
  const isLoading = useSkillsStore((state) => state.isLoading)
  const hasLoaded = useSkillsStore((state) => state.hasLoaded)
  const error = useSkillsStore((state) => state.error)
  const loadSkills = useSkillsStore((state) => state.loadSkills)

  useEffect(() => {
    if (!hasLoaded && !isLoading) {
      void loadSkills()
    }
  }, [hasLoaded, isLoading, loadSkills])

  const normalizedQuery = query.trim().toLowerCase()

  const filteredSkills = useMemo(() => {
    const combined: SkillDefinition[] = [
      ...installed.map(toInstalledSkillDefinition),
      ...RECOMMENDED_SKILLS,
    ]

    if (!normalizedQuery) {
      return combined
    }

    return combined.filter((skill) => {
      const haystack = [skill.name, skill.description, ...(skill.tags ?? [])].join(" ").toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }, [installed, normalizedQuery])

  return {
    managedRootPath,
    filteredSkills,
    isLoading,
    error,
    refetch: loadSkills,
  }
}

export function SkillsSidebarPanel() {
  const [query, setQuery] = useState("")
  const [selectedSkill, setSelectedSkill] = useState<SkillDefinition | null>(null)
  const { filteredSkills, isLoading, error } = useSkillDefinitions(query)

  const installedSkills = filteredSkills.filter((skill) => skill.category === "installed")
  const recommendedSkills = filteredSkills.filter((skill) => skill.category === "recommended")

  return (
    <section className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="border-b border-sidebar-border px-3 py-3">
        <InputGroup>
          <InputGroupAddon>
            <MagnifyingGlass size={15} className="text-muted-foreground" />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search skills"
          />
        </InputGroup>
      </div>

      <div className="app-scrollbar flex-1 overflow-y-auto px-3 py-3">
        {error ? (
          <div className="rounded-2xl border border-dashed border-sidebar-border bg-sidebar-accent/35 px-4 py-8 text-center text-sm text-muted-foreground">
            {error}
          </div>
        ) : isLoading && filteredSkills.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-sidebar-border bg-sidebar-accent/35 px-4 py-8 text-center text-sm text-muted-foreground">
            Loading skills...
          </div>
        ) : installedSkills.length || recommendedSkills.length ? (
          <div className="space-y-6">
            {installedSkills.length ? (
              <section className="space-y-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/80">
                  Installed
                </div>

                <div className="space-y-1">
                  {installedSkills.map((skill) => (
                    <SidebarSkillRow key={skill.id} skill={skill} onSelect={setSelectedSkill} />
                  ))}
                </div>
              </section>
            ) : null}

            {recommendedSkills.length ? (
              <section className="space-y-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/80">
                  Recommended
                </div>

                <div className="space-y-1">
                  {recommendedSkills.map((skill) => (
                    <SidebarSkillRow key={skill.id} skill={skill} onSelect={setSelectedSkill} />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-sidebar-border bg-sidebar-accent/35 px-4 py-8 text-center text-sm text-muted-foreground">
            No skills matched "{query}".
          </div>
        )}
      </div>

      <SkillDetailsDialog
        skill={selectedSkill}
        open={selectedSkill != null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedSkill(null)
          }
        }}
      />
    </section>
  )
}

export function SkillsPage() {
  const [query, setQuery] = useState("")
  const [selectedSkill, setSelectedSkill] = useState<SkillDefinition | null>(null)
  const normalizedQuery = query.trim().toLowerCase()
  const { managedRootPath, filteredSkills, isLoading, error, refetch } = useSkillDefinitions(query)

  const installedSkills = filteredSkills.filter((skill) => skill.category === "installed")
  const recommendedSkills = filteredSkills.filter((skill) => skill.category === "recommended")

  return (
    <section className="h-full overflow-y-auto bg-main-content text-main-content-foreground">
      <div className="mx-auto flex max-w-[1120px] flex-col gap-8 px-6 py-7 sm:px-8">
        <div className="flex flex-col gap-6 pt-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-[620px]">
              <h1 className="text-4xl font-medium tracking-tight text-main-content-foreground">
                Skills
              </h1>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">
                Installed skills sync from the managed skills folder and pull their title and subtitle from standardized `SKILL.md` frontmatter.
              </p>
              {managedRootPath ? (
                <p className="mt-2 font-mono text-xs leading-6 text-muted-foreground">
                  Managed root: {managedRootPath}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button type="button" variant="outline" onClick={() => void refetch()} disabled={isLoading}>
                <Refresh size={14} />
                <span>{isLoading ? "Refreshing..." : "Refresh"}</span>
              </Button>

              <InputGroup className="min-w-[260px] flex-1 sm:w-[280px]">
                <InputGroupAddon>
                  <MagnifyingGlass size={15} className="text-muted-foreground" />
                </InputGroupAddon>
                <InputGroupInput
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search skills"
                />
              </InputGroup>

              <Button type="button" disabled>
                <Plus size={14} />
                <span>New skill</span>
              </Button>
            </div>
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={normalizedQuery || "all-skills"}
            initial={{ opacity: 0, y: 12, filter: "blur(12px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -8, filter: "blur(12px)" }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-8 pb-10"
          >
            {error ? (
              <div className="rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
                {error}
              </div>
            ) : (
              <>
                <SkillsSection
                  title="Installed"
                  skills={installedSkills}
                  onSelectSkill={setSelectedSkill}
                />
                <SkillsSection
                  title="Recommended"
                  skills={recommendedSkills}
                  onSelectSkill={setSelectedSkill}
                />

                {!isLoading && !installedSkills.length && !recommendedSkills.length ? (
                  <div className="rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
                    No skills matched "{query}".
                  </div>
                ) : null}
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <SkillDetailsDialog
        skill={selectedSkill}
        open={selectedSkill != null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedSkill(null)
          }
        }}
      />
    </section>
  )
}
