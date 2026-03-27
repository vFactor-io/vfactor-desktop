import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { existsSync, realpathSync, statSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import type {
  GitBranchesResponse,
  GitFileChange,
  GitFileDiff,
  GitFileStatus,
  GitWorkingTreeSummary,
} from "../../src/desktop/contracts"

const execFileAsync = promisify(execFile)

async function runGitCommandRaw(projectPath: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", projectPath, ...args], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    })
    return stdout
  } catch (error) {
    const execError = error as Error & { stderr?: string }
    const stderr = execError.stderr?.trim()
    throw new Error(stderr || `git ${args.join(" ")} failed`)
  }
}

async function runGitCommand(projectPath: string, args: string[]): Promise<string> {
  return (await runGitCommandRaw(projectPath, args)).trim()
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

function mapGitStatusCode(code: string): GitFileStatus {
  if (code.includes("?")) {
    return "untracked"
  }

  if (code.includes("R")) {
    return "renamed"
  }

  if (code.includes("C")) {
    return "copied"
  }

  if (code.includes("A")) {
    return "added"
  }

  if (code.includes("D")) {
    return "deleted"
  }

  if (code.includes("!")) {
    return "ignored"
  }

  return "modified"
}

function parseGitStatusEntries(output: string): GitFileChange[] {
  if (!output) {
    return []
  }

  const entries = output.split("\0")
  const changes: GitFileChange[] = []

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (!entry) {
      continue
    }

    if (entry.startsWith("? ")) {
      changes.push({
        path: entry.slice(2),
        status: "untracked",
      })
      continue
    }

    if (entry.startsWith("! ")) {
      changes.push({
        path: entry.slice(2),
        status: "ignored",
      })
      continue
    }

    if (entry.startsWith("1 ")) {
      const match = /^1 ([^ ]+) [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ (.+)$/.exec(entry)
      if (!match) {
        continue
      }

      changes.push({
        path: match[2],
        status: mapGitStatusCode(match[1]),
      })
      continue
    }

    if (entry.startsWith("u ")) {
      const match =
        /^u ([^ ]+) [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ (.+)$/.exec(entry)

      if (!match) {
        continue
      }

      changes.push({
        path: match[2],
        status: mapGitStatusCode(match[1]),
      })
      continue
    }

    if (entry.startsWith("2 ")) {
      const match = /^2 ([^ ]+) [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ (.+)$/.exec(entry)
      if (!match) {
        continue
      }

      const previousPath = entries[index + 1] || null
      changes.push({
        path: match[2],
        previousPath,
        status: mapGitStatusCode(match[1]),
      })
      index += 1
    }
  }

  return changes
}

function parseGitNumstatEntries(output: string): Map<string, Pick<GitFileChange, "additions" | "deletions">> {
  const stats = new Map<string, Pick<GitFileChange, "additions" | "deletions">>()

  if (!output) {
    return stats
  }

  const entries = output.split("\0")

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (!entry) {
      continue
    }

    const [rawAdditions, rawDeletions, rawPath] = entry.split("\t")
    if (rawAdditions == null || rawDeletions == null || rawPath == null) {
      continue
    }

    const additions = rawAdditions === "-" ? undefined : Number.parseInt(rawAdditions, 10)
    const deletions = rawDeletions === "-" ? undefined : Number.parseInt(rawDeletions, 10)

    if (rawPath.length > 0) {
      stats.set(rawPath, { additions, deletions })
      continue
    }

    const previousPath = entries[index + 1]
    const nextPath = entries[index + 2]

    if (previousPath && nextPath) {
      stats.set(nextPath, { additions, deletions })
      index += 2
    }
  }

  return stats
}

function getGitScopePath(repoRoot: string, projectPath: string): string | null {
  const normalizedRepoRoot = realpathSync(repoRoot)
  const normalizedProjectPath = realpathSync(projectPath)
  const relativeProjectPath = path.relative(normalizedRepoRoot, normalizedProjectPath)

  if (!relativeProjectPath || relativeProjectPath === ".") {
    return null
  }

  return relativeProjectPath.split(path.sep).join("/")
}

function withOptionalPathspec(args: string[], scopePath: string | null): string[] {
  if (!scopePath) {
    return args
  }

  return [...args, "--", scopePath]
}

function toProjectRelativePath(filePath: string, scopePath: string | null): string {
  if (!scopePath) {
    return filePath
  }

  if (filePath === scopePath) {
    return path.basename(filePath)
  }

  const normalizedPrefix = `${scopePath}/`
  return filePath.startsWith(normalizedPrefix) ? filePath.slice(normalizedPrefix.length) : filePath
}

function toRepoRelativePath(filePath: string, scopePath: string | null): string {
  const normalizedFilePath = filePath.replace(/\\/g, "/")
  if (!scopePath) {
    return normalizedFilePath
  }

  return `${scopePath}/${normalizedFilePath}`
}

async function readWorkingTreeFile(repoRoot: string, repoRelativePath: string): Promise<string> {
  try {
    return await readFile(path.join(repoRoot, ...repoRelativePath.split("/")), "utf8")
  } catch {
    return ""
  }
}

async function readHeadFile(repoRoot: string, repoRelativePath: string): Promise<string> {
  try {
    return await runGitCommandRaw(repoRoot, ["show", `HEAD:${repoRelativePath}`])
  } catch {
    return ""
  }
}

async function getChangedFiles(projectPath: string): Promise<GitFileChange[]> {
  const repoRoot = await runGitCommand(projectPath, ["rev-parse", "--show-toplevel"])
  const scopePath = getGitScopePath(repoRoot, projectPath)
  const statusOutput = await runGitCommand(
    repoRoot,
    withOptionalPathspec([
    "status",
    "--porcelain=v2",
    "-z",
    "--untracked-files=all",
    ], scopePath)
  )

  const changes = parseGitStatusEntries(statusOutput).filter((change) => change.status !== "ignored")
  if (changes.length === 0) {
    return []
  }

  const diffArgs = await (async () => {
    if (await gitHeadExists(projectPath)) {
      return withOptionalPathspec(["diff", "--numstat", "-z", "--find-renames", "HEAD"], scopePath)
    }

    return withOptionalPathspec(["diff", "--numstat", "-z", "--find-renames", "--cached"], scopePath)
  })()

  const numstatOutput = await (async () => {
    try {
      return await runGitCommand(repoRoot, diffArgs)
    } catch {
      return ""
    }
  })()

  const statsByPath = parseGitNumstatEntries(numstatOutput)

  return changes.map((change) => ({
    ...change,
    path: toProjectRelativePath(change.path, scopePath),
    previousPath: change.previousPath
      ? toProjectRelativePath(change.previousPath, scopePath)
      : change.previousPath,
    additions: statsByPath.get(change.path)?.additions ?? change.additions,
    deletions: statsByPath.get(change.path)?.deletions ?? change.deletions,
  }))
}

async function getFileDiff(
  projectPath: string,
  filePath: string,
  previousPath?: string | null
): Promise<GitFileDiff> {
  const trimmedPath = ensureGitProjectPath(projectPath)
  const repoRoot = await runGitCommand(trimmedPath, ["rev-parse", "--show-toplevel"])
  const scopePath = getGitScopePath(repoRoot, trimmedPath)
  const repoRelativePath = toRepoRelativePath(filePath, scopePath)
  const previousRepoRelativePath = previousPath
    ? toRepoRelativePath(previousPath, scopePath)
    : repoRelativePath
  const hasHead = await gitHeadExists(trimmedPath)

  const modified = await readWorkingTreeFile(repoRoot, repoRelativePath)
  const original = hasHead
    ? await readHeadFile(repoRoot, previousRepoRelativePath)
    : ""

  let status: GitFileStatus = "modified"

  if (!hasHead && modified) {
    status = "untracked"
  } else if (!original && modified) {
    status = previousPath ? "renamed" : "added"
  } else if (original && !modified) {
    status = "deleted"
  } else if (previousPath && previousPath !== filePath) {
    status = "renamed"
  }

  return {
    path: filePath,
    previousPath: previousPath ?? null,
    status,
    original,
    modified,
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

export async function resolveGitDirectory(projectPath: string): Promise<string> {
  const trimmedPath = ensureGitProjectPath(projectPath)
  await runGitCommand(trimmedPath, ["rev-parse", "--show-toplevel"])
  return runGitCommand(trimmedPath, ["rev-parse", "--absolute-git-dir"])
}

function localBranchNameForRemote(branchName: string): string {
  return branchName.split("/").slice(1).join("/") || branchName
}

export class GitService {
  getBranches(projectPath: string): Promise<GitBranchesResponse> {
    return getGitBranchesResponse(projectPath)
  }

  async getChanges(projectPath: string): Promise<GitFileChange[]> {
    const trimmedPath = ensureGitProjectPath(projectPath)
    await runGitCommand(trimmedPath, ["rev-parse", "--show-toplevel"])
    return getChangedFiles(trimmedPath)
  }

  getFileDiff(projectPath: string, filePath: string, previousPath?: string | null): Promise<GitFileDiff> {
    return getFileDiff(projectPath, filePath, previousPath)
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
