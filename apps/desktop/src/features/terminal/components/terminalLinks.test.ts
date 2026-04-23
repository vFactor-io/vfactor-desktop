import { describe, expect, test } from "bun:test"
import { findTerminalUrlAtTextOffset } from "./terminalLinks"

describe("findTerminalUrlAtTextOffset", () => {
  test("returns the url when the offset lands inside it", () => {
    const line = "  Local:   http://localhost:1420/  "
    const offset = line.indexOf("localhost") + 4

    expect(findTerminalUrlAtTextOffset(line, offset)).toEqual({
      url: "http://localhost:1420/",
      start: line.indexOf("http://localhost:1420/"),
      end: line.indexOf("http://localhost:1420/") + "http://localhost:1420/".length,
    })
  })

  test("ignores offsets outside the url", () => {
    const line = "  Local:   http://localhost:1420/  "

    expect(findTerminalUrlAtTextOffset(line, 2)).toBeNull()
  })

  test("trims trailing punctuation from terminal output", () => {
    const line = "Open http://localhost:3000/ now."
    const offset = line.indexOf("localhost") + 2

    expect(findTerminalUrlAtTextOffset(line, offset)).toEqual({
      url: "http://localhost:3000/",
      start: line.indexOf("http://localhost:3000/"),
      end: line.indexOf("http://localhost:3000/") + "http://localhost:3000/".length,
    })
  })
})
