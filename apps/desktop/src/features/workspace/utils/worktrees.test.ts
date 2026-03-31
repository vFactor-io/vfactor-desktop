import { describe, expect, test } from "bun:test"

import {
  buildManagedWorktreePath,
  getDefaultProjectWorkspacesPath,
  getProjectWorkspacesPath,
  getSelectedWorktree,
  isWorktreeReady,
  normalizeProjectWorkspacesPath,
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

  test("builds managed worktree paths correctly for Windows repo roots", () => {
    const managedWorktreePath = buildManagedWorktreePath(
      {
        id: "project-123",
        repoRootPath: "C:\\repo",
      },
      "kolkata"
    )

    expect(managedWorktreePath).toBe("C:\\.nucleus-worktrees\\repo-project-123\\kolkata")
  })

  test("resolves the default workspaces path from the repo root", () => {
    expect(
      getDefaultProjectWorkspacesPath({
        id: "project-123",
        repoRootPath: "/tmp/repo",
      })
    ).toBe("/tmp/.nucleus-worktrees/repo-project-123")
  })

  test("prefers a stored custom workspaces path when present", () => {
    expect(
      getProjectWorkspacesPath({
        id: "project-123",
        repoRootPath: "/tmp/repo",
        workspacesPath: "/tmp/conductor/workspaces/repo ",
      })
    ).toBe("/tmp/conductor/workspaces/repo")
  })

  test("preserves Windows custom workspaces paths while trimming trailing separators", () => {
    expect(
      getProjectWorkspacesPath({
        id: "project-123",
        repoRootPath: "C:\\repo",
        workspacesPath: "C:\\conductor\\workspaces\\repo\\\\",
      })
    ).toBe("C:\\conductor\\workspaces\\repo")
  })

  test("normalizes empty custom workspaces paths to null", () => {
    expect(normalizeProjectWorkspacesPath("   ")).toBeNull()
  })

  test("normalizes Windows custom workspaces paths without mangling separators", () => {
    expect(normalizeProjectWorkspacesPath("C:\\workspaces\\repo\\\\")).toBe("C:\\workspaces\\repo")
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
