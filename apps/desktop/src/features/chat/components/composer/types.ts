import type {
  RuntimeApprovalPrompt,
  RuntimePrompt,
  RuntimePromptOption,
  RuntimePromptQuestion,
  RuntimeQuestionPrompt,
} from "../../types"

export type ComposerPlanStepStatus = "pending" | "in_progress" | "completed"

export interface ComposerPlanStep {
  id: string
  label: string
  status?: ComposerPlanStepStatus
}

export interface ComposerPlan {
  title: string
  summary?: string
  steps: ComposerPlanStep[]
}

export type ComposerPromptOption = RuntimePromptOption

export type ComposerPromptQuestion = RuntimePromptQuestion

export type ComposerPrompt = RuntimePrompt

export type ComposerApprovalPrompt = RuntimeApprovalPrompt

export type ComposerQuestionPrompt = RuntimeQuestionPrompt
