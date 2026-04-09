import { describe, expect, test } from "bun:test"

import { shouldIgnoreFileSystemEntry } from "./fileSystem"

describe("shouldIgnoreFileSystemEntry", () => {
  test("shows dotfiles and dotfolders that are not explicitly ignored", () => {
    expect(shouldIgnoreFileSystemEntry(".github")).toBe(false)
    expect(shouldIgnoreFileSystemEntry(".claude")).toBe(false)
    expect(shouldIgnoreFileSystemEntry(".env")).toBe(false)
    expect(shouldIgnoreFileSystemEntry(".env.local")).toBe(false)
  })

  test("still hides explicit internal and generated directories", () => {
    expect(shouldIgnoreFileSystemEntry(".git")).toBe(true)
    expect(shouldIgnoreFileSystemEntry("node_modules")).toBe(true)
    expect(shouldIgnoreFileSystemEntry(".next")).toBe(true)
    expect(shouldIgnoreFileSystemEntry("coverage")).toBe(true)
  })
})
