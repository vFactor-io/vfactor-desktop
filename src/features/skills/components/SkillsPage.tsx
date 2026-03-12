import { useMemo, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { BookOpen, MagnifyingGlass, Plus, Refresh } from "@/components/icons"
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
import { cn } from "@/lib/utils"

type SkillCategory = "installed" | "recommended"

interface SkillDefinition {
  id: string
  name: string
  description: string
  category: SkillCategory
  enabled: boolean
  tags?: string[]
  details: {
    intro: string[]
    sections: Array<{
      title: string
      items: string[]
      ordered?: boolean
    }>
  }
}

const SKILLS: SkillDefinition[] = [
  {
    id: "acp",
    name: "Agent Client Protocol (acp)",
    description: "Implement ACP agents, sessions, and JSON-RPC message flows.",
    category: "installed",
    enabled: true,
    details: {
      intro: [
        "Implements ACP agents, sessions, and JSON-RPC message flows for runtime integrations.",
        "Use this when the request involves agent-editor communication, session state, or tool call handling over ACP.",
      ],
      sections: [
        {
          title: "When to use",
          items: [
            "Build or extend an ACP client or adapter.",
            "Handle thread, session, or tool call messages.",
            "Map a harness protocol into shared UI thread types.",
          ],
        },
        {
          title: "Workflow",
          ordered: true,
          items: [
            "Decide which provider/runtime messages need ACP mapping.",
            "Model the request/response and event flow first.",
            "Keep provider specifics behind a thin adapter layer.",
          ],
        },
      ],
    },
  },
  {
    id: "linear",
    name: "Linear",
    description: "Manage issues, projects, and team workflows without leaving the agent.",
    category: "installed",
    enabled: true,
    details: {
      intro: [
        "Manages Linear issues, projects, and team workflows without leaving the current agent.",
        "Best for triage, planning, ticket updates, and status review tasks tied to delivery work.",
      ],
      sections: [
        {
          title: "When to use",
          items: [
            "Read or update a Linear issue.",
            "Create project docs or status updates.",
            "Review milestones, labels, cycles, or assignees.",
          ],
        },
        {
          title: "Common actions",
          items: [
            "List issues assigned to a teammate.",
            "Update issue state, priority, or description.",
            "Create a project document or attach artifacts.",
          ],
        },
      ],
    },
  },
  {
    id: "learn",
    name: "Learn",
    description: "Capture session learnings into AGENTS.md so the workspace gets smarter over time.",
    category: "installed",
    enabled: true,
    details: {
      intro: [
        "Captures reusable learnings from a session into the nearest relevant AGENTS.md file.",
        "Use it when we discover hidden project constraints, non-obvious workflows, or preferences worth keeping.",
      ],
      sections: [
        {
          title: "When to use",
          items: [
            "A user asks to remember a preference.",
            "A debugging breakthrough revealed a hidden constraint.",
            "A file or workflow relationship should be documented for future work.",
          ],
        },
        {
          title: "Workflow",
          ordered: true,
          items: [
            "Identify the actual reusable learning.",
            "Choose the closest relevant AGENTS.md scope.",
            "Add a concise note without duplicating existing guidance.",
          ],
        },
      ],
    },
  },
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
        "This skill works best when the user is still shaping the task and needs help translating a rough outcome into one or two concrete, reusable skills.",
        "It keeps the interaction lightweight by narrowing the search to the smallest set of skills that can meaningfully move the task forward.",
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
        {
          title: "What it is good at",
          items: [
            "Turning vague requests like 'how do I do X here?' into a small list of viable skills.",
            "Helping users discover whether an installable skill already covers a recurring workflow.",
            "Reducing unnecessary implementation work when a reusable skill already exists.",
            "Pointing the conversation toward the most relevant next tool or workflow instead of opening every possible path.",
          ],
        },
        {
          title: "Decision guide",
          items: [
            "If the user names a specific skill directly, use that skill instead of discovery.",
            "If the user asks broadly about options, start with discovery before implementation.",
            "If multiple skills could apply, recommend the smallest set that covers the request cleanly.",
            "If no matching skill exists, say so briefly and continue with the best fallback approach.",
          ],
        },
        {
          title: "Recommended flow",
          ordered: true,
          items: [
            "Identify whether the request is exploratory or already implementation-ready.",
            "Translate the request into a capability-focused search phrase.",
            "Surface the most relevant skill or skill pair without overwhelming the user.",
            "Explain why those skills fit and what tradeoff they avoid.",
            "Move into the chosen skill flow once the path is clear.",
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
          title: "When to use",
          items: [
            "A workflow keeps repeating and needs to become reusable.",
            "An existing skill needs clearer instructions or better scope.",
            "A new tool integration should be wrapped in a documented skill.",
          ],
        },
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

function SkillGlyph() {
  return (
    <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-muted">
      <BookOpen size={18} className="text-skill-accent" strokeWidth={2} />
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
          <p className="mt-1 truncate text-[13px] leading-5 text-muted-foreground">
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
}: SkillDefinition["details"]["sections"][number]) {
  const ListTag = ordered ? "ol" : "ul"

  return (
    <section className="space-y-3">
      <h3 className="text-base font-medium tracking-tight text-card-foreground">{title}</h3>
      <ListTag
        className={cn(
          "space-y-2 text-sm leading-7 text-muted-foreground",
          ordered ? "list-decimal pl-6" : "list-disc pl-5",
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[min(92vw,860px)] max-w-[860px] gap-0 overflow-hidden p-0 text-card-foreground sm:max-w-[860px]"
      >
        <div className="flex flex-col gap-5 px-6 pb-6 pt-5">
          <DialogHeader className="pr-10">
            <div className="mb-1">
              <SkillGlyph />
            </div>
            <DialogTitle className="text-[2rem] leading-none tracking-tight text-card-foreground">
              {skill.name}
            </DialogTitle>
            <DialogDescription className="text-lg text-muted-foreground">
              {skill.description}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-xl border border-border bg-background">
            <div className="max-h-[52vh] overflow-y-auto px-5 py-5 [scrollbar-color:var(--color-muted-foreground)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-track]:bg-transparent">
              <div className="space-y-6">
                {skill.details.intro.map((paragraph) => (
                  <p key={paragraph} className="text-sm leading-7 text-muted-foreground">
                    {paragraph}
                  </p>
                ))}

                {skill.details.sections.map((section) => (
                  <SkillDetailsSection key={section.title} {...section} />
                ))}
              </div>
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

export function SkillsPage() {
  const [query, setQuery] = useState("")
  const [selectedSkill, setSelectedSkill] = useState<SkillDefinition | null>(null)
  const normalizedQuery = query.trim().toLowerCase()

  const filteredSkills = useMemo(() => {
    if (!normalizedQuery) {
      return SKILLS
    }

    return SKILLS.filter((skill) => {
      const haystack = [skill.name, skill.description, ...(skill.tags ?? [])].join(" ").toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }, [normalizedQuery])

  const installedSkills = filteredSkills.filter((skill) => skill.category === "installed")
  const recommendedSkills = filteredSkills.filter((skill) => skill.category === "recommended")

  return (
    <section className="h-full overflow-y-auto bg-main-content text-main-content-foreground">
      <div className="mx-auto flex max-w-[1120px] flex-col gap-8 px-6 py-7 sm:px-8">
        <div className="flex flex-col gap-6 pt-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-[520px]">
              <h1 className="text-4xl font-medium tracking-tight text-main-content-foreground">
                Skills
              </h1>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">
                Give agents superpowers.{" "}
                <button
                  type="button"
                  className="font-medium text-primary transition hover:text-primary/80"
                >
                  Learn more
                </button>
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button type="button" variant="outline">
                <Refresh size={14} />
                <span>Refresh</span>
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

              <Button type="button">
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

            {!installedSkills.length && !recommendedSkills.length ? (
              <div className="rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
                No skills matched "{query}".
              </div>
            ) : null}
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
