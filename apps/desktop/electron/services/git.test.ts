import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { appendFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { execFile } from "node:child_process"

import {
  GitService,
  mapPullRequest,
  normalizePullRequestCheckStatus,
  normalizePullRequestMergeStatus,
  normalizePullRequestResolveReason,
  parseGitHubActionsCheckTarget,
  shouldReuseExistingPullRequest,
  summarizePullRequestChecks,
  trimPullRequestFailureOutput,
} from "./git"

const execFileAsync = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
    })
    return stdout.trim()
  } catch (error) {
    const execError = error as Error & { stderr?: string }
    throw new Error(execError.stderr?.trim() || execError.message)
  }
}

async function createRepository(): Promise<string> {
  const repoDir = await mkdtemp(path.join(tmpdir(), "vfactor-git-test-"))

  await git(repoDir, ["init", "--initial-branch=main"])
  await git(repoDir, ["config", "user.name", "vFactor Test"])
  await git(repoDir, ["config", "user.email", "vfactor@example.com"])

  await writeFile(path.join(repoDir, "a.txt"), "alpha\n", "utf8")
  await writeFile(path.join(repoDir, "b.txt"), "beta\n", "utf8")
  await git(repoDir, ["add", "."])
  await git(repoDir, ["commit", "-m", "Initial commit"])

  return repoDir
}

async function createRepositoryWithOrigin(): Promise<{ repoDir: string; remoteDir: string }> {
  const repoDir = await createRepository()
  const remoteDir = await mkdtemp(path.join(tmpdir(), "vfactor-git-remote-"))

  try {
    await git(remoteDir, ["init", "--bare", "--initial-branch=main"])
    await git(repoDir, ["remote", "add", "origin", remoteDir])
    await git(repoDir, ["push", "-u", "origin", "main"])
    return { repoDir, remoteDir }
  } catch (error) {
    await rm(repoDir, { recursive: true, force: true })
    await rm(remoteDir, { recursive: true, force: true })
    throw error
  }
}

describe("GitService repository setup", () => {
  test("reports explicit non-repo status for plain folders", async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "vfactor-git-plain-folder-"))

    try {
      const service = new GitService()
      const result = await service.getBranches(projectDir)

      expect(result.isGitAvailable).toBe(true)
      expect(result.isRepo).toBe(false)
      expect(result.currentBranch).toBe("")
      expect(result.branches).toEqual([])
      expect(result.remoteNames).toEqual([])
      expect(result.openPullRequest).toBeNull()
    } finally {
      await rm(projectDir, { recursive: true, force: true })
    }
  })

  test("returns no worktrees for plain folders", async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "vfactor-git-worktree-folder-"))

    try {
      const service = new GitService()
      const result = await service.listWorktrees(projectDir)

      expect(result).toEqual([])
    } finally {
      await rm(projectDir, { recursive: true, force: true })
    }
  })

  test("initializes git for a plain folder", async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "vfactor-git-init-folder-"))

    try {
      const service = new GitService()
      const result = await service.initRepo(projectDir)

      expect(result.isGitAvailable).toBe(true)
      expect(result.isRepo).toBe(true)
      expect(result.currentBranch.length).toBeGreaterThan(0)
    } finally {
      await rm(projectDir, { recursive: true, force: true })
    }
  })
})

describe("GitService.getFileDiff", () => {
  test("does not return image file contents for diff previews", async () => {
    const repoDir = await createRepository()

    try {
      await writeFile(path.join(repoDir, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))
      await git(repoDir, ["add", "image.png"])
      await git(repoDir, ["commit", "-m", "Add image"])
      await writeFile(path.join(repoDir, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x02]))

      const service = new GitService()
      const diff = await service.getFileDiff(repoDir, "image.png")

      expect(diff.previewUnavailableReason).toBe("image")
      expect(diff.isImage).toBe(true)
      expect(diff.original).toBe("")
      expect(diff.modified).toBe("")
      expect(diff.patch).toBeNull()
    } finally {
      await rm(repoDir, { recursive: true, force: true })
    }
  })

  test("does not return oversized text file contents for diff previews", async () => {
    const repoDir = await createRepository()

    try {
      const largeOriginal = `${"a".repeat(2 * 1024 * 1024 + 1)}\n`
      const largeModified = `${"b".repeat(2 * 1024 * 1024 + 1)}\n`

      await writeFile(path.join(repoDir, "large.txt"), largeOriginal, "utf8")
      await git(repoDir, ["add", "large.txt"])
      await git(repoDir, ["commit", "-m", "Add large text"])
      await writeFile(path.join(repoDir, "large.txt"), largeModified, "utf8")

      const service = new GitService()
      const diff = await service.getFileDiff(repoDir, "large.txt")

      expect(diff.previewUnavailableReason).toBe("too_large")
      expect(diff.isTooLarge).toBe(true)
      expect(diff.original).toBe("")
      expect(diff.modified).toBe("")
      expect(diff.patch).toBeNull()
    } finally {
      await rm(repoDir, { recursive: true, force: true })
    }
  })

  test("does not return untracked non-image binary file contents for diff previews", async () => {
    const repoDir = await createRepository()

    try {
      await writeFile(path.join(repoDir, "archive.bin"), Buffer.from([0xff, 0xfe, 0xfd, 0xfc]))

      const service = new GitService()
      const diff = await service.getFileDiff(repoDir, "archive.bin")

      expect(diff.previewUnavailableReason).toBe("binary")
      expect(diff.isBinary).toBe(true)
      expect(diff.original).toBe("")
      expect(diff.modified).toBe("")
      expect(diff.patch).toBeNull()
    } finally {
      await rm(repoDir, { recursive: true, force: true })
    }
  })

  test("does not return newly added non-image binary file contents for diff previews", async () => {
    const repoDir = await createRepository()

    try {
      await writeFile(path.join(repoDir, "payload.dat"), Buffer.from([0x00, 0x01, 0x02, 0x03]))
      await git(repoDir, ["add", "payload.dat"])

      const service = new GitService()
      const diff = await service.getFileDiff(repoDir, "payload.dat")

      expect(diff.previewUnavailableReason).toBe("binary")
      expect(diff.isBinary).toBe(true)
      expect(diff.original).toBe("")
      expect(diff.modified).toBe("")
      expect(diff.patch).toBeNull()
    } finally {
      await rm(repoDir, { recursive: true, force: true })
    }
  })
})

describe("GitService.runStackedAction", () => {
  test("commits selected files with a custom message without clearing unrelated staged work", async () => {
    const repoDir = await createRepository()

    try {
      await appendFile(path.join(repoDir, "a.txt"), "selected change\n", "utf8")
      await appendFile(path.join(repoDir, "b.txt"), "keep staged\n", "utf8")
      await git(repoDir, ["add", "b.txt"])

      const service = new GitService()
      const result = await service.runStackedAction(repoDir, {
        action: "commit",
        commitMessage: "Update selected file",
        filePaths: ["a.txt"],
      })

      expect(result.commit.status).toBe("created")
      expect(result.commit.subject).toBe("Update selected file")
      expect(await git(repoDir, ["log", "-1", "--pretty=%s"])).toBe("Update selected file")
      expect(await git(repoDir, ["show", "--pretty=format:", "--name-only", "HEAD"])).toBe("a.txt")
      expect(await git(repoDir, ["diff", "--cached", "--name-only"])).toBe("b.txt")
    } finally {
      await rm(repoDir, { recursive: true, force: true })
    }
  })

  test("creates and pushes a feature branch even when there are no new changes to commit", async () => {
    const remoteDir = await mkdtemp(path.join(tmpdir(), "vfactor-git-remote-"))
    const repoDir = await createRepository()

    try {
      await git(remoteDir, ["init", "--bare", "--initial-branch=main"])
      await git(repoDir, ["remote", "add", "origin", remoteDir])
      await git(repoDir, ["push", "-u", "origin", "main"])

      await appendFile(path.join(repoDir, "a.txt"), "already committed\n", "utf8")
      await git(repoDir, ["commit", "-am", "Ahead commit"])

      const service = new GitService()
      const result = await service.runStackedAction(repoDir, {
        action: "commit_push",
        featureBranch: true,
      })

      expect(result.branch.status).toBe("created")
      expect(result.commit.status).toBe("skipped_no_changes")
      expect(result.push.status).toBe("pushed")

      const currentBranch = await git(repoDir, ["branch", "--show-current"])
      expect(currentBranch).not.toBe("main")
      expect(await git(repoDir, ["rev-parse", "HEAD"])).toBe(await git(remoteDir, ["rev-parse", currentBranch]))
    } finally {
      await rm(repoDir, { recursive: true, force: true })
      await rm(remoteDir, { recursive: true, force: true })
    }
  })

  test("repairs mismatched upstream tracking before pushing the current branch", async () => {
    const { repoDir, remoteDir } = await createRepositoryWithOrigin()

    try {
      await git(repoDir, ["switch", "-c", "feature"])
      await appendFile(path.join(repoDir, "a.txt"), "feature change\n", "utf8")
      await git(repoDir, ["commit", "-am", "Feature commit"])
      await git(repoDir, ["branch", "--set-upstream-to=origin/main", "feature"])

      const service = new GitService()
      const result = await service.runStackedAction(repoDir, {
        action: "commit_push",
      })

      expect(result.commit.status).toBe("skipped_no_changes")
      expect(result.push.status).toBe("pushed")
      expect(result.push.upstreamBranch).toBe("origin/feature")
      expect(result.push.setUpstream).toBe(true)
      expect(await git(repoDir, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])).toBe(
        "origin/feature"
      )
      expect(await git(remoteDir, ["rev-parse", "feature"])).toBe(await git(repoDir, ["rev-parse", "HEAD"]))
    } finally {
      await rm(repoDir, { recursive: true, force: true })
      await rm(remoteDir, { recursive: true, force: true })
    }
  })
})

describe("GitService worktrees", () => {
  test("creates a worktree from the fetched remote target branch state", async () => {
    const { repoDir, remoteDir } = await createRepositoryWithOrigin()
    const cloneRoot = await mkdtemp(path.join(tmpdir(), "vfactor-git-clone-"))
    const cloneDir = path.join(cloneRoot, "repo")
    const worktreeDir = path.join(repoDir, "..", ".vfactor-worktrees-test", "kolkata")

    try {
      await git(cloneRoot, ["clone", remoteDir, cloneDir])
      await git(cloneDir, ["config", "user.name", "vFactor Test"])
      await git(cloneDir, ["config", "user.email", "vfactor@example.com"])
      await mkdir(path.join(cloneDir, "remote-only"), { recursive: true })
      await writeFile(path.join(cloneDir, "remote-only", "state.txt"), "from remote\n", "utf8")
      await git(cloneDir, ["add", "."])
      await git(cloneDir, ["commit", "-m", "Remote update"])
      await git(cloneDir, ["push", "origin", "main"])

      const service = new GitService()
      const created = await service.createWorktree(repoDir, {
        name: "Kolkata",
        branchName: "kolkata",
        baseBranch: "main",
        targetPath: worktreeDir,
      })
      const resolvedWorktreeDir = await realpath(worktreeDir)

      expect(created.worktree.path).toBe(resolvedWorktreeDir)
      expect(created.worktree.branchName).toBe("kolkata")
      expect(await git(worktreeDir, ["branch", "--show-current"])).toBe("kolkata")
      expect(await readFile(path.join(worktreeDir, "remote-only", "state.txt"), "utf8")).toBe(
        "from remote\n"
      )

      await service.removeWorktree(repoDir, { worktreePath: worktreeDir })

      expect(existsSync(worktreeDir)).toBe(false)
      expect(await git(repoDir, ["branch", "--list", "kolkata"])).toContain("kolkata")
    } finally {
      await rm(repoDir, { recursive: true, force: true })
      await rm(remoteDir, { recursive: true, force: true })
      await rm(cloneRoot, { recursive: true, force: true })
      await rm(path.join(repoDir, "..", ".vfactor-worktrees-test"), { recursive: true, force: true })
    }
  })

  test("fails when the target branch only exists locally", async () => {
    const { repoDir, remoteDir } = await createRepositoryWithOrigin()
    const worktreeDir = path.join(repoDir, "..", ".vfactor-worktrees-test", "release")

    try {
      await git(repoDir, ["checkout", "-b", "release/candidate"])
      await appendFile(path.join(repoDir, "a.txt"), "local release only\n", "utf8")
      await git(repoDir, ["commit", "-am", "Local release only"])
      await git(repoDir, ["checkout", "main"])

      const service = new GitService()

      await expect(
        service.createWorktree(repoDir, {
          name: "Release",
          branchName: "release-worktree",
          baseBranch: "release/candidate",
          targetPath: worktreeDir,
        })
      ).rejects.toThrow('The target branch "release/candidate" is not available on origin')

      expect(existsSync(worktreeDir)).toBe(false)
    } finally {
      await rm(repoDir, { recursive: true, force: true })
      await rm(remoteDir, { recursive: true, force: true })
      await rm(path.join(repoDir, "..", ".vfactor-worktrees-test"), { recursive: true, force: true })
    }
  })

  test("creates and removes a managed worktree without deleting its branch", async () => {
    const { repoDir, remoteDir } = await createRepositoryWithOrigin()
    const worktreeDir = path.join(repoDir, "..", ".vfactor-worktrees-test", "kolkata")

    try {
      const service = new GitService()
      const created = await service.createWorktree(repoDir, {
        name: "Kolkata",
        branchName: "kolkata",
        baseBranch: "main",
        targetPath: worktreeDir,
      })
      const resolvedWorktreeDir = await realpath(worktreeDir)

      expect(created.worktree.path).toBe(resolvedWorktreeDir)
      expect(created.worktree.branchName).toBe("kolkata")
      expect(await git(worktreeDir, ["branch", "--show-current"])).toBe("kolkata")

      const listed = await service.listWorktrees(repoDir)
      expect(listed.some((worktree) => worktree.path === resolvedWorktreeDir)).toBe(true)

      await service.removeWorktree(repoDir, { worktreePath: worktreeDir })

      expect(existsSync(worktreeDir)).toBe(false)
      expect(await git(repoDir, ["branch", "--list", "kolkata"])).toContain("kolkata")
    } finally {
      await rm(repoDir, { recursive: true, force: true })
      await rm(remoteDir, { recursive: true, force: true })
      await rm(path.join(repoDir, "..", ".vfactor-worktrees-test"), { recursive: true, force: true })
    }
  })

  test("blocks removing a dirty worktree", async () => {
    const { repoDir, remoteDir } = await createRepositoryWithOrigin()
    const worktreeDir = path.join(repoDir, "..", ".vfactor-worktrees-test", "oslo")

    try {
      const service = new GitService()
      await service.createWorktree(repoDir, {
        name: "Oslo",
        branchName: "oslo",
        baseBranch: "main",
        targetPath: worktreeDir,
      })

      await appendFile(path.join(worktreeDir, "a.txt"), "dirty\n", "utf8")

      await expect(
        service.removeWorktree(repoDir, { worktreePath: worktreeDir })
      ).rejects.toThrow("uncommitted changes")
    } finally {
      await rm(repoDir, { recursive: true, force: true })
      await rm(remoteDir, { recursive: true, force: true })
      await rm(path.join(repoDir, "..", ".vfactor-worktrees-test"), { recursive: true, force: true })
    }
  })

  test("ignores prunable worktree entries when listing and creating worktrees", async () => {
    const { repoDir, remoteDir } = await createRepositoryWithOrigin()
    const staleWorktreeDir = path.join(repoDir, "..", ".vfactor-worktrees-test", "stale")
    const freshWorktreeDir = path.join(repoDir, "..", ".vfactor-worktrees-test", "fresh")

    try {
      const service = new GitService()
      await service.createWorktree(repoDir, {
        name: "Stale",
        branchName: "stale",
        baseBranch: "main",
        targetPath: staleWorktreeDir,
      })

      await rm(staleWorktreeDir, { recursive: true, force: true })

      const listed = await service.listWorktrees(repoDir)
      const resolvedRepoDir = await realpath(repoDir)
      expect(listed.some((worktree) => worktree.path === resolvedRepoDir)).toBe(true)
      expect(listed.some((worktree) => worktree.branchName === "stale")).toBe(false)

      const created = await service.createWorktree(repoDir, {
        name: "Fresh",
        branchName: "fresh",
        baseBranch: "main",
        targetPath: freshWorktreeDir,
      })

      expect(created.worktree.branchName).toBe("fresh")
      expect(await git(freshWorktreeDir, ["branch", "--show-current"])).toBe("fresh")
    } finally {
      await rm(repoDir, { recursive: true, force: true })
      await rm(remoteDir, { recursive: true, force: true })
      await rm(path.join(repoDir, "..", ".vfactor-worktrees-test"), { recursive: true, force: true })
    }
  })

  test("creates a unique branch when the requested worktree branch already exists", async () => {
    const { repoDir, remoteDir } = await createRepositoryWithOrigin()
    const worktreesRoot = path.join(repoDir, "..", ".vfactor-worktrees", path.basename(repoDir))

    try {
      await git(repoDir, ["branch", "hobart"])

      const service = new GitService()
      const created = await service.createWorktree(repoDir, {
        name: "Hobart",
        branchName: "hobart",
        baseBranch: "main",
      })

      expect(created.worktree.branchName).toBe("hobart-2")
      expect(created.worktree.path).toBe(await realpath(path.join(worktreesRoot, "hobart-2")))
      expect(await git(created.worktree.path, ["branch", "--show-current"])).toBe("hobart-2")
    } finally {
      await rm(repoDir, { recursive: true, force: true })
      await rm(remoteDir, { recursive: true, force: true })
      await rm(path.join(repoDir, "..", ".vfactor-worktrees"), { recursive: true, force: true })
    }
  })

  test("preserves slash-separated branch names when creating a worktree", async () => {
    const { repoDir, remoteDir } = await createRepositoryWithOrigin()
    const worktreeDir = path.join(repoDir, "..", ".vfactor-worktrees-test", "feature-foo")

    try {
      const service = new GitService()
      const created = await service.createWorktree(repoDir, {
        name: "Feature foo",
        branchName: "feature/foo",
        baseBranch: "main",
        targetPath: worktreeDir,
      })

      expect(created.worktree.branchName).toBe("feature/foo")
      expect(await git(worktreeDir, ["branch", "--show-current"])).toBe("feature/foo")
    } finally {
      await rm(repoDir, { recursive: true, force: true })
      await rm(remoteDir, { recursive: true, force: true })
      await rm(path.join(repoDir, "..", ".vfactor-worktrees-test"), { recursive: true, force: true })
    }
  })

  test("renames a managed worktree branch and path", async () => {
    const { repoDir, remoteDir } = await createRepositoryWithOrigin()
    const originalWorktreeDir = path.join(repoDir, "..", ".vfactor-worktrees-test", "draft-task")
    const renamedWorktreeDir = path.join(repoDir, "..", ".vfactor-worktrees-test", "fix-first-turn")

    try {
      const service = new GitService()
      await service.createWorktree(repoDir, {
        name: "Draft task",
        branchName: "draft-task",
        baseBranch: "main",
        targetPath: originalWorktreeDir,
      })
      const resolvedOriginalWorktreeDir = await realpath(originalWorktreeDir)

      const renamed = await service.renameWorktree(repoDir, {
        worktreePath: originalWorktreeDir,
        branchName: "fix-first-turn",
        targetPath: renamedWorktreeDir,
      })

      expect(renamed.previousBranchName).toBe("draft-task")
      expect(renamed.previousPath).toBe(resolvedOriginalWorktreeDir)
      expect(renamed.worktree.branchName).toBe("fix-first-turn")
      expect(renamed.worktree.path).toBe(await realpath(renamedWorktreeDir))
      expect(await git(renamedWorktreeDir, ["branch", "--show-current"])).toBe("fix-first-turn")
      expect(existsSync(originalWorktreeDir)).toBe(false)
    } finally {
      await rm(repoDir, { recursive: true, force: true })
      await rm(remoteDir, { recursive: true, force: true })
      await rm(path.join(repoDir, "..", ".vfactor-worktrees-test"), { recursive: true, force: true })
    }
  })

  test("does not rename the branch when the destination path is unavailable", async () => {
    const { repoDir, remoteDir } = await createRepositoryWithOrigin()
    const originalWorktreeDir = path.join(repoDir, "..", ".vfactor-worktrees-test", "draft-task")
    const blockedWorktreeDir = path.join(repoDir, "..", ".vfactor-worktrees-test", "blocked")

    try {
      const service = new GitService()
      await service.createWorktree(repoDir, {
        name: "Draft task",
        branchName: "draft-task",
        baseBranch: "main",
        targetPath: originalWorktreeDir,
      })

      await mkdir(blockedWorktreeDir, { recursive: true })

      await expect(
        service.renameWorktree(repoDir, {
          worktreePath: originalWorktreeDir,
          branchName: "fix-first-turn",
          targetPath: blockedWorktreeDir,
        })
      ).rejects.toThrow('already exists')

      expect(await git(originalWorktreeDir, ["branch", "--show-current"])).toBe("draft-task")
    } finally {
      await rm(repoDir, { recursive: true, force: true })
      await rm(remoteDir, { recursive: true, force: true })
      await rm(path.join(repoDir, "..", ".vfactor-worktrees-test"), { recursive: true, force: true })
    }
  })
})

describe("GitService.ensureInfoExcludeEntries", () => {
  test("appends missing entries once without touching existing lines", async () => {
    const repoDir = await createRepository()
    const service = new GitService()

    try {
      const infoExcludePath = path.join(repoDir, ".git", "info", "exclude")
      await writeFile(infoExcludePath, "# local excludes\n", "utf8")

      await service.ensureInfoExcludeEntries(repoDir, ["/.vfactor/"])
      await service.ensureInfoExcludeEntries(repoDir, ["/.vfactor/"])

      const contents = await readFile(infoExcludePath, "utf8")
      expect(contents).toBe("# local excludes\n/.vfactor/\n")
    } finally {
      await rm(repoDir, { recursive: true, force: true })
    }
  })
})

describe("pull request metadata helpers", () => {
  test("summarizes pending, failed, and passed checks counts", () => {
    expect(
      summarizePullRequestChecks([
        { bucket: "pass", name: "lint" },
        { bucket: "pending" },
        { bucket: "fail", name: "test" },
      ])
    ).toEqual({
      checksStatus: "failed",
      failedChecksCount: 1,
      failedCheckNames: ["test"],
      pendingChecksCount: 1,
      passedChecksCount: 1,
    })
  })

  test("maps merge states into the desktop contract", () => {
    expect(normalizePullRequestMergeStatus("MERGED", "MERGEABLE", "CLEAN")).toBe("merged")
    expect(normalizePullRequestMergeStatus("OPEN", "MERGEABLE", "CLEAN")).toBe("mergeable")
    expect(normalizePullRequestMergeStatus("OPEN", "MERGEABLE", "BEHIND")).toBe("blocked")
    expect(normalizePullRequestMergeStatus("OPEN", true, "BLOCKED")).toBe("blocked")
    expect(normalizePullRequestMergeStatus("OPEN", "CONFLICTING", "DIRTY")).toBe("blocked")
    expect(normalizePullRequestMergeStatus("OPEN", "UNKNOWN", "UNKNOWN")).toBe("unknown")
  })

  test("maps detailed check buckets into renderer-friendly states", () => {
    expect(normalizePullRequestCheckStatus("pending")).toBe("pending")
    expect(normalizePullRequestCheckStatus("pass")).toBe("passed")
    expect(normalizePullRequestCheckStatus("fail")).toBe("failed")
    expect(normalizePullRequestCheckStatus("cancel")).toBe("cancelled")
    expect(normalizePullRequestCheckStatus("skipping")).toBe("skipped")
  })

  test("parses GitHub Actions run and job ids from check links", () => {
    expect(
      parseGitHubActionsCheckTarget("https://github.com/example/repo/actions/runs/123456/job/789012")
    ).toEqual({
      runId: "123456",
      jobId: "789012",
    })
    expect(
      parseGitHubActionsCheckTarget("https://github.com/example/repo/runs/123456")
    ).toEqual({
      runId: "123456",
    })
    expect(parseGitHubActionsCheckTarget("https://example.com/checks/123")).toBeNull()
  })

  test("trims and de-ansi-fies failure output for copying", () => {
    const output = "\u001b[31mFAIL\u001b[39m something broke"
    expect(trimPullRequestFailureOutput(output, 32)).toBe("FAIL something broke")
  })

  test("maps resolve reasons from GitHub states with failed checks taking precedence", () => {
    expect(
      normalizePullRequestResolveReason({
        state: "OPEN",
        checksStatus: "failed",
        mergeStatus: "blocked",
        mergeable: "CONFLICTING",
        mergeStateStatus: "DIRTY",
      })
    ).toBe("failed_checks")
    expect(
      normalizePullRequestResolveReason({
        state: "OPEN",
        checksStatus: "pending",
        mergeStatus: "blocked",
        mergeable: "UNKNOWN",
        mergeStateStatus: "BEHIND",
      })
    ).toBeUndefined()
    expect(
      normalizePullRequestResolveReason({
        state: "OPEN",
        checksStatus: "passed",
        mergeStatus: "blocked",
        mergeable: "CONFLICTING",
        mergeStateStatus: "DIRTY",
      })
    ).toBe("conflicts")
    expect(
      normalizePullRequestResolveReason({
        state: "OPEN",
        checksStatus: "passed",
        mergeStatus: "blocked",
        mergeable: "UNKNOWN",
        mergeStateStatus: "BEHIND",
      })
    ).toBe("behind")
    expect(
      normalizePullRequestResolveReason({
        state: "OPEN",
        checksStatus: "passed",
        mergeStatus: "blocked",
        mergeable: "UNKNOWN",
        mergeStateStatus: "DRAFT",
      })
    ).toBe("draft")
    expect(
      normalizePullRequestResolveReason({
        state: "OPEN",
        checksStatus: "passed",
        mergeStatus: "blocked",
        mergeable: false,
        mergeStateStatus: "BLOCKED",
      })
    ).toBe("blocked")
    expect(
      normalizePullRequestResolveReason({
        state: "OPEN",
        checksStatus: "passed",
        mergeStatus: "unknown",
        mergeable: "UNKNOWN",
        mergeStateStatus: "UNKNOWN",
      })
    ).toBe("unknown")
  })

  test("only reuses open pull requests in the create flow", () => {
    expect(shouldReuseExistingPullRequest({ state: "open" })).toBe(true)
    expect(shouldReuseExistingPullRequest({ state: "merged" })).toBe(false)
    expect(shouldReuseExistingPullRequest({ state: "closed" })).toBe(false)
    expect(shouldReuseExistingPullRequest(null)).toBe(false)
  })

  test("maps a mergeable pull request with passing checks", () => {
    const pullRequest = mapPullRequest(
      {
        number: 18,
        title: "Header merge flow",
        url: "https://example.com/pr/18",
        state: "OPEN",
        baseRefName: "main",
        headRefName: "feature/header",
        mergeable: "MERGEABLE",
        mergeStateStatus: "CLEAN",
      },
      [{ bucket: "pass" }, { bucket: "pass" }]
    )

    expect(pullRequest).toMatchObject({
      state: "open",
      checksStatus: "passed",
      mergeStatus: "mergeable",
      isMergeable: true,
      passedChecksCount: 2,
      resolveReason: undefined,
    })
  })

  test("treats GitHub blocker states as not mergeable even when mergeable is optimistic", () => {
    const pullRequest = mapPullRequest(
      {
        number: 19,
        title: "Header blocked flow",
        url: "https://example.com/pr/19",
        state: "OPEN",
        baseRefName: "main",
        headRefName: "feature/header",
        mergeable: "MERGEABLE",
        mergeStateStatus: "BEHIND",
      },
      [{ bucket: "pass" }]
    )

    expect(pullRequest).toMatchObject({
      state: "open",
      checksStatus: "passed",
      mergeStatus: "blocked",
      isMergeable: false,
      resolveReason: "behind",
    })
  })

  test("maps a conflicted pull request with failed checks and check names", () => {
    const pullRequest = mapPullRequest(
      {
        number: 18,
        title: "Header resolve flow",
        url: "https://example.com/pr/18",
        state: "OPEN",
        baseRefName: "main",
        headRefName: "feature/header",
        mergeable: "CONFLICTING",
        mergeStateStatus: "DIRTY",
      },
      [
        { bucket: "fail", name: "lint" },
        { bucket: "pending", name: "integration" },
      ]
    )

    expect(pullRequest).toMatchObject({
      state: "open",
      checksStatus: "failed",
      mergeStatus: "blocked",
      isMergeable: false,
      failedChecksCount: 1,
      failedCheckNames: ["lint"],
      pendingChecksCount: 1,
      resolveReason: "failed_checks",
    })
  })
})
