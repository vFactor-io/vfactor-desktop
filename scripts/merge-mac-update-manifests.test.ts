import { describe, expect, test } from "bun:test"
import {
  mergeMacUpdateManifests,
  parseUpdateManifest,
  stringifyUpdateManifest,
} from "./merge-mac-update-manifests"

const ARM64_MANIFEST = `version: 0.1.9
files:
  - url: Nucleus-0.1.9-arm64.zip
    sha512: arm64-zip-hash
    size: 101
  - url: Nucleus-0.1.9-arm64.dmg
    sha512: arm64-dmg-hash
    size: 202
path: Nucleus-0.1.9-arm64.zip
sha512: arm64-zip-hash
releaseDate: '2026-04-09T12:00:00.000Z'
`

const X64_MANIFEST = `version: 0.1.9
files:
  - url: Nucleus-0.1.9-x64.zip
    sha512: x64-zip-hash
    size: 303
  - url: Nucleus-0.1.9-x64.dmg
    sha512: x64-dmg-hash
    size: 404
path: Nucleus-0.1.9-x64.zip
sha512: x64-zip-hash
releaseDate: '2026-04-09T12:00:00.000Z'
`

describe("mergeMacUpdateManifests", () => {
  test("merges arm64 and x64 file entries into one canonical manifest", () => {
    const merged = mergeMacUpdateManifests(
      parseUpdateManifest(ARM64_MANIFEST),
      parseUpdateManifest(X64_MANIFEST),
    )

    expect(merged.version).toBe("0.1.9")
    expect(merged.path).toBe("Nucleus-0.1.9-arm64.zip")
    expect(merged.files).toEqual([
      {
        url: "Nucleus-0.1.9-arm64.zip",
        sha512: "arm64-zip-hash",
        size: 101,
      },
      {
        url: "Nucleus-0.1.9-arm64.dmg",
        sha512: "arm64-dmg-hash",
        size: 202,
      },
      {
        url: "Nucleus-0.1.9-x64.zip",
        sha512: "x64-zip-hash",
        size: 303,
      },
      {
        url: "Nucleus-0.1.9-x64.dmg",
        sha512: "x64-dmg-hash",
        size: 404,
      },
    ])

    const roundTripped = parseUpdateManifest(stringifyUpdateManifest(merged))
    expect(roundTripped.files).toEqual(merged.files)
  })

  test("fails when the two manifests disagree on version", () => {
    expect(() =>
      mergeMacUpdateManifests(
        parseUpdateManifest(ARM64_MANIFEST),
        parseUpdateManifest(X64_MANIFEST.replace("0.1.9", "0.2.0")),
      ),
    ).toThrow("Mac update manifests must match the same version.")
  })
})
