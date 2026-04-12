import { mkdir, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

const RUNTIME_ENV_KEYS = ["POSTHOG_API_KEY", "POSTHOG_ENABLED", "POSTHOG_HOST"] as const
const DEFAULT_OUTPUT_PATH = join(import.meta.dir, "..", "apps", "desktop", "build", "runtime", ".env")

type RuntimeEnvKey = (typeof RUNTIME_ENV_KEYS)[number]

function formatEnvValue(value: string): string {
  if (/^[A-Za-z0-9_./:@+-]+$/.test(value)) {
    return value
  }

  return JSON.stringify(value)
}

export function getDesktopRuntimeEnvEntries(env: NodeJS.ProcessEnv): Array<[RuntimeEnvKey, string]> {
  return RUNTIME_ENV_KEYS.flatMap((key) => {
    const value = env[key]?.trim()
    return value ? [[key, value]] : []
  })
}

export function stringifyDesktopRuntimeEnv(
  entries: ReadonlyArray<readonly [RuntimeEnvKey, string]>,
): string {
  return `${entries.map(([key, value]) => `${key}=${formatEnvValue(value)}`).join("\n")}\n`
}

async function writeDesktopRuntimeEnv(outputPath = DEFAULT_OUTPUT_PATH): Promise<void> {
  const entries = getDesktopRuntimeEnvEntries(process.env)

  if (entries.length === 0) {
    await rm(outputPath, { force: true })
    console.log(`[desktop-runtime-env] No runtime env keys found. Removed ${outputPath} if it existed.`)
    return
  }

  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, stringifyDesktopRuntimeEnv(entries), "utf8")
  console.log(
    `[desktop-runtime-env] Wrote ${entries.length} runtime key${entries.length === 1 ? "" : "s"} to ${outputPath}.`
  )
}

if (import.meta.main) {
  await writeDesktopRuntimeEnv(process.argv[2] || DEFAULT_OUTPUT_PATH)
}
