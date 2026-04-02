import { describe, expect, test } from "bun:test"

import { getCurrentProjectWorktreeState } from "./useCurrentProjectWorktree"
import type { Project } from "@/features/workspace/types"

function createProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    name: "Repo",
    path: "/tmp/repo",
    repoRootPath: "/tmp/repo",
    workspacesPath: null,
    rootWorktreeId: "root-worktree",
    selectedWorktreeId: "root-worktree",
    targetBranch: "main",
    remoteName: null,
    setupScript: null,
    hiddenWorktreePaths: [],
    worktrees: [
      {
        id: "root-worktree",
        name: "Root",
        branchName: "main",
        path: "/tmp/repo",
        createdAt: 1,
        updatedAt: 1,
        source: "root",
        status: "ready",
        intentStatus: "configured",
      },
    ],
    addedAt: 1,
    actions: [],
    primaryActionId: null,
    ...overrides,
  }
}

describe("getCurrentProjectWorktreeState", () => {
  test("returns focused project with null active workspace when none is available", () => {
    const state = getCurrentProjectWorktreeState(
      [
        createProject({
          rootWorktreeId: null,
          selectedWorktreeId: null,
          hiddenWorktreePaths: ["/tmp/repo"],
          worktrees: [],
        }),
      ],
      "project-1",
      null
    )

    expect(state.focusedProject?.id).toBe("project-1")
    expect(state.focusedProjectId).toBe("project-1")
    expect(state.activeWorktree).toBeNull()
    expect(state.activeWorktreeId).toBeNull()
    expect(state.activeWorktreePath).toBeNull()
  })

  test("returns no active workspace when the explicit active id is stale", () => {
    const state = getCurrentProjectWorktreeState(
      [
        createProject({
          selectedWorktreeId: "ready-worktree",
          worktrees: [
            {
              id: "ready-worktree",
              name: "Ready",
              branchName: "feature/ready",
              path: "/tmp/.nucleus-worktrees/repo/ready",
              createdAt: 2,
              updatedAt: 2,
              source: "managed",
              status: "ready",
              intentStatus: "configured",
            },
          ],
        }),
      ],
      "project-1",
      "missing-worktree"
    )

    expect(state.activeWorktree).toBeNull()
    expect(state.activeWorktreeId).toBeNull()
    expect(state.activeWorktreePath).toBeNull()
  })
})
