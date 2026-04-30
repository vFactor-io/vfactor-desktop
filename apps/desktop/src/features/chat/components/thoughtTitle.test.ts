import { describe, expect, test } from "bun:test"

import { getThoughtSummaryTitle } from "./thoughtTitle"

describe("getThoughtSummaryTitle", () => {
  test("uses the explicit reasoning title when it is present", () => {
    expect(getThoughtSummaryTitle("Reasoning body", " Inspecting files ")).toBe(
      "Inspecting files"
    )
  })

  test("uses a bold first-line reasoning heading when no explicit title exists", () => {
    expect(getThoughtSummaryTitle("**Inspecting files**\n\nChecking the repo.")).toBe(
      "Inspecting files"
    )
  })

  test("falls back to Thought when there is no title", () => {
    expect(getThoughtSummaryTitle("Checking the repo.")).toBe("Thought")
  })
})
