import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { appendFile, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { execFile } from "node:child_process"

import { GitService } from "./git"

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
  const repoDir = await mkdtemp(path.join(tmpdir(), "nucleus-git-test-"))

  await git(repoDir, ["init", "--initial-branch=main"])
  await git(repoDir, ["config", "user.name", "Nucleus Test"])
  await git(repoDir, ["config", "user.email", "nucleus@example.com"])

  await writeFile(path.join(repoDir, "a.txt"), "alpha\n", "utf8")
  await writeFile(path.join(repoDir, "b.txt"), "beta\n", "utf8")
  await git(repoDir, ["add", "."])
  await git(repoDir, ["commit", "-m", "Initial commit"])

  return repoDir
}

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
    const remoteDir = await mkdtemp(path.join(tmpdir(), "nucleus-git-remote-"))
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
})

describe("GitService worktrees", () => {
  test("creates and removes a managed worktree without deleting its branch", async () => {
    const repoDir = await createRepository()
    const worktreeDir = path.join(repoDir, "..", ".nucleus-worktrees-test", "kolkata")

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
      await rm(path.join(repoDir, "..", ".nucleus-worktrees-test"), { recursive: true, force: true })
    }
  })

  test("blocks removing a dirty worktree", async () => {
    const repoDir = await createRepository()
    const worktreeDir = path.join(repoDir, "..", ".nucleus-worktrees-test", "oslo")

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
      await rm(path.join(repoDir, "..", ".nucleus-worktrees-test"), { recursive: true, force: true })
    }
  })

  test("ignores prunable worktree entries when listing and creating worktrees", async () => {
    const repoDir = await createRepository()
    const staleWorktreeDir = path.join(repoDir, "..", ".nucleus-worktrees-test", "stale")
    const freshWorktreeDir = path.join(repoDir, "..", ".nucleus-worktrees-test", "fresh")

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
      await rm(path.join(repoDir, "..", ".nucleus-worktrees-test"), { recursive: true, force: true })
    }
  })
})
