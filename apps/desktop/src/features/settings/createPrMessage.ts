export const DEFAULT_PR_TARGET_BRANCH = "origin/main"

export interface CreatePrMessageContext {
  currentBranch: string
  targetBranch?: string
  upstreamBranch: string | null
  uncommittedChanges: number
}

const VARIABLE_PATTERN = /\{\{\s*(currentBranch|targetBranch|upstreamBranch|uncommittedChanges)\s*\}\}/g

function formatUncommittedChanges(count: number): string {
  return `There ${count === 1 ? "is" : "are"} ${count} uncommitted change${count === 1 ? "" : "s"}.`
}

function formatUpstreamBranch(upstreamBranch: string | null): string {
  if (!upstreamBranch?.trim()) {
    return "There is no upstream branch yet."
  }

  return `The upstream branch is ${upstreamBranch}.`
}

function getTemplateVariables({
  currentBranch,
  targetBranch = DEFAULT_PR_TARGET_BRANCH,
  upstreamBranch,
  uncommittedChanges,
}: CreatePrMessageContext): Record<
  "currentBranch" | "targetBranch" | "upstreamBranch" | "uncommittedChanges",
  string
> {
  return {
    currentBranch,
    targetBranch,
    upstreamBranch: upstreamBranch?.trim() || "no upstream branch yet",
    uncommittedChanges: String(uncommittedChanges),
  }
}

export function interpolateCreatePrInstructions(
  template: string,
  context: CreatePrMessageContext,
): string {
  const variables = getTemplateVariables(context)

  return template.replace(
    VARIABLE_PATTERN,
    (_, key: keyof typeof variables) => variables[key] ?? "",
  )
}

export function buildCreatePrMessage(
  context: CreatePrMessageContext,
  extraInstructions?: string | null,
): string {
  const targetBranch = context.targetBranch ?? DEFAULT_PR_TARGET_BRANCH
  const baseMessage = [
    "The user likes the current state of the code.",
    formatUncommittedChanges(context.uncommittedChanges),
    `The current branch is ${context.currentBranch}.`,
    `The target branch is ${targetBranch}.`,
    formatUpstreamBranch(context.upstreamBranch),
    "The user requested a PR.",
    "Follow these steps to create a PR:",
    "- If you have any skills related to creating PRs, invoke them now. Instructions there should take precedence over these instructions.",
    "- Run `git diff` to review uncommitted changes",
    "- Commit them. Follow any instructions the user gave you about writing commit messages.",
    "- Push to origin.",
    `- Use \`git diff ${targetBranch}...\` to review the PR diff`,
    "- Use `gh pr create --base main` to create a PR onto the target branch. Keep the title under 80 characters. Keep the description under five sentences, unless the user instructed you otherwise. Describe not just changes made in this session but ALL changes in the workspace diff.",
    "If any of these steps fail, ask the user for help.",
  ].join("\n")

  const appendedInstructions = interpolateCreatePrInstructions(
    extraInstructions?.trim() ?? "",
    context,
  ).trim()

  if (!appendedInstructions) {
    return baseMessage
  }

  return `${baseMessage}\n\nAdditional user instructions:\n${appendedInstructions}`
}
