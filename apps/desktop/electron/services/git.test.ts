import { describe, expect, test } from "bun:test"
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises"
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
