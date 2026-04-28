import { describe, expect, test } from "bun:test"

import { getCommandCliKind } from "./commandToolClassification"

describe("getCommandCliKind", () => {
  test("classifies git executables", () => {
    expect(getCommandCliKind({ command: "git status --short" })).toBe("git")
    expect(getCommandCliKind({ command: "/usr/bin/git diff -- apps/desktop" })).toBe("git")
    expect(getCommandCliKind({ command: '"C:\\Program Files\\Git\\cmd\\git.exe" status --short' })).toBe("git")
    expect(getCommandCliKind({ command: "git.cmd status --short" })).toBe("git")
    expect(getCommandCliKind({ command: '/bin/zsh -lc "git status --short"' })).toBe("git")
    expect(getCommandCliKind({ command: '/usr/bin/bash -c "git diff --stat"' })).toBe("git")
    expect(getCommandCliKind({ command: 'zsh -lc "bash -c \\"git branch --show-current\\""' })).toBe("git")
  })

  test("classifies gh executables as GitHub", () => {
    expect(getCommandCliKind({ command: "gh pr view" })).toBe("github")
    expect(getCommandCliKind({ command: "GH.EXE pr view" })).toBe("github")
    expect(getCommandCliKind({ command: "git remote -v && gh pr checks" })).toBe("github")
    expect(getCommandCliKind({ command: '/usr/bin/zsh -lc "gh pr view --json title"' })).toBe("github")
  })

  test("skips path-qualified command wrappers", () => {
    expect(getCommandCliKind({ command: "/usr/bin/env git status" })).toBe("git")
    expect(getCommandCliKind({ command: "/usr/bin/sudo gh pr checks" })).toBe("github")
    expect(getCommandCliKind({ command: "/usr/bin/command git diff" })).toBe("git")
  })

  test("does not classify search arguments as git or GitHub commands", () => {
    expect(getCommandCliKind({ command: "rg git apps/desktop" })).toBeNull()
    expect(getCommandCliKind({ command: "rg gh apps/desktop" })).toBeNull()
  })
})
