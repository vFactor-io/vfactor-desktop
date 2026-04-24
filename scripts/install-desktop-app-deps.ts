#!/usr/bin/env bun

const shouldSkip =
  process.env.VERCEL === "1" ||
  process.env.NUCLEUS_SKIP_DESKTOP_POSTINSTALL === "1"

if (shouldSkip) {
  console.log("Skipping desktop native dependency rebuild in hosted install environment.")
  process.exit(0)
}

const desktopDir = new URL("../apps/desktop/", import.meta.url).pathname
const command = Bun.spawn([process.execPath, "x", "electron-builder", "install-app-deps"], {
  cwd: desktopDir,
  env: process.env,
  stdout: "inherit",
  stderr: "inherit",
})

process.exit(await command.exited)
