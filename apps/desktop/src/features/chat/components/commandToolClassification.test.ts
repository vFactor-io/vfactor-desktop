import { describe, expect, test } from "bun:test"

import { getCommandCliKind } from "./commandToolClassification"

describe("getCommandCliKind", () => {
  test("classifies git executables", () => {
    expect(getCommandCliKind({ command: "git status --short" })).toBe("git")
    expect(getCommandCliKind({ command: "/usr/bin/git diff -- apps/desktop" })).toBe("git")
    expect(getCommandCliKind({ command: '/bin/zsh -lc "git status --short"' })).toBe("git")
  })

  test("classifies gh executables as GitHub", () => {
    expect(getCommandCliKind({ command: "gh pr view" })).toBe("github")
    expect(getCommandCliKind({ command: "git remote -v && gh pr checks" })).toBe("github")
  })

  test("does not classify search arguments as git or GitHub commands", () => {
    expect(getCommandCliKind({ command: "rg git apps/desktop" })).toBeNull()
    expect(getCommandCliKind({ command: "rg gh apps/desktop" })).toBeNull()
  })
})
