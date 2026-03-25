import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { existsSync, statSync } from "node:fs"
import type { GitBranchesResponse, GitWorkingTreeSummary } from "../../src/desktop/contracts"

const execFileAsync = promisify(execFile)

async function runGitCommand(projectPath: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", projectPath, ...args], {
      encoding: "utf8",
    })
    return stdout.trim()
  } catch (error) {
    const execError = error as Error & { stderr?: string }
    const stderr = execError.stderr?.trim()
    throw new Error(stderr || `git ${args.join(" ")} failed`)
  }
}

function ensureGitProjectPath(projectPath: string): string {
  const trimmedPath = projectPath.trim()
  if (!trimmedPath) {
    throw new Error("Project path is required")
  }

  if (!existsSync(trimmedPath)) {
    throw new Error(`Project path does not exist: ${trimmedPath}`)
  }

  if (!statSync(trimmedPath).isDirectory()) {
    throw new Error(`Project path is not a folder: ${trimmedPath}`)
  }

  return trimmedPath
}

function parseGitShortstat(shortstat: string): GitWorkingTreeSummary {
  let changedFiles = 0
  let additions = 0
  let deletions = 0
  let previousNumber: number | null = null

  for (const token of shortstat.split(/\s+/)) {
    const parsed = Number.parseInt(token, 10)
    if (!Number.isNaN(parsed)) {
      previousNumber = parsed
      continue
    }

    if (previousNumber == null) {
      continue
    }

    switch (token) {
      case "file":
      case "files":
        changedFiles = previousNumber
        break
      case "insertion(+)":
      case "insertions(+)":
        additions = previousNumber
        break
      case "deletion(-)":
      case "deletions(-)":
        deletions = previousNumber
        break
      default:
        break
    }

    previousNumber = null
  }

  return { changedFiles, additions, deletions }
}

async function gitHeadExists(projectPath: string): Promise<boolean> {
  try {
    await runGitCommand(projectPath, ["rev-parse", "--verify", "HEAD"])
    return true
  } catch {
    return false
  }
}

async function getWorkingTreeSummary(projectPath: string): Promise<GitWorkingTreeSummary> {
  let changedFiles = 0

  try {
    const output = await runGitCommand(projectPath, ["status", "--porcelain"])
    changedFiles = output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean).length
  } catch {
    changedFiles = 0
  }

  const shortstat = await (async () => {
    try {
      if (await gitHeadExists(projectPath)) {
        return await runGitCommand(projectPath, ["diff", "--shortstat", "HEAD"])
      }
      return await runGitCommand(projectPath, ["diff", "--shortstat", "--cached"])
    } catch {
      return ""
    }
  })()

  const summary = parseGitShortstat(shortstat)
  return {
    changedFiles,
    additions: summary.additions,
    deletions: summary.deletions,
  }
}

async function getGitBranchesResponse(projectPath: string): Promise<GitBranchesResponse> {
  const trimmedPath = ensureGitProjectPath(projectPath)
  await runGitCommand(trimmedPath, ["rev-parse", "--show-toplevel"])

  let currentBranch = await runGitCommand(trimmedPath, ["branch", "--show-current"])
  if (!currentBranch) {
    const commit = await runGitCommand(trimmedPath, ["rev-parse", "--short", "HEAD"])
    currentBranch = `detached@${commit}`
  }

  let upstreamBranch: string | null = null
  try {
    upstreamBranch = await runGitCommand(trimmedPath, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ])
    upstreamBranch = upstreamBranch || null
  } catch {
    upstreamBranch = null
  }

  const branchesOutput = await runGitCommand(trimmedPath, [
    "for-each-ref",
    "--sort=refname",
    "--format=%(refname:short)",
    "refs/heads",
    "refs/remotes",
  ])

  const branches = Array.from(
    new Set(
      branchesOutput
        .split("\n")
        .map((value) => value.trim())
        .filter((value) => value && value !== "origin/HEAD")
        .sort()
    )
  )

  return {
    currentBranch,
    upstreamBranch,
    branches,
    workingTreeSummary: await getWorkingTreeSummary(trimmedPath),
  }
}

function localBranchNameForRemote(branchName: string): string {
  return branchName.split("/").slice(1).join("/") || branchName
}

export class GitService {
  getBranches(projectPath: string): Promise<GitBranchesResponse> {
    return getGitBranchesResponse(projectPath)
  }

  async checkoutBranch(projectPath: string, branchName: string): Promise<GitBranchesResponse> {
    const trimmedPath = ensureGitProjectPath(projectPath)
    await runGitCommand(trimmedPath, ["rev-parse", "--show-toplevel"])

    const targetBranch = branchName.trim()
    if (!targetBranch) {
      throw new Error("Branch name is required")
    }

    const currentBranch = await runGitCommand(trimmedPath, ["branch", "--show-current"])
    if (currentBranch === targetBranch) {
      return getGitBranchesResponse(trimmedPath)
    }

    const localRef = `refs/heads/${targetBranch}`
    try {
      await runGitCommand(trimmedPath, ["show-ref", "--verify", "--quiet", localRef])
      await runGitCommand(trimmedPath, ["switch", targetBranch])
      return getGitBranchesResponse(trimmedPath)
    } catch {
      // Fall through to remote lookup.
    }

    const remoteRef = `refs/remotes/${targetBranch}`
    try {
      await runGitCommand(trimmedPath, ["show-ref", "--verify", "--quiet", remoteRef])
      const localBranchName = localBranchNameForRemote(targetBranch)
      const existingLocalRef = `refs/heads/${localBranchName}`

      try {
        await runGitCommand(trimmedPath, ["show-ref", "--verify", "--quiet", existingLocalRef])
        await runGitCommand(trimmedPath, ["switch", localBranchName])
      } catch {
        await runGitCommand(trimmedPath, [
          "switch",
          "--track",
          "-c",
          localBranchName,
          targetBranch,
        ])
      }

      return getGitBranchesResponse(trimmedPath)
    } catch {
      throw new Error(`Branch not found: ${targetBranch}`)
    }
  }

  async createAndCheckoutBranch(
    projectPath: string,
    branchName: string
  ): Promise<GitBranchesResponse> {
    const trimmedPath = ensureGitProjectPath(projectPath)
    await runGitCommand(trimmedPath, ["rev-parse", "--show-toplevel"])

    const nextBranch = branchName.trim()
    if (!nextBranch) {
      throw new Error("Branch name is required")
    }

    await runGitCommand(trimmedPath, ["check-ref-format", "--branch", nextBranch])
    await runGitCommand(trimmedPath, ["switch", "-c", nextBranch])

    return getGitBranchesResponse(trimmedPath)
  }
}
