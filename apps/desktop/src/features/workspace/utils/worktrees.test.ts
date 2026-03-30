import { describe, expect, test } from "bun:test"

import {
  buildManagedWorktreePath,
  getSelectedWorktree,
  isWorktreeReady,
  resolveRepoRootPath,
} from "./worktrees"

describe("worktree utils", () => {
  test("resolves the repo root from a selected subdirectory", () => {
    const repoRootPath = resolveRepoRootPath("/tmp/repo/packages/app", [
      { path: "/tmp/repo", isMain: true },
      { path: "/tmp/.nucleus-worktrees/repo-123/feature", isMain: false },
    ])

    expect(repoRootPath).toBe("/tmp/repo")
  })

  test("prefers the main checkout when opening a linked worktree", () => {
    const repoRootPath = resolveRepoRootPath("/tmp/.nucleus-worktrees/repo-123/feature", [
      { path: "/tmp/repo", isMain: true },
      { path: "/tmp/.nucleus-worktrees/repo-123/feature", isMain: false },
    ])

    expect(repoRootPath).toBe("/tmp/repo")
  })

  test("builds managed worktrees next to the repo root, not inside it", () => {
    const managedWorktreePath = buildManagedWorktreePath(
      {
        id: "project-123",
        repoRootPath: "/tmp/repo",
      },
      "kolkata"
    )

    expect(managedWorktreePath).toBe("/tmp/.nucleus-worktrees/repo-project-123/kolkata")
  })

  test("falls back to the first ready worktree when the stored root is hidden", () => {
    const selectedWorktree = getSelectedWorktree({
      selectedWorktreeId: null,
      rootWorktreeId: "hidden-root",
      worktrees: [
        {
          id: "creating",
          name: "Creating",
          branchName: "creating",
          path: "/tmp/repo-creating",
          createdAt: 1,
          updatedAt: 1,
          source: "managed",
          status: "creating",
        },
        {
          id: "ready",
          name: "Ready",
          branchName: "ready",
          path: "/tmp/repo-ready",
          createdAt: 2,
          updatedAt: 2,
          source: "managed",
          status: "ready",
        },
      ],
    })

    expect(selectedWorktree?.id).toBe("ready")
    expect(isWorktreeReady(selectedWorktree)).toBe(true)
  })
})
