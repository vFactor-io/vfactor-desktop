import { ArrowMoveDownLeft, CaretLeft, CaretRight, InformationCircle } from "@/components/icons"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/features/shared/components/ui/tooltip"
import type { FormEvent } from "react"
import type { ComposerPrompt } from "./types"

interface StructuredPromptSurfaceProps {
  prompt: ComposerPrompt
  answers: Record<string, string | string[]>
  customAnswers: Record<string, string>
  onAnswerChange: (questionId: string, value: string | string[]) => void
  onCustomAnswerChange: (questionId: string, value: string) => void
  onCustomAnswerFocus: (questionId: string) => void
  currentQuestionIndex: number
  progressLabel: string
  onPreviousQuestion: () => void
  onNextQuestion: () => void
  canGoPrevious: boolean
  canGoNext: boolean
  canSubmitCurrentQuestion: boolean
  submitLabel: string
  onDismissPrompt: () => void
}

export function StructuredPromptSurface({
  prompt,
  answers,
  customAnswers,
  onAnswerChange,
  onCustomAnswerChange,
  onCustomAnswerFocus,
  currentQuestionIndex,
  progressLabel,
  onPreviousQuestion,
  onNextQuestion,
  canGoPrevious,
  canGoNext,
  canSubmitCurrentQuestion,
  submitLabel,
  onDismissPrompt,
}: StructuredPromptSurfaceProps) {
  const question = prompt.questions[currentQuestionIndex]

  if (!question) {
    return null
  }

  const optionCount = question.options?.length ?? 0
  const questionLabel = `${currentQuestionIndex + 1}. ${question.label}`
  const customAnswerValue = customAnswers[question.id] ?? ""
  const showInlineActions = question.kind === "text" || question.allowOther
  const autoResizeTextarea = (event: FormEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget
    textarea.style.height = "0px"
    textarea.style.height = `${textarea.scrollHeight}px`
  }
  const promptActions = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onDismissPrompt}
        className="inline-flex h-8 items-center gap-2 rounded-full px-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <span>Dismiss</span>
        <span className="rounded-md border border-border/70 px-1.5 py-0.5 text-sm leading-none text-muted-foreground">
          Esc
        </span>
      </button>
      <button
        type="submit"
        disabled={!canSubmitCurrentQuestion}
        className="inline-flex h-8 items-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-40"
      >
        <span>{submitLabel}</span>
        <span className="flex size-5 items-center justify-center rounded-md border border-primary-foreground/20 text-primary-foreground/85">
          <ArrowMoveDownLeft className="size-3" />
        </span>
      </button>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-medium text-foreground">{questionLabel}</p>
        <div className="flex items-center gap-0 text-muted-foreground">
          <button
            type="button"
            onClick={onPreviousQuestion}
            disabled={!canGoPrevious}
            className="flex size-6 items-center justify-center rounded-full transition-colors hover:text-foreground disabled:opacity-35"
            aria-label="Previous question"
          >
            <CaretLeft className="size-3.5" />
          </button>
          <span className="min-w-[2.2rem] text-center text-sm">{progressLabel}</span>
          <button
            type="button"
            onClick={onNextQuestion}
            disabled={!canGoNext}
            className="flex size-6 items-center justify-center rounded-full transition-colors hover:text-foreground disabled:opacity-35"
            aria-label="Next question"
          >
            <CaretRight className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {question.kind === "single_select" && (
          <div className="flex flex-col gap-2">
            {(question.options ?? []).map((option, index) => {
              const selectedValue = typeof answers[question.id] === "string" ? answers[question.id] : ""
              const isSelected = selectedValue === option.label

              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onAnswerChange(question.id, option.label)}
                  className={`flex min-h-[46px] items-center rounded-2xl px-3 py-2.5 text-left transition-colors ${
                    isSelected
                      ? "bg-input text-foreground shadow-sm dark:bg-input"
                      : "bg-card text-muted-foreground hover:bg-input/80 hover:text-foreground dark:bg-card dark:hover:bg-input/80"
                  }`}
                >
                  <span className="mr-2 shrink-0 text-sm font-medium text-muted-foreground/80">
                    {index + 1}.
                  </span>
                  <span className="min-w-0 text-sm">{option.label}</span>
                  {option.description ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="ml-2 inline-flex shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground">
                          <InformationCircle className="size-3.5" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-64 text-sm leading-5">
                        {option.description}
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                </button>
              )
            })}
            {question.allowOther ? (
              <div className="flex items-start gap-3">
                <div className="flex min-h-[46px] flex-1 items-start rounded-2xl bg-card px-3 py-2.5 text-left text-muted-foreground">
                  <span className="mr-2 shrink-0 text-sm leading-5 font-medium text-muted-foreground/80">
                    {optionCount + 1}.
                  </span>
                  <textarea
                    value={customAnswerValue}
                    onFocus={() => onCustomAnswerFocus(question.id)}
                    onChange={(event) => onCustomAnswerChange(question.id, event.target.value)}
                    onInput={autoResizeTextarea}
                    placeholder="Type your own answer"
                    rows={1}
                    className="min-w-[12rem] flex-1 overflow-hidden resize-none bg-transparent p-0 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground"
                  />
                </div>
                <div className="shrink-0 self-end">{promptActions}</div>
              </div>
            ) : null}
          </div>
        )}

        {question.kind === "multi_select" && (
          <div className="flex flex-col gap-2">
            {(question.options ?? []).map((option, index) => {
              const selectedValues = Array.isArray(answers[question.id]) ? answers[question.id] : []
              const isSelected = selectedValues.includes(option.label)

              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() =>
                    onAnswerChange(
                      question.id,
                      isSelected
                        ? selectedValues.filter((value) => value !== option.label)
                        : selectedValues.concat(option.label)
                    )
                  }
                  className={`flex min-h-[46px] items-center rounded-2xl px-3 py-2.5 text-left transition-colors ${
                    isSelected
                      ? "bg-input text-foreground shadow-sm dark:bg-input"
                      : "bg-card text-muted-foreground hover:bg-input/80 hover:text-foreground dark:bg-card dark:hover:bg-input/80"
                  }`}
                >
                  <span className="mr-2 shrink-0 text-sm font-medium text-muted-foreground/80">
                    {index + 1}.
                  </span>
                  <span className="min-w-0 text-sm">{option.label}</span>
                  {option.description ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="ml-2 inline-flex shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground">
                          <InformationCircle className="size-3.5" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-64 text-sm leading-5">
                        {option.description}
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                </button>
              )
            })}
            {question.allowOther ? (
              <div className="flex items-start gap-3">
                <div className="flex min-h-[46px] flex-1 items-start rounded-2xl bg-card px-3 py-2.5 text-left text-muted-foreground">
                  <span className="mr-2 shrink-0 text-sm leading-5 font-medium text-muted-foreground/80">
                    {optionCount + 1}.
                  </span>
                  <textarea
                    value={customAnswerValue}
                    onFocus={() => onCustomAnswerFocus(question.id)}
                    onChange={(event) => onCustomAnswerChange(question.id, event.target.value)}
                    onInput={autoResizeTextarea}
                    placeholder="Type your own answer"
                    rows={1}
                    className="min-w-[12rem] flex-1 overflow-hidden resize-none bg-transparent p-0 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground"
                  />
                </div>
                <div className="shrink-0 self-end">{promptActions}</div>
              </div>
            ) : null}
          </div>
        )}

        {question.kind === "text" && (
          <div className="flex items-start gap-3">
            <div className="flex min-h-[46px] flex-1 items-start rounded-2xl bg-card px-3 py-2.5 text-sm text-foreground">
              <span className="mr-2 shrink-0 font-medium leading-5 text-muted-foreground/80">
                {currentQuestionIndex + 1}.
              </span>
              <textarea
                value={customAnswers[question.id] ?? ""}
                onFocus={() => onCustomAnswerFocus(question.id)}
                onChange={(event) => onCustomAnswerChange(question.id, event.target.value)}
                onInput={autoResizeTextarea}
                placeholder={question.description ?? "Type your response"}
                rows={1}
                className="min-w-[12rem] flex-1 overflow-hidden resize-none bg-transparent p-0 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="shrink-0 self-end">{promptActions}</div>
          </div>
        )}
      </div>

      {!showInlineActions ? (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onDismissPrompt}
            className="inline-flex h-8 items-center gap-2 rounded-full px-2 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <span>Dismiss</span>
            <span className="rounded-md border border-border/70 px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground">
              Esc
            </span>
          </button>
          <button
            type="submit"
            disabled={!canSubmitCurrentQuestion}
            className="inline-flex h-8 items-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-40"
          >
            <span>{submitLabel}</span>
            <span className="flex size-5 items-center justify-center rounded-md border border-primary-foreground/20 text-primary-foreground/85">
              <ArrowMoveDownLeft className="size-3" />
            </span>
          </button>
        </div>
      ) : null}
    </div>
  )
}
