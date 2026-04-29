import { execFile, spawn } from "node:child_process"
import { existsSync, realpathSync, statSync } from "node:fs"
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify, TextDecoder } from "node:util"
import { capture, captureException } from "./analytics"

import type {
  GitActionProgressEvent,
  GitBranchesResponse,
  GitCreateWorktreeInput,
  GitCreateWorktreeResult,
  GitFileChange,
  GitFileDiff,
  GitFileStatus,
  GitMergePullRequestResult,
  GitPullRequestCheck,
  GitPullRequestComment,
  GitPullRequest,
  GitPullRequestChecksResponse,
  GitPullRequestReviewComment,
  GitPullRequestReview,
  GitPullResult,
  GitRenameWorktreeInput,
  GitRenameWorktreeResult,
  GitRemoveWorktreeInput,
  GitRemoveWorktreeResult,
  GitRunStackedActionInput,
  GitRunStackedActionResult,
  GitWorkingTreeSummary,
  GitWorktreeSummary,
} from "../../src/desktop/contracts"

const execFileAsync = promisify(execFile)
const CODEX_REASONING_EFFORT = "low"
const ENABLE_VERBOSE_GIT_LOGS = process.env.VFACTOR_VERBOSE_GIT_LOGS === "1"
const MAX_DIFF_PREVIEW_FILE_BYTES = 2 * 1024 * 1024
const UTF8_DECODER_FATAL = new TextDecoder("utf-8", { fatal: true })

const IMAGE_DIFF_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".heic",
  ".heif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".tif",
  ".tiff",
  ".webp",
])

type CommitSuggestion = {
  subject: string
  body: string
  branch?: string
}

type RangeContext = {
  commitSummary: string
  diffSummary: string
  diffPatch: string
}

function logGitDebug(message: string, details?: unknown): void {
  if (!ENABLE_VERBOSE_GIT_LOGS) {
    return
  }

  if (details === undefined) {
    console.debug(message)
    return
  }

  console.debug(message, details)
}

function isBenignMissingChecksError(errorMessage: string | null | undefined): boolean {
  if (!errorMessage) {
    return false
  }

  return /no required checks reported/i.test(errorMessage)
}

async function runCommandWithInput(
  command: string,
  args: string[],
  options: {
    cwd: string
    input?: string
    env?: NodeJS.ProcessEnv
  }
): Promise<{ stdout: string; stderr: string }> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: process.platform === "win32",
      stdio: "pipe",
    })

    let stdout = ""
    let stderr = ""

    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")

    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })

    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(
        new Error(
          stderr.trim() || stdout.trim() || `${command} ${args.join(" ")} failed with code ${code}`
        )
      )
    })

    if (options.input) {
      child.stdin.write(options.input)
    }
    child.stdin.end()
  })

  return { stdout: "", stderr: "" }
}

async function runGitCommandRaw(
  projectPath: string,
  args: string[],
  env?: NodeJS.ProcessEnv
): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", projectPath, ...args], {
      encoding: "utf8",
      env,
      maxBuffer: 10 * 1024 * 1024,
    })
    return stdout
  } catch (error) {
    const execError = error as Error & { stderr?: string; code?: string }
    if (execError.code === "ENOENT" || /spawn git\b.*enoent/i.test(execError.message)) {
      throw new Error("Git is not installed on this machine.")
    }
    const stderr = execError.stderr?.trim()
    throw new Error(stderr || `git ${args.join(" ")} failed`)
  }
}

async function runGitCommand(
  projectPath: string,
  args: string[],
  env?: NodeJS.ProcessEnv
): Promise<string> {
  return (await runGitCommandRaw(projectPath, args, env)).trim()
}

async function runGhCommand(projectPath: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("gh", args, {
      cwd: projectPath,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    })
    return stdout.trim()
  } catch (error) {
    const execError = error as Error & { stderr?: string; code?: number }
    const stderr = execError.stderr?.trim()
    const wrappedError = new Error(stderr || `gh ${args.join(" ")} failed`) as Error & {
      code?: number
    }
    wrappedError.code = execError.code
    throw wrappedError
  }
}

function isMissingGitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : ""
  return message.includes("git is not installed on this machine") || message.includes("spawn git")
}

function isNotGitRepositoryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : ""
  return message.includes("not a git repository")
}

function createGitStatusResponse(options: {
  isGitAvailable: boolean
  isRepo: boolean
}): GitBranchesResponse {
  return {
    isGitAvailable: options.isGitAvailable,
    isRepo: options.isRepo,
    currentBranch: "",
    upstreamBranch: null,
    branches: [],
    remoteNames: [],
    workingTreeSummary: {
      changedFiles: 0,
      additions: 0,
      deletions: 0,
    },
    aheadCount: 0,
    behindCount: 0,
    hasOriginRemote: false,
    hasUpstream: false,
    defaultBranch: null,
    isDefaultBranch: false,
    isDetached: false,
    openPullRequest: null,
  }
}

async function runGhCommandWithAllowedExitCodes(
  projectPath: string,
  args: string[],
  allowedExitCodes: number[]
): Promise<string> {
  try {
    const { stdout } = await execFileAsync("gh", args, {
      cwd: projectPath,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    })
    return stdout.trim()
  } catch (error) {
    const execError = error as Error & { code?: number; stdout?: string; stderr?: string }
    if (execError.code != null && allowedExitCodes.includes(execError.code)) {
      return execError.stdout?.trim() ?? ""
    }

    const stderr = execError.stderr?.trim()
    throw new Error(stderr || `gh ${args.join(" ")} failed`)
  }
}

function formatGhError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim()
  }

  return fallback
}

async function runGhJsonCommandWithAllowedExitCodes(
  projectPath: string,
  args: string[],
  allowedExitCodes: number[]
): Promise<string> {
  try {
    const { stdout } = await execFileAsync("gh", args, {
      cwd: projectPath,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    })
    return stdout.trim()
  } catch (error) {
    const execError = error as Error & { code?: number; stdout?: string; stderr?: string }
    const stdout = execError.stdout?.trim() ?? ""
    const stderr = execError.stderr?.trim()

    if (execError.code != null && allowedExitCodes.includes(execError.code) && stdout) {
      return stdout
    }

    throw new Error(stderr || stdout || `gh ${args.join(" ")} failed`)
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

async function getRepoContext(projectPath: string): Promise<{
  projectPath: string
  repoRoot: string
  scopePath: string | null
}> {
  const normalizedProjectPath = ensureGitProjectPath(projectPath)
  const repoRoot = await runGitCommand(normalizedProjectPath, ["rev-parse", "--show-toplevel"])
  return {
    projectPath: normalizedProjectPath,
    repoRoot,
    scopePath: getGitScopePath(repoRoot, normalizedProjectPath),
  }
}

function parseBranchNameFromRef(value: string | null | undefined, head: string | null): string {
  if (!value) {
    return head ? `detached@${head.slice(0, 7)}` : "detached"
  }

  return value.replace(/^refs\/heads\//, "")
}

function parseGitWorktreeEntries(
  output: string,
  currentPath: string
): GitWorktreeSummary[] {
  const normalizedCurrentPath = realpathSync(currentPath)
  const blocks = output
    .trim()
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean)

  return blocks
    .map((block, index) => {
      const lines = block.split(/\r?\n/)
      let worktreePath: string | null = null
      let head: string | null = null
      let branchRef: string | null = null
      let isDetached = false

      for (const line of lines) {
        if (line.startsWith("worktree ")) {
          worktreePath = line.slice("worktree ".length).trim()
          continue
        }
        if (line.startsWith("HEAD ")) {
          head = line.slice("HEAD ".length).trim()
          continue
        }
        if (line.startsWith("branch ")) {
          branchRef = line.slice("branch ".length).trim()
          continue
        }
        if (line === "detached") {
          isDetached = true
        }
      }

      if (!worktreePath) {
        return null
      }

      let resolvedPath: string
      try {
        resolvedPath = realpathSync(worktreePath)
      } catch {
        return null
      }

      return {
        path: resolvedPath,
        branchName: parseBranchNameFromRef(branchRef, head),
        head,
        isDetached,
        isCurrent: resolvedPath === normalizedCurrentPath,
        isMain: index === 0,
      }
    })
    .filter((entry): entry is GitWorktreeSummary => entry != null)
}

async function listGitWorktrees(projectPath: string): Promise<GitWorktreeSummary[]> {
  const trimmedPath = ensureGitProjectPath(projectPath)
  try {
    await runGitCommand(trimmedPath, ["rev-parse", "--show-toplevel"])
  } catch (error) {
    if (isMissingGitError(error) || isNotGitRepositoryError(error)) {
      return []
    }

    throw error
  }
  const output = await runGitCommandRaw(trimmedPath, ["worktree", "list", "--porcelain"])
  return parseGitWorktreeEntries(output, trimmedPath)
}

function resolveDefaultManagedWorktreePath(repoRoot: string, branchName: string): string {
  const repoParentPath = path.dirname(repoRoot)
  const repoName = path.basename(repoRoot)
  return path.join(repoParentPath, ".vfactor-worktrees", repoName, branchName)
}

async function assertWorktreeIsClean(worktreePath: string): Promise<void> {
  const statusOutput = await runGitCommandRaw(worktreePath, ["status", "--porcelain"])
  if (statusOutput.trim()) {
    throw new Error("This worktree has uncommitted changes. Clean it up before removing it.")
  }
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
      changes.push({ path: entry.slice(2), status: "untracked" })
      continue
    }

    if (entry.startsWith("! ")) {
      changes.push({ path: entry.slice(2), status: "ignored" })
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

function parseGitNumstatEntries(
  output: string
): Map<string, Pick<GitFileChange, "additions" | "deletions">> {
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

function withSpecificPathspecs(args: string[], repoRelativePaths: string[]): string[] {
  if (repoRelativePaths.length === 0) {
    return args
  }

  return [...args, "--", ...repoRelativePaths]
}

type CommitTarget = {
  repoRoot: string
  pathspecs: string[] | null
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

function getWorkingTreeFileSize(repoRoot: string, repoRelativePath: string): number | null {
  try {
    return statSync(path.join(repoRoot, ...repoRelativePath.split("/"))).size
  } catch {
    return null
  }
}

async function getHeadFileSize(repoRoot: string, repoRelativePath: string): Promise<number | null> {
  try {
    const output = await runGitCommand(repoRoot, ["cat-file", "-s", `HEAD:${repoRelativePath}`])
    const size = Number.parseInt(output, 10)
    return Number.isFinite(size) ? size : null
  } catch {
    return null
  }
}

function isImageDiffPath(filePath: string): boolean {
  return IMAGE_DIFF_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

function isBinaryPatch(patch: string | null): boolean {
  return patch ? /^Binary files .+ differ$/m.test(patch) : false
}

async function isWorkingTreeFileBinary(repoRoot: string, repoRelativePath: string): Promise<boolean> {
  let contents: Buffer

  try {
    contents = await readFile(path.join(repoRoot, ...repoRelativePath.split("/")))
  } catch {
    return false
  }

  if (contents.length === 0) {
    return false
  }

  if (contents.includes(0)) {
    return true
  }

  try {
    UTF8_DECODER_FATAL.decode(contents)
    return false
  } catch {
    return true
  }
}

function resolveLimitedDiffReason(input: {
  path: string
  previousPath: string
  modifiedSize: number | null
  originalSize: number | null
  patch: string | null
}): GitFileDiff["previewUnavailableReason"] | null {
  if (isImageDiffPath(input.path) || isImageDiffPath(input.previousPath)) {
    return "image"
  }

  if (isBinaryPatch(input.patch)) {
    return "binary"
  }

  if (
    (input.modifiedSize != null && input.modifiedSize > MAX_DIFF_PREVIEW_FILE_BYTES) ||
    (input.originalSize != null && input.originalSize > MAX_DIFF_PREVIEW_FILE_BYTES)
  ) {
    return "too_large"
  }

  return null
}

async function readGitDiffPatch(
  projectPath: string,
  repoRelativePaths: string[],
  hasHead: boolean
): Promise<string | null> {
  if (repoRelativePaths.length === 0) {
    return null
  }

  const args = hasHead
    ? withSpecificPathspecs(
        ["diff", "--no-ext-diff", "--find-renames", "--unified=3", "HEAD"],
        repoRelativePaths
      )
    : withSpecificPathspecs(
        ["diff", "--no-ext-diff", "--find-renames", "--unified=3", "--cached"],
        repoRelativePaths
      )

  try {
    const patch = await runGitCommand(projectPath, args)
    return patch.trim() ? patch : null
  } catch {
    return null
  }
}

async function getChangedFiles(projectPath: string): Promise<GitFileChange[]> {
  const { repoRoot, scopePath } = await getRepoContext(projectPath)
  const statusOutput = await runGitCommand(
    repoRoot,
    withOptionalPathspec(
      ["status", "--porcelain=v2", "-z", "--untracked-files=all"],
      scopePath
    )
  )

  const changes = parseGitStatusEntries(statusOutput).filter((change) => change.status !== "ignored")
  if (changes.length === 0) {
    return []
  }

  const diffArgs = await (async () => {
    if (await gitHeadExists(projectPath)) {
      return withOptionalPathspec(["diff", "--numstat", "-z", "--find-renames", "HEAD"], scopePath)
    }

    return withOptionalPathspec(
      ["diff", "--numstat", "-z", "--find-renames", "--cached"],
      scopePath
    )
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
  const { repoRoot, scopePath } = await getRepoContext(projectPath)
  const repoRelativePath = toRepoRelativePath(filePath, scopePath)
  const previousRepoRelativePath = previousPath
    ? toRepoRelativePath(previousPath, scopePath)
    : repoRelativePath
  const hasHead = await gitHeadExists(projectPath)
  const modifiedSize = getWorkingTreeFileSize(repoRoot, repoRelativePath)
  const originalSize = hasHead ? await getHeadFileSize(repoRoot, previousRepoRelativePath) : null
  const pathspecs =
    previousPath && previousRepoRelativePath !== repoRelativePath
      ? [previousRepoRelativePath, repoRelativePath]
      : [repoRelativePath]
  let previewUnavailableReason = resolveLimitedDiffReason({
    path: repoRelativePath,
    previousPath: previousRepoRelativePath,
    modifiedSize,
    originalSize,
    patch: null,
  })

  if (!previewUnavailableReason && modifiedSize != null) {
    previewUnavailableReason = (await isWorkingTreeFileBinary(repoRoot, repoRelativePath)) ? "binary" : null
  }

  const patch = previewUnavailableReason
    ? null
    : await readGitDiffPatch(projectPath, pathspecs, hasHead)

  if (!previewUnavailableReason) {
    previewUnavailableReason = resolveLimitedDiffReason({
      path: repoRelativePath,
      previousPath: previousRepoRelativePath,
      modifiedSize,
      originalSize,
      patch,
    })
  }

  const modified = previewUnavailableReason ? "" : await readWorkingTreeFile(repoRoot, repoRelativePath)
  const original = previewUnavailableReason || !hasHead ? "" : await readHeadFile(repoRoot, previousRepoRelativePath)

  let status: GitFileStatus = "modified"

  const hasModifiedFile = modifiedSize != null
  const hasOriginalFile = originalSize != null || Boolean(original)

  if (!hasHead && hasModifiedFile) {
    status = "untracked"
  } else if (!hasOriginalFile && hasModifiedFile) {
    status = previousPath ? "renamed" : "added"
  } else if (hasOriginalFile && !hasModifiedFile) {
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
    patch: previewUnavailableReason ? null : patch,
    isBinary: previewUnavailableReason === "binary",
    isImage: previewUnavailableReason === "image",
    isTooLarge: previewUnavailableReason === "too_large",
    previewUnavailableReason: previewUnavailableReason ?? undefined,
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

async function getAheadBehind(projectPath: string): Promise<{ aheadCount: number; behindCount: number }> {
  try {
    const raw = await runGitCommand(projectPath, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"])
    const [behindRaw, aheadRaw] = raw.split(/\s+/)
    return {
      behindCount: Number.parseInt(behindRaw ?? "0", 10) || 0,
      aheadCount: Number.parseInt(aheadRaw ?? "0", 10) || 0,
    }
  } catch {
    return { aheadCount: 0, behindCount: 0 }
  }
}

async function hasOriginRemote(projectPath: string): Promise<boolean> {
  try {
    await runGitCommand(projectPath, ["remote", "get-url", "origin"])
    return true
  } catch {
    return false
  }
}

async function listRemoteNames(projectPath: string): Promise<string[]> {
  try {
    const output = await runGitCommand(projectPath, ["remote"])
    return output
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

async function getRemoteUrl(projectPath: string, remoteName: string): Promise<string | null> {
  try {
    return await runGitCommand(projectPath, ["remote", "get-url", remoteName])
  } catch {
    return null
  }
}

function parseGitHubRemoteSlug(remoteUrl: string | null): { owner: string; repo: string } | null {
  if (!remoteUrl) {
    return null
  }

  const normalized = remoteUrl.trim().replace(/\.git$/i, "")

  const sshMatch = normalized.match(/^git@github\.com:([^/]+)\/(.+)$/i)
  if (sshMatch?.[1] && sshMatch[2]) {
    return { owner: sshMatch[1], repo: sshMatch[2] }
  }

  const httpsMatch = normalized.match(/^https?:\/\/github\.com\/([^/]+)\/(.+)$/i)
  if (httpsMatch?.[1] && httpsMatch[2]) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] }
  }

  const sshUrlMatch = normalized.match(/^ssh:\/\/git@github\.com\/([^/]+)\/(.+)$/i)
  if (sshUrlMatch?.[1] && sshUrlMatch[2]) {
    return { owner: sshUrlMatch[1], repo: sshUrlMatch[2] }
  }

  return null
}

function getRemoteNameFromBranchRef(branchRef: string | null | undefined): string | null {
  if (!branchRef) {
    return null
  }

  const slashIndex = branchRef.indexOf("/")
  if (slashIndex <= 0) {
    return null
  }

  return branchRef.slice(0, slashIndex)
}

function getBranchNameFromBranchRef(branchRef: string | null | undefined): string | null {
  if (!branchRef) {
    return null
  }

  const slashIndex = branchRef.indexOf("/")
  if (slashIndex <= 0 || slashIndex >= branchRef.length - 1) {
    return null
  }

  return branchRef.slice(slashIndex + 1)
}

async function resolvePullRequestHeadRef(
  projectPath: string,
  branchName: string,
  remoteName: string | null
): Promise<string> {
  const remoteUrl = await getRemoteUrl(projectPath, remoteName ?? "origin")
  const remoteSlug = parseGitHubRemoteSlug(remoteUrl)
  if (!remoteSlug) {
    return branchName
  }

  return `${remoteSlug.owner}:${branchName}`
}

async function ensureRemoteBranchExists(
  projectPath: string,
  branchName: string,
  remoteName: string | null
): Promise<void> {
  const targetRemote = remoteName ?? "origin"

  try {
    const output = await runGitCommand(projectPath, [
      "ls-remote",
      "--heads",
      targetRemote,
      branchName,
    ])
    if (output.trim()) {
      return
    }
  } catch {
    // Fall through to the explicit error below.
  }

  throw new Error(
    `The branch "${branchName}" is not available on ${targetRemote} yet. Push it successfully before creating a pull request.`
  )
}

async function listLocalAndRemoteBranches(projectPath: string): Promise<string[]> {
  const branchesOutput = await runGitCommand(projectPath, [
    "for-each-ref",
    "--sort=refname",
    "--format=%(refname:short)",
    "refs/heads",
    "refs/remotes",
  ])

  return Array.from(
    new Set(
      branchesOutput
        .split("\n")
        .map((value) => value.trim())
        .filter((value) => value && value !== "origin/HEAD")
        .sort()
    )
  )
}

async function getCurrentUpstreamBranch(projectPath: string): Promise<string | null> {
  try {
    const upstreamBranch = await runGitCommand(projectPath, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ])
    return upstreamBranch || null
  } catch {
    return null
  }
}

async function resolveWorktreeBaseRemote(
  projectPath: string,
  preferredRemoteName: string | null = null
): Promise<string> {
  const remoteNames = await listRemoteNames(projectPath)

  if (preferredRemoteName) {
    if (remoteNames.includes(preferredRemoteName)) {
      return preferredRemoteName
    }

    throw new Error(`The configured remote "${preferredRemoteName}" is not available for this repository.`)
  }

  if (remoteNames.includes("origin")) {
    return "origin"
  }

  if (remoteNames.length === 1 && remoteNames[0]) {
    return remoteNames[0]
  }

  const upstreamRemote = getRemoteNameFromBranchRef(await getCurrentUpstreamBranch(projectPath))
  if (upstreamRemote && remoteNames.includes(upstreamRemote)) {
    return upstreamRemote
  }

  if (remoteNames.length === 0) {
    throw new Error(
      "A remote is required to create a worktree from the target branch. Configure the repository remote and try again."
    )
  }

  throw new Error(
    "Unable to determine which remote to use for the target branch. Configure a single remote or use origin."
  )
}

async function resolveWorktreeBaseRef(
  projectPath: string,
  branchName: string,
  preferredRemoteName: string | null = null
): Promise<{ remoteName: string; remoteRef: string }> {
  const remoteName = await resolveWorktreeBaseRemote(projectPath, preferredRemoteName)
  const remoteRef = `refs/remotes/${remoteName}/${branchName}`
  console.debug("[git] resolveWorktreeBaseRef:start", {
    projectPath,
    branchName,
    preferredRemoteName,
    remoteName,
    remoteRef,
  })

  let remoteBranchOutput = ""
  try {
    remoteBranchOutput = await runGitCommand(projectPath, ["ls-remote", "--heads", remoteName, branchName])
  } catch {
    throw new Error(
      `Unable to verify the target branch "${branchName}" on ${remoteName}. Fetch the branch from GitHub and try again.`
    )
  }

  if (!remoteBranchOutput.trim()) {
    throw new Error(
      `The target branch "${branchName}" is not available on ${remoteName}. Worktree creation stopped instead of using a local fallback.`
    )
  }

  try {
    await runGitCommand(projectPath, [
      "fetch",
      "--no-tags",
      remoteName,
      `refs/heads/${branchName}:${remoteRef}`,
    ])
  } catch {
    throw new Error(
      `Unable to fetch the latest state for "${branchName}" from ${remoteName}. Worktree creation stopped before using stale files.`
    )
  }

  try {
    await runGitCommand(projectPath, ["rev-parse", `${remoteRef}^{commit}`])
  } catch {
    throw new Error(
      `Unable to resolve the fetched target branch "${branchName}" from ${remoteName}. Worktree creation stopped.`
    )
  }

  console.debug("[git] resolveWorktreeBaseRef:resolved", {
    projectPath,
    branchName,
    remoteName,
    remoteRef,
  })

  return { remoteName, remoteRef }
}

async function listLocalBranchNames(projectPath: string): Promise<string[]> {
  const output = await runGitCommand(projectPath, [
    "for-each-ref",
    "--sort=refname",
    "--format=%(refname:short)",
    "refs/heads",
  ])

  return output
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean)
}

async function resolveDefaultBranch(projectPath: string, branches: string[]): Promise<string | null> {
  try {
    const originHead = await runGitCommand(projectPath, ["symbolic-ref", "refs/remotes/origin/HEAD"])
    const normalized = originHead.replace(/^refs\/remotes\/origin\//, "").trim()
    if (normalized) {
      return normalized
    }
  } catch {
    // Ignore and fall back to heuristics.
  }

  if (branches.includes("main")) {
    return "main"
  }

  if (branches.includes("master")) {
    return "master"
  }

  const firstLocalBranch = branches.find((branch) => !branch.includes("/"))
  return firstLocalBranch ?? null
}

function normalizePullRequestState(rawState: string | null | undefined): GitPullRequest["state"] {
  if (rawState === "merged" || rawState === "MERGED") {
    return "merged"
  }
  if (rawState === "closed" || rawState === "CLOSED") {
    return "closed"
  }
  return "open"
}

type RawPullRequest = {
  number: number
  title: string
  body?: string | null
  url: string
  state?: string | null
  baseRefName: string
  headRefName: string
  mergeable?: boolean | string | null
  mergeStateStatus?: string | null
  mergedAt?: string | null
}

type RawPullRequestCheck = {
  bucket?: string | null
  name?: string | null
  state?: string | null
  link?: string | null
  workflow?: string | null
  startedAt?: string | null
  completedAt?: string | null
  description?: string | null
  event?: string | null
}

type RawPullRequestChecksResult = {
  checks: RawPullRequestCheck[]
  error: string | null
}

type RawPullRequestReview = {
  id?: string | null
  state?: string | null
  body?: string | null
  submittedAt?: string | null
  author?: {
    login?: string | null
    avatarUrl?: string | null
  } | null
  authorAssociation?: string | null
  commit?: {
    oid?: string | null
  } | null
}

type RawPullRequestComment = {
  id?: string | null
  body?: string | null
  createdAt?: string | null
  url?: string | null
  author?: {
    login?: string | null
    avatarUrl?: string | null
  } | null
  authorAssociation?: string | null
}

type RawPullRequestReviewThreadComment = {
  id?: string | null
  body?: string | null
  path?: string | null
  state?: string | null
  publishedAt?: string | null
  createdAt?: string | null
  url?: string | null
  diffHunk?: string | null
  originalLine?: number | null
  originalStartLine?: number | null
  line?: number | null
  startLine?: number | null
  replyTo?: {
    id?: string | null
  } | null
  author?: {
    login?: string | null
    avatarUrl?: string | null
  } | null
}

type RawPullRequestReviewThread = {
  id?: string | null
  isResolved?: boolean | null
  isOutdated?: boolean | null
  comments?: {
    nodes?: RawPullRequestReviewThreadComment[] | null
  } | null
}

type GitHubActionsCheckTarget = {
  runId: string
  jobId?: string
}

export function summarizePullRequestChecks(
  checks: RawPullRequestCheck[]
): Pick<
  GitPullRequest,
  | "checksStatus"
  | "failedChecksCount"
  | "failedCheckNames"
  | "pendingChecksCount"
  | "passedChecksCount"
> {
  if (checks.length === 0) {
    return {
      checksStatus: "none",
    }
  }

  let failedChecksCount = 0
  let pendingChecksCount = 0
  let passedChecksCount = 0
  const failedCheckNames = new Set<string>()

  for (const check of checks) {
    switch (check.bucket) {
      case "fail":
      case "cancel":
        failedChecksCount += 1
        if (check.name?.trim()) {
          failedCheckNames.add(check.name.trim())
        }
        break
      case "pending":
        pendingChecksCount += 1
        break
      case "pass":
      case "skipping":
        passedChecksCount += 1
        break
      default:
        break
    }
  }

  if (failedChecksCount > 0) {
    return {
      checksStatus: "failed",
      failedChecksCount,
      failedCheckNames: Array.from(failedCheckNames),
      pendingChecksCount,
      passedChecksCount,
    }
  }

  if (pendingChecksCount > 0) {
    return {
      checksStatus: "pending",
      failedChecksCount,
      pendingChecksCount,
      passedChecksCount,
    }
  }

  if (passedChecksCount > 0) {
    return {
      checksStatus: "passed",
      failedChecksCount,
      pendingChecksCount,
      passedChecksCount,
    }
  }

  return {
    checksStatus: "none",
  }
}

export function normalizePullRequestMergeStatus(
  rawState: string | null | undefined,
  rawMergeable: boolean | string | null | undefined,
  rawMergeStateStatus: string | null | undefined
): GitPullRequest["mergeStatus"] {
  const state = normalizePullRequestState(rawState)
  if (state === "merged") {
    return "merged"
  }

  const normalizedMergeable =
    typeof rawMergeable === "string" ? rawMergeable.toUpperCase() : rawMergeable
  if (normalizedMergeable === true || normalizedMergeable === "MERGEABLE") {
    return "mergeable"
  }

  if (normalizedMergeable === false || normalizedMergeable === "CONFLICTING") {
    return "blocked"
  }

  switch (rawMergeStateStatus?.toUpperCase()) {
    case "CLEAN":
    case "HAS_HOOKS":
    case "UNSTABLE":
      return "mergeable"
    case "BEHIND":
    case "BLOCKED":
    case "DIRTY":
    case "DRAFT":
      return "blocked"
    default:
      return "unknown"
  }
}

export function normalizePullRequestResolveReason(input: {
  state: string | null | undefined
  checksStatus: GitPullRequest["checksStatus"]
  mergeStatus: GitPullRequest["mergeStatus"]
  mergeable: boolean | string | null | undefined
  mergeStateStatus: string | null | undefined
}): GitPullRequest["resolveReason"] {
  const state = normalizePullRequestState(input.state)
  if (state !== "open") {
    return undefined
  }

  if (input.checksStatus === "failed") {
    return "failed_checks"
  }

  if (input.checksStatus === "pending" || input.mergeStatus === "mergeable") {
    return undefined
  }

  const normalizedMergeable =
    typeof input.mergeable === "string" ? input.mergeable.toUpperCase() : input.mergeable
  const normalizedMergeStateStatus = input.mergeStateStatus?.toUpperCase()

  if (normalizedMergeable === "CONFLICTING" || normalizedMergeStateStatus === "DIRTY") {
    return "conflicts"
  }

  switch (normalizedMergeStateStatus) {
    case "BEHIND":
      return "behind"
    case "DRAFT":
      return "draft"
    case "BLOCKED":
      return "blocked"
    case "UNKNOWN":
      return "unknown"
    default:
      break
  }

  if (normalizedMergeable === false) {
    return "blocked"
  }

  return input.mergeStatus === "blocked" || input.mergeStatus === "unknown"
    ? "unknown"
    : undefined
}

export function shouldReuseExistingPullRequest(
  pullRequest: Pick<GitPullRequest, "state"> | null | undefined
): boolean {
  return pullRequest?.state === "open"
}

export function mapPullRequest(
  raw: RawPullRequest,
  checks: RawPullRequestCheck[] = [],
  options?: {
    checksError?: string | null
  }
): GitPullRequest {
  const checksSummary = summarizePullRequestChecks(checks)
  const mergeStatus = normalizePullRequestMergeStatus(
    raw.state,
    raw.mergeable,
    raw.mergeStateStatus
  )
  const resolveReason = normalizePullRequestResolveReason({
    state: raw.state,
    checksStatus: checksSummary.checksStatus,
    mergeStatus,
    mergeable: raw.mergeable,
    mergeStateStatus: raw.mergeStateStatus,
  })

  return {
    number: raw.number,
    title: raw.title,
    description: raw.body?.trim() || null,
    url: raw.url,
    state: normalizePullRequestState(raw.state),
    baseBranch: raw.baseRefName,
    headBranch: raw.headRefName,
    checksStatus: checksSummary.checksStatus,
    mergeStatus,
    isMergeable: mergeStatus === "mergeable",
    checksError: options?.checksError ?? null,
    failedChecksCount: checksSummary.failedChecksCount,
    failedCheckNames: checksSummary.failedCheckNames,
    pendingChecksCount: checksSummary.pendingChecksCount,
    passedChecksCount: checksSummary.passedChecksCount,
    resolveReason,
  }
}

async function queryPullRequests(
  projectPath: string,
  args: string[]
): Promise<RawPullRequest[]> {
  const output = await runGhCommand(projectPath, args)
  return JSON.parse(output) as RawPullRequest[]
}

async function getRawPullRequestChecks(
  projectPath: string,
  pullRequestNumber: number,
  options?: { requiredOnly?: boolean }
): Promise<RawPullRequestChecksResult> {
  try {
    const output = await runGhJsonCommandWithAllowedExitCodes(
      projectPath,
      [
        "pr",
        "checks",
        String(pullRequestNumber),
        ...(options?.requiredOnly ? ["--required"] : []),
        "--json",
        "bucket,completedAt,description,event,link,name,startedAt,state,workflow",
      ],
      [1, 8]
    )

    if (!output.trim()) {
      const errorMessage = "GitHub returned no pull request check data."
      console.warn("[git] getRawPullRequestChecks:empty", {
        projectPath,
        pullRequestNumber,
        errorMessage,
      })
      return {
        checks: [],
        error: errorMessage,
      }
    }

    const checks = JSON.parse(output) as RawPullRequestCheck[]
    return {
      checks,
      error: null,
    }
  } catch (error) {
    const errorMessage = formatGhError(error, "Unable to load pull request checks from GitHub.")
    const shouldSuppressError = isBenignMissingChecksError(errorMessage)
    if (!shouldSuppressError) {
      console.warn("[git] getRawPullRequestChecks:error", {
        projectPath,
        pullRequestNumber,
        error: errorMessage,
      })
    }
    return {
      checks: [],
      error: shouldSuppressError ? null : errorMessage,
    }
  }
}

function normalizePullRequestReviewState(
  value: string | null | undefined
): GitPullRequestReview["state"] {
  switch ((value ?? "").toUpperCase()) {
    case "APPROVED":
      return "APPROVED"
    case "CHANGES_REQUESTED":
      return "CHANGES_REQUESTED"
    case "COMMENTED":
      return "COMMENTED"
    case "DISMISSED":
      return "DISMISSED"
    case "PENDING":
      return "PENDING"
    default:
      return "UNKNOWN"
  }
}

async function getRawPullRequestReviews(
  projectPath: string,
  pullRequestNumber: number,
  pullRequestUrl: string | null | undefined
): Promise<RawPullRequestReview[]> {
  const repository = parseOwnerAndRepoFromPullRequestUrl(pullRequestUrl)
  if (!repository) {
    console.warn("[git] getRawPullRequestReviews:error", {
      projectPath,
      pullRequestNumber,
      error: "Unable to determine repository owner/name for pull request reviews.",
    })
    return []
  }

  try {
    const output = await runGhCommand(projectPath, [
      "api",
      "graphql",
      "-f",
      "query=query($owner:String!,$repo:String!,$number:Int!){ repository(owner:$owner,name:$repo){ pullRequest(number:$number){ reviews(first:100){ nodes { id state body submittedAt authorAssociation commit { oid } author { login avatarUrl } } } } } }",
      "-F",
      `owner=${repository.owner}`,
      "-F",
      `repo=${repository.repo}`,
      "-F",
      `number=${pullRequestNumber}`,
    ])

    if (!output.trim()) {
      return []
    }

    const parsed = JSON.parse(output) as {
      data?: {
        repository?: {
          pullRequest?: {
            reviews?: {
              nodes?: RawPullRequestReview[] | null
            } | null
          } | null
        } | null
      } | null
    }
    return parsed.data?.repository?.pullRequest?.reviews?.nodes ?? []
  } catch (error) {
    console.warn("[git] getRawPullRequestReviews:error", {
      projectPath,
      pullRequestNumber,
      error: formatGhError(error, "Unable to load pull request reviews from GitHub."),
    })
    return []
  }
}

async function getRawPullRequestComments(
  projectPath: string,
  pullRequestNumber: number,
  pullRequestUrl: string | null | undefined
): Promise<RawPullRequestComment[]> {
  const repository = parseOwnerAndRepoFromPullRequestUrl(pullRequestUrl)
  if (!repository) {
    console.warn("[git] getRawPullRequestComments:error", {
      projectPath,
      pullRequestNumber,
      error: "Unable to determine repository owner/name for pull request comments.",
    })
    return []
  }

  try {
    const output = await runGhCommand(projectPath, [
      "api",
      "graphql",
      "-f",
      "query=query($owner:String!,$repo:String!,$number:Int!){ repository(owner:$owner,name:$repo){ pullRequest(number:$number){ comments(first:100){ nodes { id body createdAt url authorAssociation author { login avatarUrl } } } } } }",
      "-F",
      `owner=${repository.owner}`,
      "-F",
      `repo=${repository.repo}`,
      "-F",
      `number=${pullRequestNumber}`,
    ])

    if (!output.trim()) {
      return []
    }

    const parsed = JSON.parse(output) as {
      data?: {
        repository?: {
          pullRequest?: {
            comments?: {
              nodes?: RawPullRequestComment[] | null
            } | null
          } | null
        } | null
      } | null
    }
    return parsed.data?.repository?.pullRequest?.comments?.nodes ?? []
  } catch (error) {
    console.warn("[git] getRawPullRequestComments:error", {
      projectPath,
      pullRequestNumber,
      error: formatGhError(error, "Unable to load pull request comments from GitHub."),
    })
    return []
  }
}

function parseOwnerAndRepoFromPullRequestUrl(
  value: string | null | undefined
): { owner: string; repo: string } | null {
  if (!value) {
    return null
  }

  try {
    const parsed = new URL(value)
    const [owner, repo] = parsed.pathname.split("/").filter(Boolean)
    if (!owner || !repo) {
      return null
    }

    return { owner, repo }
  } catch {
    return null
  }
}

async function getRawPullRequestReviewComments(
  projectPath: string,
  pullRequestNumber: number,
  pullRequestUrl: string | null | undefined
): Promise<GitPullRequestReviewComment[]> {
  const repository = parseOwnerAndRepoFromPullRequestUrl(pullRequestUrl)
  if (!repository) {
    console.warn("[git] getRawPullRequestReviewComments:error", {
      projectPath,
      pullRequestNumber,
      error: "Unable to determine repository owner/name for pull request review threads.",
    })
    return []
  }

  try {
    const output = await runGhCommand(projectPath, [
      "api",
      "graphql",
      "-f",
      "query=query($owner:String!,$repo:String!,$number:Int!){ repository(owner:$owner,name:$repo){ pullRequest(number:$number){ reviewThreads(first:100){ nodes { id isResolved isOutdated comments(first:50){ nodes { id body path state publishedAt createdAt url diffHunk originalLine originalStartLine line startLine replyTo { id } author { login avatarUrl } } } } } } } }",
      "-F",
      `owner=${repository.owner}`,
      "-F",
      `repo=${repository.repo}`,
      "-F",
      `number=${pullRequestNumber}`,
    ])

    if (!output.trim()) {
      return []
    }

    const parsed = JSON.parse(output) as {
      data?: {
        repository?: {
          pullRequest?: {
            reviewThreads?: {
              nodes?: RawPullRequestReviewThread[] | null
            } | null
          } | null
        } | null
      } | null
    }

    return (
      parsed.data?.repository?.pullRequest?.reviewThreads?.nodes?.flatMap((thread) => {
        const threadId = thread.id?.trim()
        if (!threadId) {
          return []
        }

        return (thread.comments?.nodes ?? []).map((comment) => ({
          id:
            comment.id?.trim() ||
            `${threadId}:${comment.author?.login?.trim() || "unknown"}:${comment.createdAt ?? "unknown"}`,
          threadId,
          authorLogin: comment.author?.login?.trim() || "unknown",
          authorAvatarUrl: comment.author?.avatarUrl?.trim() || null,
          body: comment.body?.trim() || null,
          path: comment.path?.trim() || null,
          state: comment.state?.trim() || null,
          createdAt: comment.createdAt ?? null,
          publishedAt: comment.publishedAt ?? null,
          url: comment.url?.trim() || null,
          diffHunk: comment.diffHunk?.trim() || null,
          line: typeof comment.line === "number" ? comment.line : null,
          startLine: typeof comment.startLine === "number" ? comment.startLine : null,
          originalLine: typeof comment.originalLine === "number" ? comment.originalLine : null,
          originalStartLine:
            typeof comment.originalStartLine === "number" ? comment.originalStartLine : null,
          isResolved: thread.isResolved === true,
          isOutdated: thread.isOutdated === true,
          replyToId: comment.replyTo?.id?.trim() || null,
        }))
      }) ?? []
    )
  } catch (error) {
    console.warn("[git] getRawPullRequestReviewComments:error", {
      projectPath,
      pullRequestNumber,
      error: formatGhError(error, "Unable to load pull request review comments from GitHub."),
    })
    return []
  }
}

function mapPullRequestReview(rawReview: RawPullRequestReview): GitPullRequestReview {
  const authorLogin = rawReview.author?.login?.trim() || "unknown"
  const submittedAt = rawReview.submittedAt ?? null
  const commitOid = rawReview.commit?.oid?.trim() || null
  const state = normalizePullRequestReviewState(rawReview.state)

  return {
    id: rawReview.id?.trim() || `${authorLogin}:${submittedAt ?? "unknown"}:${state}:${commitOid ?? ""}`,
    authorLogin,
    authorAvatarUrl: rawReview.author?.avatarUrl?.trim() || null,
    authorAssociation: rawReview.authorAssociation?.trim() || null,
    body: rawReview.body?.trim() || null,
    state,
    submittedAt,
    commitOid,
  }
}

function mapPullRequestComment(rawComment: RawPullRequestComment): GitPullRequestComment {
  const authorLogin = rawComment.author?.login?.trim() || "unknown"
  const createdAt = rawComment.createdAt ?? null

  return {
    id: rawComment.id?.trim() || `${authorLogin}:${createdAt ?? "unknown"}:${rawComment.url ?? ""}`,
    authorLogin,
    authorAvatarUrl: rawComment.author?.avatarUrl?.trim() || null,
    authorAssociation: rawComment.authorAssociation?.trim() || null,
    body: rawComment.body?.trim() || null,
    createdAt,
    url: rawComment.url?.trim() || null,
  }
}

export function normalizePullRequestCheckStatus(
  bucket: string | null | undefined
): GitPullRequestCheck["status"] {
  switch (bucket) {
    case "fail":
      return "failed"
    case "cancel":
      return "cancelled"
    case "pending":
      return "pending"
    case "pass":
      return "passed"
    case "skipping":
      return "skipped"
    default:
      return "pending"
  }
}

export function parseGitHubActionsCheckTarget(
  detailsUrl: string | null | undefined
): GitHubActionsCheckTarget | null {
  if (!detailsUrl) {
    return null
  }

  const match = detailsUrl.match(/\/(?:actions\/runs|runs)\/(\d+)(?:\/job\/(\d+))?/)
  if (!match) {
    return null
  }

  return {
    runId: match[1],
    ...(match[2] ? { jobId: match[2] } : {}),
  }
}

function stripAnsi(input: string): string {
  return input.replace(/\u001B\[[0-9;]*[A-Za-z]/g, "")
}

export function trimPullRequestFailureOutput(output: string, maxLength = 12000): string {
  const cleaned = stripAnsi(output).trim()
  if (cleaned.length <= maxLength) {
    return cleaned
  }

  const ellipsis = "\n\n...[truncated]..."
  return `${cleaned.slice(0, maxLength - ellipsis.length)}${ellipsis}`.trim()
}

async function getPullRequestCheckFailureOutput(
  projectPath: string,
  detailsUrl: string | null | undefined
): Promise<string | null> {
  const target = parseGitHubActionsCheckTarget(detailsUrl)
  if (!target) {
    return null
  }

  try {
    const args = target.jobId
      ? ["run", "view", "--job", target.jobId, "--log-failed"]
      : ["run", "view", target.runId, "--log-failed"]
    const output = await runGhCommandWithAllowedExitCodes(projectPath, args, [1])
    const trimmed = trimPullRequestFailureOutput(output)
    return trimmed || null
  } catch (error) {
    console.debug("[git] getPullRequestCheckFailureOutput:error", {
      projectPath,
      detailsUrl,
      error,
    })
    return null
  }
}

async function mapPullRequestCheck(
  projectPath: string,
  rawCheck: RawPullRequestCheck
): Promise<GitPullRequestCheck> {
  const status = normalizePullRequestCheckStatus(rawCheck.bucket)
  const detailsUrl = rawCheck.link?.trim() || null
  const errorText =
    status === "failed"
      ? await getPullRequestCheckFailureOutput(projectPath, detailsUrl)
      : null
  const normalizedName = rawCheck.name?.trim() || "Unnamed check"

  return {
    id: `${normalizedName}:${rawCheck.workflow?.trim() || ""}:${detailsUrl || rawCheck.state || ""}`,
    name: normalizedName,
    workflowName: rawCheck.workflow?.trim() || null,
    description: rawCheck.description?.trim() || null,
    event: rawCheck.event?.trim() || null,
    status,
    startedAt: rawCheck.startedAt ?? null,
    completedAt: rawCheck.completedAt ?? null,
    detailsUrl,
    ...(errorText
      ? {
          errorText,
          errorCopyText: errorText,
        }
      : {}),
    hasFailureDetails: Boolean(errorText),
  }
}

async function getPullRequestDetails(
  projectPath: string,
  identifier: string
): Promise<RawPullRequest | null> {
  try {
    const output = await runGhCommand(projectPath, [
      "pr",
      "view",
      identifier,
      "--json",
      "number,title,body,url,state,baseRefName,headRefName,mergeable,mergeStateStatus,mergedAt",
    ])

    return JSON.parse(output) as RawPullRequest
  } catch {
    return null
  }
}

async function hydratePullRequest(projectPath: string, rawPullRequest: RawPullRequest): Promise<GitPullRequest> {
  const state = normalizePullRequestState(rawPullRequest.state)
  const checksResult =
    state === "open"
      ? await getRawPullRequestChecks(projectPath, rawPullRequest.number, { requiredOnly: true })
      : { checks: [], error: null }
  return mapPullRequest(rawPullRequest, checksResult.checks, {
    checksError: checksResult.error,
  })
}

async function getPullRequestForBranch(
  projectPath: string,
  branchName: string,
  options?: {
    includeMerged?: boolean
  }
): Promise<GitPullRequest | null> {
  const includeMerged = options?.includeMerged ?? true
  const upstreamBranch = await getCurrentUpstreamBranch(projectPath)
  const remoteName = getRemoteNameFromBranchRef(upstreamBranch)
  const qualifiedHeadRef = await resolvePullRequestHeadRef(projectPath, branchName, remoteName)
  const candidateHeads = Array.from(new Set([branchName, qualifiedHeadRef]))
  const prListFields =
    "number,title,body,url,state,baseRefName,headRefName,mergeable,mergeStateStatus,mergedAt"

  logGitDebug("[git] getPullRequestForBranch:start", {
    projectPath,
    branchName,
    includeMerged,
    upstreamBranch,
    remoteName,
    qualifiedHeadRef,
    candidateHeads,
  })

  for (const headRef of candidateHeads) {
    try {
      logGitDebug("[git] getPullRequestForBranch:list-open", {
        projectPath,
        branchName,
        headRef,
      })
      const parsed = await queryPullRequests(projectPath, [
        "pr",
        "list",
        "--head",
        headRef,
        "--state",
        "open",
        "--limit",
        "1",
        "--json",
        prListFields,
      ])

      if (parsed.length > 0) {
        const hydrated = await hydratePullRequest(projectPath, parsed[0])
        logGitDebug("[git] getPullRequestForBranch:found-open", {
          projectPath,
          branchName,
          headRef,
          pullRequest: hydrated,
        })
        return hydrated
      }
    } catch (error) {
      logGitDebug("[git] getPullRequestForBranch:list-open:error", {
        projectPath,
        branchName,
        headRef,
        error,
      })
    }
  }

  if (includeMerged) {
    for (const headRef of candidateHeads) {
      try {
        logGitDebug("[git] getPullRequestForBranch:list-merged", {
          projectPath,
          branchName,
          headRef,
        })
        const parsed = await queryPullRequests(projectPath, [
          "pr",
          "list",
          "--head",
          headRef,
          "--state",
          "merged",
          "--limit",
          "1",
          "--json",
          prListFields,
        ])

        if (parsed.length > 0) {
          const hydrated = await hydratePullRequest(projectPath, parsed[0])
          logGitDebug("[git] getPullRequestForBranch:found-merged", {
            projectPath,
            branchName,
            headRef,
            pullRequest: hydrated,
          })
          return hydrated
        }
      } catch (error) {
        logGitDebug("[git] getPullRequestForBranch:list-merged:error", {
          projectPath,
          branchName,
          headRef,
          error,
        })
      }
    }
  }

  const viewedPullRequest = await getPullRequestDetails(projectPath, branchName)
  if (!viewedPullRequest) {
    logGitDebug("[git] getPullRequestForBranch:not-found", {
      projectPath,
      branchName,
    })
    return null
  }

  const state = normalizePullRequestState(viewedPullRequest.state)
  if (state === "closed") {
    logGitDebug("[git] getPullRequestForBranch:closed", {
      projectPath,
      branchName,
      viewedPullRequest,
    })
    return null
  }

  if (state === "merged" && !includeMerged) {
    logGitDebug("[git] getPullRequestForBranch:merged-skipped", {
      projectPath,
      branchName,
      viewedPullRequest,
    })
    return null
  }

  const hydrated = await hydratePullRequest(projectPath, viewedPullRequest)
  logGitDebug("[git] getPullRequestForBranch:view-fallback", {
    projectPath,
    branchName,
    pullRequest: hydrated,
  })
  return hydrated
}

async function getGitBranchesResponse(projectPath: string): Promise<GitBranchesResponse> {
  const trimmedPath = ensureGitProjectPath(projectPath)
  try {
    await runGitCommand(trimmedPath, ["rev-parse", "--show-toplevel"])
  } catch (error) {
    if (isMissingGitError(error)) {
      return createGitStatusResponse({
        isGitAvailable: false,
        isRepo: false,
      })
    }

    if (isNotGitRepositoryError(error)) {
      return createGitStatusResponse({
        isGitAvailable: true,
        isRepo: false,
      })
    }

    throw error
  }

  let currentBranch = await runGitCommand(trimmedPath, ["branch", "--show-current"])
  let isDetached = false
  if (!currentBranch) {
    const commit = await runGitCommand(trimmedPath, ["rev-parse", "--short", "HEAD"])
    currentBranch = `detached@${commit}`
    isDetached = true
  }

  const upstreamBranch = await getCurrentUpstreamBranch(trimmedPath)

  const branches = await listLocalAndRemoteBranches(trimmedPath)
  const remoteNames = await listRemoteNames(trimmedPath)
  const defaultBranch = await resolveDefaultBranch(trimmedPath, branches)
  const { aheadCount, behindCount } = await getAheadBehind(trimmedPath)
  const originRemote = await hasOriginRemote(trimmedPath)
  const openPullRequest = isDetached ? null : await getPullRequestForBranch(trimmedPath, currentBranch)

  return {
    isGitAvailable: true,
    isRepo: true,
    currentBranch,
    upstreamBranch,
    branches,
    remoteNames,
    workingTreeSummary: await getWorkingTreeSummary(trimmedPath),
    aheadCount,
    behindCount,
    hasOriginRemote: originRemote,
    hasUpstream: upstreamBranch !== null,
    defaultBranch,
    isDefaultBranch: !isDetached && defaultBranch !== null && currentBranch === defaultBranch,
    isDetached,
    openPullRequest,
  }
}

export async function resolveGitDirectory(projectPath: string): Promise<string> {
  const trimmedPath = ensureGitProjectPath(projectPath)
  await runGitCommand(trimmedPath, ["rev-parse", "--show-toplevel"])
  return runGitCommand(trimmedPath, ["rev-parse", "--absolute-git-dir"])
}

function parseCommitMessage(input: string | undefined): CommitSuggestion | null {
  const trimmed = input?.trim()
  if (!trimmed) {
    return null
  }

  const lines = trimmed.split(/\r?\n/)
  const subject = sanitizeCommitSubject(lines[0] ?? "")
  const body = lines.slice(1).join("\n").trim()

  if (!subject) {
    return null
  }

  return { subject, body }
}

function sanitizeCommitSubject(subject: string): string {
  return subject.replace(/\s+/g, " ").trim().replace(/\.$/, "").slice(0, 72).trim()
}

function sanitizeBranchName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 48)
}

function normalizeStructuredBranchName(value: string): string {
  return value
    .trim()
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "")
}

function appendStructuredBranchSuffix(branchName: string, suffix: number | string): string {
  const segments = normalizeStructuredBranchName(branchName)
    .split("/")
    .filter(Boolean)

  const leaf = segments.pop() ?? "update-changes"
  return [...segments, `${leaf}-${suffix}`].join("/")
}

function ensureUniqueBranchName(
  base: string,
  existingBranches: string[],
  options?: { sanitize?: boolean }
): string {
  const shouldSanitize = options?.sanitize ?? true
  const normalizedBase =
    (shouldSanitize ? sanitizeBranchName(base) : normalizeStructuredBranchName(base)) ||
    "update-changes"
  const existing = new Set(existingBranches)

  if (!existing.has(normalizedBase)) {
    return normalizedBase
  }

  for (let attempt = 2; attempt < 100; attempt += 1) {
    const candidate = shouldSanitize
      ? `${normalizedBase}-${attempt}`
      : appendStructuredBranchSuffix(normalizedBase, attempt)
    if (!existing.has(candidate)) {
      return candidate
    }
  }

  return shouldSanitize
    ? `${normalizedBase}-${Date.now().toString(36)}`
    : appendStructuredBranchSuffix(normalizedBase, Date.now().toString(36))
}

async function prepareCommitContext(
  projectPath: string,
  filePaths?: string[]
): Promise<{ stagedSummary: string; stagedPatch: string } | null> {
  const commitTarget = await resolveCommitTarget(projectPath, filePaths)
  const tempDir = await mkdtemp(path.join(tmpdir(), "vfactor-git-index-"))
  const env = {
    ...process.env,
    GIT_INDEX_FILE: path.join(tempDir, "index"),
  }

  try {
    if (await gitHeadExists(commitTarget.repoRoot)) {
      await runGitCommand(commitTarget.repoRoot, ["read-tree", "HEAD"], env)
    }

    await runGitCommand(
      commitTarget.repoRoot,
      withCommitPathspec(["add", "-A"], commitTarget.pathspecs),
      env
    )

    const stagedSummary = (
      await runGitCommand(
        commitTarget.repoRoot,
        withCommitPathspec(["diff", "--cached", "--name-status"], commitTarget.pathspecs),
        env
      )
    ).trim()

    if (!stagedSummary) {
      return null
    }

    const stagedPatch = await runGitCommandRaw(
      commitTarget.repoRoot,
      withCommitPathspec(["diff", "--cached", "--patch", "--minimal"], commitTarget.pathspecs),
      env
    )

    return {
      stagedSummary,
      stagedPatch,
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function resolveCommitTarget(
  projectPath: string,
  filePaths?: string[]
): Promise<CommitTarget> {
  const { repoRoot, scopePath } = await getRepoContext(projectPath)
  const repoRelativePaths = (filePaths ?? []).map((filePath) => toRepoRelativePath(filePath, scopePath))

  if (repoRelativePaths.length > 0) {
    return {
      repoRoot,
      pathspecs: repoRelativePaths,
    }
  }

  return {
    repoRoot,
    pathspecs: scopePath ? [scopePath] : null,
  }
}

function withCommitPathspec(args: string[], pathspecs: string[] | null): string[] {
  if (!pathspecs || pathspecs.length === 0) {
    return args
  }

  return withSpecificPathspecs(args, pathspecs)
}

function buildCommitPrompt(input: {
  branch: string | null
  stagedSummary: string
  stagedPatch: string
  includeBranch: boolean
}): string {
  return [
    "You write concise git commit messages.",
    input.includeBranch
      ? 'Return JSON with keys: "subject", "body", "branch".'
      : 'Return JSON with keys: "subject", "body".',
    "Rules:",
    "- subject must be imperative and at most 72 characters",
    "- subject must not end with a period",
    "- body can be an empty string or a few short bullet points",
    ...(input.includeBranch
      ? ["- branch must be a short semantic branch name fragment for the change"]
      : []),
    "",
    `Branch: ${input.branch ?? "(detached)"}`,
    "",
    "Staged files:",
    input.stagedSummary.slice(0, 6000),
    "",
    "Staged patch:",
    input.stagedPatch.slice(0, 40000),
  ].join("\n")
}

function buildPrPrompt(input: {
  baseBranch: string
  headBranch: string
  commitSummary: string
  diffSummary: string
  diffPatch: string
}): string {
  return [
    "You write GitHub pull request content.",
    'Return JSON with keys: "title", "body".',
    "Rules:",
    "- title should be concise and specific",
    "- body must be markdown and include headings '## Summary' and '## Testing'",
    "- under Summary, use short bullet points",
    "- under Testing, include concrete checks or 'Not run'",
    "",
    `Base branch: ${input.baseBranch}`,
    `Head branch: ${input.headBranch}`,
    "",
    "Commits:",
    input.commitSummary.slice(0, 12000),
    "",
    "Diff stat:",
    input.diffSummary.slice(0, 12000),
    "",
    "Diff patch:",
    input.diffPatch.slice(0, 40000),
  ].join("\n")
}

function normalizeCodexModel(model: string | null | undefined): string | null {
  const trimmed = model?.trim()
  return trimmed ? trimmed : null
}

async function runCodexJson<T>(
  projectPath: string,
  prompt: string,
  schema: Record<string, unknown>,
  model?: string | null
): Promise<T> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "vfactor-git-"))
  const schemaPath = path.join(tempDir, "schema.json")
  const outputPath = path.join(tempDir, "output.json")

  try {
    await writeFile(schemaPath, JSON.stringify(schema), "utf8")
    await writeFile(outputPath, "", "utf8")

    const normalizedModel = normalizeCodexModel(model)
    await runCommandWithInput(
      "codex",
      [
        "exec",
        "--ephemeral",
        "-s",
        "read-only",
        "--config",
        `model_reasoning_effort="${CODEX_REASONING_EFFORT}"`,
        ...(normalizedModel ? ["--model", normalizedModel] : []),
        "--output-schema",
        schemaPath,
        "--output-last-message",
        outputPath,
        "-",
      ],
      {
        cwd: projectPath,
        input: prompt,
        env: process.env,
      }
    )

    const raw = await readFile(outputPath, "utf8")
    return JSON.parse(raw) as T
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Failed to generate git text with Codex: ${error.message}`
        : "Failed to generate git text with Codex."
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function resolveCommitSuggestion(input: {
  projectPath: string
  currentBranch: string | null
  commitMessage?: string
  includeBranch?: boolean
  filePaths?: string[]
  generationModel?: string | null
}): Promise<(CommitSuggestion & { commitMessage: string }) | null> {
  const context = await prepareCommitContext(input.projectPath, input.filePaths)
  if (!context) {
    return null
  }

  const custom = parseCommitMessage(input.commitMessage)
  if (custom) {
    return {
      ...custom,
      ...(input.includeBranch ? { branch: sanitizeBranchName(custom.subject) } : {}),
      commitMessage: [custom.subject, custom.body].filter(Boolean).join("\n\n"),
    }
  }

  const generated = await runCodexJson<{
    subject: string
    body: string
    branch?: string
  }>(
    input.projectPath,
    buildCommitPrompt({
      branch: input.currentBranch,
      stagedSummary: context.stagedSummary,
      stagedPatch: context.stagedPatch,
      includeBranch: input.includeBranch === true,
    }),
    input.includeBranch
      ? {
          type: "object",
          additionalProperties: false,
          required: ["subject", "body", "branch"],
          properties: {
            subject: { type: "string" },
            body: { type: "string" },
            branch: { type: "string" },
          },
        }
      : {
          type: "object",
          additionalProperties: false,
          required: ["subject", "body"],
          properties: {
            subject: { type: "string" },
            body: { type: "string" },
          },
        },
    input.generationModel
  )

  const subject = sanitizeCommitSubject(generated.subject)
  if (!subject) {
    throw new Error("Codex returned an empty commit subject.")
  }

  const body = generated.body?.trim() ?? ""
  return {
    subject,
    body,
    ...(input.includeBranch
      ? { branch: sanitizeBranchName(generated.branch ?? generated.subject) || "update-changes" }
      : {}),
    commitMessage: [subject, body].filter(Boolean).join("\n\n"),
  }
}

async function createAndCheckoutFeatureBranch(
  projectPath: string,
  suggestion: CommitSuggestion | null,
  currentBranch: string | null
): Promise<string> {
  const existingBranches = await listLocalBranchNames(projectPath)
  const preferred =
    suggestion?.branch ??
    (suggestion ? sanitizeBranchName(suggestion.subject) : sanitizeBranchName(`${currentBranch ?? ""}-update`)) ??
    "update-changes"
  const branchName = ensureUniqueBranchName(preferred, existingBranches)

  await runGitCommand(projectPath, ["switch", "-c", branchName])
  return branchName
}

async function commitChanges(
  projectPath: string,
  subject: string,
  body: string,
  filePaths?: string[]
): Promise<{ commitSha: string }> {
  const commitTarget = await resolveCommitTarget(projectPath, filePaths)
  await runGitCommand(
    commitTarget.repoRoot,
    withCommitPathspec(["add", "-A"], commitTarget.pathspecs)
  )

  const args = ["commit", "-m", subject]
  if (body.trim()) {
    args.push("-m", body.trim())
  }

  await runGitCommand(commitTarget.repoRoot, withCommitPathspec(args, commitTarget.pathspecs))
  const commitSha = await runGitCommand(commitTarget.repoRoot, ["rev-parse", "HEAD"])
  return { commitSha }
}

async function pushCurrentBranch(
  projectPath: string,
  branchName: string,
  remoteName?: string | null
): Promise<GitRunStackedActionResult["push"]> {
  const branchData = await getGitBranchesResponse(projectPath)
  const upstreamRemote = getRemoteNameFromBranchRef(branchData.upstreamBranch)
  const upstreamBranchName = getBranchNameFromBranchRef(branchData.upstreamBranch)
  const targetRemote =
    remoteName?.trim() ||
    upstreamRemote ||
    (branchData.hasOriginRemote ? "origin" : branchData.remoteNames[0] ?? "origin")
  const tracksTargetBranch =
    branchData.hasUpstream && upstreamRemote === targetRemote && upstreamBranchName === branchName

  if (tracksTargetBranch && branchData.aheadCount === 0 && branchData.behindCount === 0) {
    return {
      status: "skipped_up_to_date",
      branch: branchName,
      upstreamBranch: branchData.upstreamBranch,
    }
  }

  if (!branchData.hasUpstream) {
    if (!branchData.remoteNames.includes(targetRemote)) {
      throw new Error(`Cannot push because this project has no "${targetRemote}" remote configured.`)
    }

    await runGitCommand(projectPath, ["push", "-u", targetRemote, `HEAD:${branchName}`])
    return {
      status: "pushed",
      branch: branchName,
      upstreamBranch: `${targetRemote}/${branchName}`,
      setUpstream: true,
    }
  }

  if (!branchData.remoteNames.includes(targetRemote)) {
    throw new Error(`Cannot push because this project has no "${targetRemote}" remote configured.`)
  }

  if (!tracksTargetBranch) {
    await runGitCommand(projectPath, ["push", "-u", targetRemote, `HEAD:${branchName}`])
    return {
      status: "pushed",
      branch: branchName,
      upstreamBranch: `${targetRemote}/${branchName}`,
      setUpstream: true,
    }
  }

  await runGitCommand(projectPath, ["push", targetRemote, `HEAD:${branchName}`])
  return {
    status: "pushed",
    branch: branchName,
    upstreamBranch: branchData.upstreamBranch,
    setUpstream: false,
  }
}

async function readRangeContext(projectPath: string, baseBranch: string): Promise<RangeContext> {
  const { repoRoot, scopePath } = await getRepoContext(projectPath)
  const range = `${baseBranch}..HEAD`

  const [commitSummary, diffSummary, diffPatch] = await Promise.all([
    runGitCommand(repoRoot, withOptionalPathspec(["log", "--oneline", range], scopePath)).catch(
      () => ""
    ),
    runGitCommand(repoRoot, withOptionalPathspec(["diff", "--stat", range], scopePath)).catch(
      () => ""
    ),
    runGitCommandRaw(
      repoRoot,
      withOptionalPathspec(["diff", "--patch", "--minimal", range], scopePath)
    ).catch(() => ""),
  ])

  return {
    commitSummary,
    diffSummary,
    diffPatch,
  }
}

async function createPullRequest(
  projectPath: string,
  branchName: string,
  generationModel?: string | null,
  remoteName?: string | null
): Promise<GitRunStackedActionResult["pr"]> {
  console.debug("[git] createPullRequest:start", {
    projectPath,
    branchName,
    remoteName,
    generationModel,
  })
  const existing = await getPullRequestForBranch(projectPath, branchName, {
    includeMerged: false,
  })
  if (shouldReuseExistingPullRequest(existing)) {
    console.debug("[git] createPullRequest:existing", {
      projectPath,
      branchName,
      existing,
    })
    return {
      status: "opened_existing",
      url: existing.url,
      number: existing.number,
      title: existing.title,
      baseBranch: existing.baseBranch,
      headBranch: existing.headBranch,
    }
  }

  const branchData = await getGitBranchesResponse(projectPath)
  const baseBranch = branchData.defaultBranch
  if (!baseBranch) {
    throw new Error("Unable to determine the default branch for this project.")
  }

  const resolvedRemoteName =
    getRemoteNameFromBranchRef(branchData.upstreamBranch) ??
    remoteName?.trim() ??
    (branchData.hasOriginRemote ? "origin" : branchData.remoteNames[0] ?? null)
  await ensureRemoteBranchExists(projectPath, branchName, resolvedRemoteName)
  const headRef = await resolvePullRequestHeadRef(projectPath, branchName, resolvedRemoteName)
  console.debug("[git] createPullRequest:resolved-head", {
    projectPath,
    branchName,
    baseBranch,
    resolvedRemoteName,
    headRef,
  })

  const rangeContext = await readRangeContext(projectPath, baseBranch)
  const generated = await runCodexJson<{ title: string; body: string }>(
    projectPath,
    buildPrPrompt({
      baseBranch,
      headBranch: branchName,
      commitSummary: rangeContext.commitSummary,
      diffSummary: rangeContext.diffSummary,
      diffPatch: rangeContext.diffPatch,
    }),
    {
      type: "object",
      additionalProperties: false,
      required: ["title", "body"],
      properties: {
        title: { type: "string" },
        body: { type: "string" },
      },
    },
    generationModel
  )

  const createdUrl = await runGhCommand(projectPath, [
    "pr",
    "create",
    "--base",
    baseBranch,
    "--head",
    headRef,
    "--title",
    generated.title.trim(),
    "--body",
    generated.body.trim(),
  ])
  console.debug("[git] createPullRequest:created", {
    projectPath,
    branchName,
    createdUrl,
    generatedTitle: generated.title.trim(),
  })

  let created = await getPullRequestForBranch(projectPath, branchName, {
    includeMerged: false,
  })
  if (!created && createdUrl) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      console.debug("[git] createPullRequest:retry-lookup", {
        projectPath,
        branchName,
        attempt: attempt + 1,
      })
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
      created = await getPullRequestForBranch(projectPath, branchName, {
        includeMerged: false,
      })
      if (created) {
        console.debug("[git] createPullRequest:retry-lookup:found", {
          projectPath,
          branchName,
          attempt: attempt + 1,
          created,
        })
        break
      }
    }
  }

  const normalizedCreatedUrl = createdUrl.trim().split(/\s+/).find((value) => value.startsWith("http")) ?? undefined
  const createdNumber =
    created?.number ??
    (normalizedCreatedUrl
      ? Number.parseInt(normalizedCreatedUrl.replace(/\/$/, "").split("/").pop() ?? "", 10) || undefined
      : undefined)

  console.debug("[git] createPullRequest:resolved-result", {
    projectPath,
    branchName,
    normalizedCreatedUrl,
    createdNumber,
    created,
  })
  return {
    status: "created",
    ...(created
      ? {
          url: created.url,
          number: created.number,
          title: created.title,
          baseBranch: created.baseBranch,
          headBranch: created.headBranch,
        }
      : {
          ...(normalizedCreatedUrl ? { url: normalizedCreatedUrl } : {}),
          ...(createdNumber ? { number: createdNumber } : {}),
          title: generated.title.trim(),
          baseBranch,
          headBranch: branchName,
        }),
  }
}

function localBranchNameForRemote(branchName: string): string {
  return branchName.split("/").slice(1).join("/") || branchName
}

export class GitService {
  getBranches(projectPath: string): Promise<GitBranchesResponse> {
    logGitDebug("[git] getBranches", { projectPath })
    return getGitBranchesResponse(projectPath)
  }

  async getChanges(projectPath: string): Promise<GitFileChange[]> {
    const trimmedPath = ensureGitProjectPath(projectPath)
    const branchData = await getGitBranchesResponse(trimmedPath)
    if (!branchData.isGitAvailable || !branchData.isRepo) {
      return []
    }
    return getChangedFiles(trimmedPath)
  }

  async getPullRequestChecks(projectPath: string): Promise<GitPullRequestChecksResponse> {
    const trimmedPath = ensureGitProjectPath(projectPath)
    const branchData = await getGitBranchesResponse(trimmedPath)
    const pullRequest = branchData.openPullRequest

    if (!pullRequest || pullRequest.state !== "open") {
      return {
        checks: [],
        reviews: [],
        comments: [],
        reviewComments: [],
        pullRequestNumber: null,
        error: null,
      }
    }

    const [rawChecks, rawReviews, rawComments, reviewComments] = await Promise.all([
      getRawPullRequestChecks(trimmedPath, pullRequest.number),
      getRawPullRequestReviews(trimmedPath, pullRequest.number, pullRequest.url),
      getRawPullRequestComments(trimmedPath, pullRequest.number, pullRequest.url),
      getRawPullRequestReviewComments(trimmedPath, pullRequest.number, pullRequest.url),
    ])
    const checks = await Promise.all(
      rawChecks.checks.map((rawCheck) => mapPullRequestCheck(trimmedPath, rawCheck))
    )
    const reviews = rawReviews.map((rawReview) => mapPullRequestReview(rawReview))
    const comments = rawComments.map((rawComment) => mapPullRequestComment(rawComment))

    return {
      checks,
      reviews,
      comments,
      reviewComments,
      pullRequestNumber: pullRequest.number,
      error: rawChecks.error,
    }
  }

  async listWorktrees(projectPath: string): Promise<GitWorktreeSummary[]> {
    return listGitWorktrees(projectPath)
  }

  async initRepo(projectPath: string): Promise<GitBranchesResponse> {
    const trimmedPath = ensureGitProjectPath(projectPath)
    await runGitCommand(trimmedPath, ["init"])
    return getGitBranchesResponse(trimmedPath)
  }

  async createWorktree(
    projectPath: string,
    input: GitCreateWorktreeInput
  ): Promise<GitCreateWorktreeResult> {
    const trimmedPath = ensureGitProjectPath(projectPath)
    const repoRoot = await runGitCommand(trimmedPath, ["rev-parse", "--show-toplevel"])
    const requestedBranchName = input.branchName.trim()
    const baseBranch = input.baseBranch.trim()
    const remoteName = input.remoteName?.trim() || null
    const requestedTargetPath = input.targetPath?.trim() || null

    if (!input.name.trim()) {
      throw new Error("Worktree name is required.")
    }
    if (!requestedBranchName) {
      throw new Error("Worktree branch name is required.")
    }
    if (!baseBranch) {
      throw new Error("A base branch is required to create a worktree.")
    }

    console.debug("[git] createWorktree:start", {
      projectPath: trimmedPath,
      repoRoot,
      requestedBranchName,
      baseBranch,
      remoteName,
      requestedTargetPath,
      requestedName: input.name.trim(),
    })

    await runGitCommand(trimmedPath, ["check-ref-format", "--branch", requestedBranchName])
    const existingBranches = await listLocalBranchNames(repoRoot)
    const branchName = ensureUniqueBranchName(requestedBranchName, existingBranches, {
      sanitize: false,
    })
    const { remoteName: resolvedRemoteName, remoteRef: baseRef } = await resolveWorktreeBaseRef(
      repoRoot,
      baseBranch,
      remoteName
    )
    const requestedDefaultPath = resolveDefaultManagedWorktreePath(repoRoot, requestedBranchName)
    const worktreePath =
      !requestedTargetPath || path.resolve(requestedTargetPath) === path.resolve(requestedDefaultPath)
        ? resolveDefaultManagedWorktreePath(repoRoot, branchName)
        : requestedTargetPath
    console.debug("[git] createWorktree:resolved-input", {
      projectPath: trimmedPath,
      repoRoot,
      requestedBranchName,
      finalBranchName: branchName,
      baseBranch,
      baseRef,
      remoteName: resolvedRemoteName,
      requestedTargetPath,
      finalWorktreePath: worktreePath,
      requestedName: input.name.trim(),
    })
    await mkdir(path.dirname(worktreePath), { recursive: true })
    await runGitCommand(repoRoot, ["worktree", "add", "-b", branchName, worktreePath, baseRef])

    const createdWorktree =
      (await listGitWorktrees(worktreePath)).find(
        (worktree) => worktree.path === realpathSync(worktreePath)
      ) ?? {
        path: realpathSync(worktreePath),
        branchName,
        head: null,
        isDetached: false,
        isCurrent: false,
        isMain: false,
      }

    capture("worktree_created", {
      used_default_base_branch: baseBranch === "main",
      used_custom_path: Boolean(requestedTargetPath),
    })
    console.debug("[git] createWorktree:success", {
      projectPath: trimmedPath,
      repoRoot,
      baseBranch,
      baseRef,
      remoteName: resolvedRemoteName,
      createdBranchName: createdWorktree.branchName,
      createdWorktreePath: createdWorktree.path,
      requestedTargetPath,
      finalWorktreePath: worktreePath,
    })
    return {
      worktree: createdWorktree,
    }
  }

  async removeWorktree(
    projectPath: string,
    input: GitRemoveWorktreeInput
  ): Promise<GitRemoveWorktreeResult> {
    const trimmedPath = ensureGitProjectPath(projectPath)
    const repoRoot = await runGitCommand(trimmedPath, ["rev-parse", "--show-toplevel"])
    const worktreePath = ensureGitProjectPath(input.worktreePath)
    const resolvedWorktreePath = realpathSync(worktreePath)

    if (resolvedWorktreePath === realpathSync(repoRoot)) {
      throw new Error("The root worktree cannot be removed.")
    }

    await assertWorktreeIsClean(resolvedWorktreePath)
    await runGitCommand(repoRoot, ["worktree", "remove", resolvedWorktreePath])

    capture("worktree_removed")
    return {
      worktreePath: resolvedWorktreePath,
    }
  }

  async renameWorktree(
    projectPath: string,
    input: GitRenameWorktreeInput
  ): Promise<GitRenameWorktreeResult> {
    const trimmedPath = ensureGitProjectPath(projectPath)
    const repoRoot = await runGitCommand(trimmedPath, ["rev-parse", "--show-toplevel"])
    const resolvedRepoRoot = realpathSync(repoRoot)
    const worktreePath = ensureGitProjectPath(input.worktreePath)
    const resolvedWorktreePath = realpathSync(worktreePath)
    const nextBranchName = input.branchName.trim()
    const targetPath = input.targetPath?.trim() || null

    if (resolvedWorktreePath === resolvedRepoRoot) {
      throw new Error("The root worktree cannot be renamed.")
    }

    if (!nextBranchName) {
      throw new Error("A renamed worktree must have a branch name.")
    }

    await assertWorktreeIsClean(resolvedWorktreePath)
    await runGitCommand(trimmedPath, ["check-ref-format", "--branch", nextBranchName])

    const currentBranchName = await runGitCommand(resolvedWorktreePath, ["branch", "--show-current"])
    if (!currentBranchName) {
      throw new Error("Only branch-based worktrees can be renamed.")
    }

    const existingBranches = await listLocalBranchNames(repoRoot)
    const finalBranchName =
      currentBranchName === nextBranchName
        ? currentBranchName
        : ensureUniqueBranchName(
            nextBranchName,
            existingBranches.filter((branch) => branch !== currentBranchName),
            { sanitize: false }
          )

    const normalizedTargetPath = targetPath ? path.resolve(targetPath) : resolvedWorktreePath
    const shouldMoveWorktree = normalizedTargetPath !== path.resolve(resolvedWorktreePath)

    if (shouldMoveWorktree && existsSync(normalizedTargetPath)) {
      throw new Error(`The worktree destination "${normalizedTargetPath}" already exists.`)
    }

    let resolvedTargetPath = resolvedWorktreePath

    if (shouldMoveWorktree) {
      await mkdir(path.dirname(normalizedTargetPath), { recursive: true })
      await runGitCommand(repoRoot, ["worktree", "move", resolvedWorktreePath, normalizedTargetPath])
      resolvedTargetPath = realpathSync(normalizedTargetPath)
    }

    try {
      if (currentBranchName !== finalBranchName) {
        await runGitCommand(resolvedTargetPath, ["branch", "-m", finalBranchName])
      }
    } catch (error) {
      if (shouldMoveWorktree) {
        try {
          await runGitCommand(repoRoot, ["worktree", "move", resolvedTargetPath, resolvedWorktreePath])
          resolvedTargetPath = resolvedWorktreePath
        } catch (rollbackError) {
          console.warn("[git] Failed to roll back worktree move after branch rename failure:", rollbackError)
        }
      }

      throw error
    }

    const renamedWorktree =
      (await listGitWorktrees(resolvedTargetPath)).find(
        (worktree) => worktree.path === resolvedTargetPath
      ) ?? {
        path: resolvedTargetPath,
        branchName: finalBranchName,
        head: null,
        isDetached: false,
        isCurrent: false,
        isMain: false,
      }

    return {
      worktree: renamedWorktree,
      previousBranchName: currentBranchName,
      previousPath: resolvedWorktreePath,
    }
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

  async pull(projectPath: string): Promise<GitPullResult> {
    const branchData = await getGitBranchesResponse(projectPath)
    if (branchData.isDetached) {
      throw new Error("Cannot pull from detached HEAD.")
    }
    if (!branchData.hasUpstream) {
      throw new Error("Current branch has no upstream configured. Push with upstream first.")
    }

    const beforeSha = await runGitCommand(projectPath, ["rev-parse", "HEAD"])
    await runGitCommand(projectPath, ["pull", "--ff-only"])
    const afterSha = await runGitCommand(projectPath, ["rev-parse", "HEAD"])

    return {
      status: beforeSha === afterSha ? "skipped_up_to_date" : "pulled",
      branch: branchData.currentBranch,
      upstreamBranch: branchData.upstreamBranch,
    }
  }

  async mergePullRequest(projectPath: string): Promise<GitMergePullRequestResult> {
    const trimmedPath = ensureGitProjectPath(projectPath)
    const branchData = await getGitBranchesResponse(trimmedPath)

    if (branchData.isDetached) {
      throw new Error("Cannot merge a pull request from detached HEAD.")
    }

    const pullRequest = branchData.openPullRequest
    if (!pullRequest || pullRequest.state !== "open") {
      throw new Error("No open pull request found for this branch.")
    }

    if (pullRequest.checksError) {
      throw new Error(pullRequest.checksError)
    }

    if (pullRequest.checksStatus === "pending") {
      throw new Error("Checks are still pending for this pull request.")
    }

    if (pullRequest.checksStatus === "failed") {
      throw new Error("Checks are failing for this pull request.")
    }

    if (pullRequest.mergeStatus !== "mergeable") {
      throw new Error("This pull request is not ready to merge.")
    }

    const headSha = await runGitCommand(trimmedPath, ["rev-parse", "HEAD"])
    await runGhCommand(trimmedPath, [
      "pr",
      "merge",
      String(pullRequest.number),
      "--merge",
      "--match-head-commit",
      headSha,
    ])

    capture("pull_request_merged", { pr_number: pullRequest.number })
    return {
      number: pullRequest.number,
      url: pullRequest.url,
    }
  }

  async ensureInfoExcludeEntries(projectPath: string, entries: string[]): Promise<void> {
    const trimmedPath = ensureGitProjectPath(projectPath)
    await runGitCommand(trimmedPath, ["rev-parse", "--show-toplevel"])

    const normalizedEntries = Array.from(
      new Set(
        entries
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
      )
    )

    if (normalizedEntries.length === 0) {
      return
    }

    const rawExcludePath = await runGitCommand(trimmedPath, ["rev-parse", "--git-path", "info/exclude"])
    const excludePath = path.isAbsolute(rawExcludePath)
      ? rawExcludePath
      : path.resolve(trimmedPath, rawExcludePath)
    await mkdir(path.dirname(excludePath), { recursive: true })

    let currentContents = ""

    try {
      currentContents = await readFile(excludePath, "utf8")
    } catch (error) {
      const fileError = error as NodeJS.ErrnoException
      if (fileError.code !== "ENOENT") {
        throw error
      }
    }

    const existingEntries = new Set(
      currentContents
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    )
    const missingEntries = normalizedEntries.filter((entry) => !existingEntries.has(entry))

    if (missingEntries.length === 0) {
      return
    }

    const prefix = currentContents.length > 0 && !currentContents.endsWith("\n") ? "\n" : ""
    await appendFile(excludePath, `${prefix}${missingEntries.join("\n")}\n`, "utf8")
  }

  async runStackedAction(
    projectPath: string,
    input: GitRunStackedActionInput,
    onProgress?: (event: GitActionProgressEvent) => void
  ): Promise<GitRunStackedActionResult> {
    const trimmedPath = ensureGitProjectPath(projectPath)
    const initial = await getGitBranchesResponse(trimmedPath)
    const wantsPush = input.action !== "commit"
    const wantsPr = input.action === "commit_push_pr"

    if (!input.featureBranch && initial.isDetached && wantsPush) {
      throw new Error("Cannot push from detached HEAD.")
    }

    if (!input.featureBranch && initial.isDetached && wantsPr) {
      throw new Error("Cannot create a pull request from detached HEAD.")
    }

    let branchName = initial.isDetached ? null : initial.currentBranch
    let branchResult: GitRunStackedActionResult["branch"] = {
      status: "skipped_not_requested",
    }
    let suggestion: (CommitSuggestion & { commitMessage: string }) | null = null

    let commitResult: GitRunStackedActionResult["commit"] = {
      status: "skipped_no_changes",
    }
    let pushResult: GitRunStackedActionResult["push"] = { status: "skipped_not_requested" }
    let prResult: GitRunStackedActionResult["pr"] = { status: "skipped_not_requested" }

    try {
      if (input.featureBranch) {
        onProgress?.({ step: "generating" })
        suggestion = await resolveCommitSuggestion({
          projectPath: trimmedPath,
          currentBranch: branchName,
          commitMessage: input.commitMessage,
          includeBranch: true,
          filePaths: input.filePaths,
          generationModel: input.generationModel,
        })

        if (!suggestion && input.action === "commit") {
          throw new Error("There are no changes to commit on a new branch.")
        }

        branchName = await createAndCheckoutFeatureBranch(trimmedPath, suggestion, branchName)
        branchResult = {
          status: "created",
          name: branchName,
        }
      }

      if (!branchName && wantsPush) {
        throw new Error("Cannot push without an active branch.")
      }

      if (!suggestion) {
        onProgress?.({ step: "generating" })
        suggestion = await resolveCommitSuggestion({
          projectPath: trimmedPath,
          currentBranch: branchName,
          commitMessage: input.commitMessage,
          includeBranch: false,
          filePaths: input.filePaths,
          generationModel: input.generationModel,
        })
      }

      if (suggestion) {
        onProgress?.({ step: "committing" })
        const committed = await commitChanges(
          trimmedPath,
          suggestion.subject,
          suggestion.body,
          input.filePaths
        )
        commitResult = {
          status: "created",
          commitSha: committed.commitSha,
          subject: suggestion.subject,
        }
      }

      if (wantsPush) {
        onProgress?.({ step: "pushing" })
        pushResult = await pushCurrentBranch(
          trimmedPath,
          branchName ?? initial.currentBranch,
          input.remoteName
        )
      }

      if (wantsPr) {
        onProgress?.({ step: "creating_pr" })
        prResult = await createPullRequest(
          trimmedPath,
          branchName ?? initial.currentBranch,
          input.generationModel,
          input.remoteName
        )
      }

      capture("git_stacked_action_run", {
        action: input.action,
        outcome: "success",
        branch_status: branchResult.status,
        commit_status: commitResult.status,
        push_status: pushResult.status,
        pr_status: prResult.status,
      })
      return {
        action: input.action,
        branch: branchResult,
        commit: commitResult,
        push: pushResult,
        pr: prResult,
      }
    } catch (error) {
      captureException(error, {
        context: "git_stacked_action_run",
        action: input.action,
        branch_status: branchResult.status,
        commit_status: commitResult.status,
        push_status: pushResult.status,
        pr_status: prResult.status,
      })
      capture("git_stacked_action_run", {
        action: input.action,
        outcome: "error",
        branch_status: branchResult.status,
        commit_status: commitResult.status,
        push_status: pushResult.status,
        pr_status: prResult.status,
      })
      throw error
    }
  }
}
