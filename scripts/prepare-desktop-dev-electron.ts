import { copyFile, stat, utimes } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"

if (process.platform !== "darwin") {
  process.exit(0)
}

const require = createRequire(import.meta.url)
const electronPackagePath = require.resolve("electron/package.json", {
  paths: [join(import.meta.dirname, "..", "apps", "desktop")],
})
const electronAppPath = join(dirname(electronPackagePath), "dist", "Electron.app")
const infoPlistPath = join(electronAppPath, "Contents", "Info.plist")
const resourcesPath = join(electronAppPath, "Contents", "Resources")
const iconPath = join(import.meta.dirname, "..", "apps", "desktop", "build", "icons", "dev", "icon.icns")
const targetIconPath = join(resourcesPath, "vfactor-dev.icns")

async function touch(path: string): Promise<void> {
  const now = new Date()

  try {
    await utimes(path, now, now)
  } catch {
    const stats = await stat(path)
    await utimes(path, stats.atime, now)
  }
}

function setPlistValue(key: string, value: string): void {
  const result = spawnSync(
    "/usr/libexec/PlistBuddy",
    ["-c", `Set :${key} ${value}`, infoPlistPath],
    { stdio: "pipe" }
  )

  if (result.status !== 0) {
    throw new Error(
      `Failed to set ${key} in Electron.app Info.plist: ${String(result.stderr)}`
    )
  }
}

await copyFile(iconPath, targetIconPath)
setPlistValue("CFBundleDisplayName", "vFactor Dev")
setPlistValue("CFBundleName", "vFactor Dev")
setPlistValue("CFBundleIdentifier", "io.vfactor.desktop.dev")
setPlistValue("CFBundleIconFile", "vfactor-dev.icns")
await touch(electronAppPath)

console.log("[desktop-dev-electron] Prepared Electron.app dev identity.")
