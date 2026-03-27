import { useState } from "react"
import { Clock, Plus, Zap } from "@/components/icons"
import { Badge } from "@/features/shared/components/ui/badge"
import { Button } from "@/features/shared/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/features/shared/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldTitle,
} from "@/features/shared/components/ui/field"
import { Input } from "@/features/shared/components/ui/input"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/features/shared/components/ui/pagination"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/features/shared/components/ui/select"
import { Textarea } from "@/features/shared/components/ui/textarea"

type AutomationFormMode = "create" | "edit"

type AutomationDefinition = {
  name: string
  prompt: string
  frequency: (typeof SCHEDULE_OPTIONS)[number]
  weekday: (typeof WEEKDAY_OPTIONS)[number]
  time: string
  schedule: string
  startsIn: string
  state: "running" | "idle"
}

const SCHEDULE_OPTIONS = ["Hourly", "Daily", "Weekdays", "Weekly", "Custom"] as const
const WEEKDAY_OPTIONS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const

const AUTOMATIONS = [
  {
    name: "Weekly release notes",
    prompt: "summarize the most important release notes from this week and prepare a concise update",
    frequency: "Weekly",
    weekday: "Friday",
    time: "09:00",
    schedule: "Fri · 09:00",
    startsIn: "Starts in 14h",
    state: "running",
  },
  {
    name: "Pipeline digest",
    prompt: "review the latest pipeline activity and draft a short digest of failures and regressions",
    frequency: "Weekly",
    weekday: "Thursday",
    time: "13:30",
    schedule: "Thu · 13:30",
    startsIn: "Starts in 3h",
    state: "idle",
  },
  {
    name: "Bug triage roundup",
    prompt: "collect the highest priority bugs and prepare a triage summary for the team",
    frequency: "Weekly",
    weekday: "Monday",
    time: "10:00",
    schedule: "Mon · 10:00",
    startsIn: "Starts tomorrow",
    state: "idle",
  },
  {
    name: "Invoice follow-ups",
    prompt: "identify overdue invoices and draft follow-up messages for the relevant contacts",
    frequency: "Daily",
    weekday: "Monday",
    time: "16:00",
    schedule: "Today · 16:00",
    startsIn: "Starts in 2h",
    state: "idle",
  },
] satisfies AutomationDefinition[]

const HISTORY_RUNS = [
  {
    automation: "Weekly release notes",
    ranAt: "Today · 08:46",
  },
  {
    automation: "Pipeline digest",
    ranAt: "Today · 10:12",
  },
  {
    automation: "Bug triage roundup",
    ranAt: "Yesterday · 17:08",
  },
  {
    automation: "Invoice follow-ups",
    ranAt: "Yesterday · 16:01",
  },
  {
    automation: "Weekly release notes",
    ranAt: "Last Fri · 09:03",
  },
] as const

export function AutomationsPage() {
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [formMode, setFormMode] = useState<AutomationFormMode>("create")
  const [name, setName] = useState("")
  const [prompt, setPrompt] = useState("")
  const [frequency, setFrequency] =
    useState<(typeof SCHEDULE_OPTIONS)[number]>("Weekly")
  const [weekday, setWeekday] =
    useState<(typeof WEEKDAY_OPTIONS)[number]>("Monday")
  const [time, setTime] = useState("09:00")

  const isCreateValid =
    name.trim().length > 0 &&
    prompt.trim().length > 0 &&
    frequency.trim().length > 0 &&
    weekday.trim().length > 0 &&
    time.trim().length > 0

  function resetForm() {
    setFormMode("create")
    setName("")
    setPrompt("")
    setFrequency("Weekly")
    setWeekday("Monday")
    setTime("09:00")
  }

  function openCreateModal() {
    resetForm()
    setIsCreateOpen(true)
  }

  function openEditModal(automation: AutomationDefinition) {
    setFormMode("edit")
    setName(automation.name)
    setPrompt(automation.prompt)
    setFrequency(automation.frequency)
    setWeekday(automation.weekday)
    setTime(automation.time)
    setIsCreateOpen(true)
  }

  function handleCreateOpenChange(open: boolean) {
    setIsCreateOpen(open)

    if (!open) {
      resetForm()
    }
  }

  return (
    <Dialog open={isCreateOpen} onOpenChange={handleCreateOpenChange}>
      <section className="h-full overflow-y-auto bg-main-content text-main-content-foreground">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-8 px-6 py-7 sm:px-8">
          <div className="flex items-start justify-between gap-6 pt-4">
            <div className="max-w-[520px]">
              <h1 className="text-4xl font-medium tracking-tight text-main-content-foreground">
                Automations
              </h1>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">
                Schedule recurring work for your agents.
              </p>
            </div>

            <Button className="shrink-0" onClick={openCreateModal}>
              <Plus />
              New automation
            </Button>
          </div>

          <section className="space-y-4 pb-10">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/80">
              Scheduled
            </div>

            <div className="space-y-1">
              {AUTOMATIONS.map((automation) => {
                const isRunning = automation.state === "running"

                return (
                  <button
                    type="button"
                    key={`${automation.name}-${automation.schedule}`}
                    onClick={() => openEditModal(automation)}
                    className="grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    {isRunning ? (
                      <span className="flex size-6 items-center justify-center">
                        <span className="size-4 rounded-full border-2 border-foreground/18 border-t-foreground/62 animate-spin" />
                      </span>
                    ) : (
                      <span className="flex size-6 items-center justify-center" aria-hidden="true">
                        <span className="size-4 rounded-full border-2 border-muted-foreground/35" />
                      </span>
                    )}

                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2 text-sm leading-none">
                        <span className="truncate font-medium text-foreground">
                          {automation.name}
                        </span>
                        <Badge
                          variant="outline"
                          className="h-6 shrink-0 gap-1 rounded-full border-transparent bg-[color:var(--color-chart-4)]/14 px-2 text-[11px] font-medium text-[color:var(--color-chart-4)]"
                        >
                          <Clock size={11} />
                          {automation.schedule}
                        </Badge>
                      </div>
                    </div>

                    <div className="shrink-0 text-sm font-medium text-muted-foreground">
                      {automation.startsIn}
                    </div>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="space-y-4 pb-10">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/80">
              History
            </div>

            <div className="overflow-hidden rounded-xl border border-border/60 bg-card/30">
              {HISTORY_RUNS.map((run) => (
                <div
                  key={`${run.automation}-${run.ranAt}`}
                  className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-border/60 px-3 py-3 text-sm transition-colors last:border-b-0 hover:bg-accent hover:text-accent-foreground"
                >
                  <span className="flex size-6 items-center justify-center" aria-hidden="true">
                    <Zap
                      className="text-[color:var(--color-skill-accent)]"
                      size={15}
                      strokeWidth={1.9}
                    />
                  </span>

                  <div className="min-w-0">
                    <div className="min-w-0 text-sm leading-none">
                      <span className="truncate font-medium text-foreground">{run.automation}</span>
                    </div>
                  </div>

                  <span className="text-sm font-medium text-muted-foreground">{run.ranAt}</span>
                </div>
              ))}
            </div>

            <Pagination className="justify-end">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious />
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink isActive>1</PaginationLink>
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink>2</PaginationLink>
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </section>
        </div>
      </section>

      <DialogContent className="max-w-[660px] gap-0 p-0 sm:max-w-[660px]" showCloseButton={false}>
        <div className="px-6 py-5 sm:px-8 sm:py-7">
          <DialogHeader>
            <DialogTitle className="text-3xl font-medium tracking-tight text-card-foreground">
              {formMode === "edit" ? "Edit automation" : "Create automation"}
            </DialogTitle>
          </DialogHeader>

          <FieldGroup className="mt-6 gap-6">
            <Field>
              <FieldTitle>Name</FieldTitle>
              <Input
                onChange={(event) => setName(event.target.value)}
                placeholder="Check for sentry issues"
                value={name}
              />
            </Field>

            <Field>
              <FieldTitle>Prompt</FieldTitle>
              <Textarea
                className="min-h-24"
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="look for crashes in $Sentry"
                value={prompt}
              />
            </Field>

            <Field>
              <FieldTitle>Schedule</FieldTitle>
              <FieldDescription>
                Choose how often this automation should run.
              </FieldDescription>

              <div className="grid gap-3 sm:grid-cols-3">
                <Select onValueChange={setFrequency} value={frequency}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    {SCHEDULE_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select onValueChange={setWeekday} value={weekday}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    {WEEKDAY_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Input onChange={(event) => setTime(event.target.value)} type="time" value={time} />
              </div>
            </Field>
          </FieldGroup>

          <div className="mt-8 flex items-center justify-end gap-3">
            <Button variant="ghost" onClick={() => handleCreateOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={!isCreateValid} onClick={() => handleCreateOpenChange(false)}>
              {formMode === "edit" ? "Save" : "Create"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
