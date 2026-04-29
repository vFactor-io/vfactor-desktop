import { describe, expect, test } from "bun:test"
import {
  getChecksTabBadgeCount,
  isActionablePullRequestChecksError,
  shouldAutoOpenChecksTab,
  sortPullRequestChecks,
  summarizePullRequestChecks,
} from "./pullRequestChecks"

describe("pullRequestChecks", () => {
  test("summarizes loaded checks into waiting state", () => {
    expect(
      summarizePullRequestChecks(
        {
          number: 12,
          title: "Checks",
          url: "https://example.com/pr/12",
          state: "open",
          baseBranch: "main",
          headBranch: "feature/checks",
          checksStatus: "pending",
          mergeStatus: "blocked",
          isMergeable: false,
        },
        [
          {
            id: "lint",
            name: "Lint",
            status: "pending",
            hasFailureDetails: false,
          },
          {
            id: "test",
            name: "Test",
            status: "failed",
            hasFailureDetails: true,
          },
        ]
      )
    ).toMatchObject({
      pendingCount: 1,
      failedCount: 1,
      tone: "waiting",
      label: "Waiting for checks",
    })
  })

  test("falls back to pull request counts when detailed checks are not loaded yet", () => {
    expect(
      summarizePullRequestChecks(
        {
          number: 18,
          title: "Checks",
          url: "https://example.com/pr/18",
          state: "open",
          baseBranch: "main",
          headBranch: "feature/checks",
          checksStatus: "failed",
          mergeStatus: "blocked",
          isMergeable: false,
          failedChecksCount: 2,
          passedChecksCount: 3,
          pendingChecksCount: 0,
        },
        []
      )
    ).toMatchObject({
      failedCount: 2,
      passedCount: 3,
      tone: "failed",
      label: "Checks failed",
    })
  })

  test("counts only pending and failed checks in the tab badge", () => {
    expect(
      getChecksTabBadgeCount(
        {
          number: 18,
          title: "Checks",
          url: "https://example.com/pr/18",
          state: "open",
          baseBranch: "main",
          headBranch: "feature/checks",
          checksStatus: "failed",
          mergeStatus: "blocked",
          isMergeable: false,
        },
        [
          { id: "a", name: "A", status: "pending", hasFailureDetails: false },
          { id: "b", name: "B", status: "failed", hasFailureDetails: true },
          { id: "c", name: "C", status: "passed", hasFailureDetails: false },
        ]
      )
    ).toBe(2)
  })

  test("auto-opens only when checks transition into pending", () => {
    expect(shouldAutoOpenChecksTab("passed", "pending")).toBe(true)
    expect(shouldAutoOpenChecksTab("pending", "pending")).toBe(false)
    expect(shouldAutoOpenChecksTab("pending", "failed")).toBe(false)
  })

  test("sorts pending and failed checks ahead of quiet states", () => {
    expect(
      sortPullRequestChecks([
        { id: "3", name: "Gamma", status: "passed", hasFailureDetails: false },
        { id: "1", name: "Alpha", status: "failed", hasFailureDetails: true },
        { id: "2", name: "Beta", status: "pending", hasFailureDetails: false },
      ]).map((check) => check.id)
    ).toEqual(["2", "1", "3"])
  })

  test("filters benign no-checks messages from actionable load errors", () => {
    expect(isActionablePullRequestChecksError("GitHub returned no pull request check data.")).toBe(false)
    expect(isActionablePullRequestChecksError("No required checks reported.")).toBe(false)
    expect(isActionablePullRequestChecksError("Unable to load pull request checks from GitHub.")).toBe(true)
  })
})
