import type {
  HarnessId,
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

export const REASONING_EFFORTS = ["Low", "Medium", "High"] as const

export function getModelsForHarness(harnessId: HarnessId | null): string[] {
  switch (harnessId) {
    case "codex":
      return ["GPT-5.4", "GPT-5", "GPT-5 mini"]
    case "claude-code":
      return ["Claude Sonnet 4.5", "Claude Opus 4.1"]
    default:
      return ["Default model"]
  }
}
