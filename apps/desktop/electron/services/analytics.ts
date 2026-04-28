import { PostHog } from "posthog-node"

let client: PostHog | null = null
let deviceId = "unknown"
let hasWarnedMissingApiKey = false
let hasWarnedMissingEnablement = false

function isTruthyEnvFlag(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true"
}

export function isAnalyticsConfigured(): boolean {
  return Boolean(process.env.POSTHOG_API_KEY?.trim())
}

export function isAnalyticsExplicitlyEnabled(): boolean {
  return isTruthyEnvFlag(process.env.POSTHOG_ENABLED?.trim())
}

export function initAnalytics(id: string): void {
  deviceId = id

  const apiKey = process.env.POSTHOG_API_KEY?.trim()

  if (!apiKey) {
    client = null

    if (!hasWarnedMissingApiKey) {
      hasWarnedMissingApiKey = true
      console.warn("[posthog] Analytics disabled: POSTHOG_API_KEY is not set")
    }

    return
  }

  if (!isAnalyticsExplicitlyEnabled()) {
    client = null

    if (!hasWarnedMissingEnablement) {
      hasWarnedMissingEnablement = true
      console.warn("[posthog] Analytics disabled: POSTHOG_ENABLED is not set to true")
    }

    return
  }

  client = new PostHog(apiKey, {
    host: process.env.POSTHOG_HOST,
    enableExceptionAutocapture: true,
  })
}

export function getDeviceId(): string {
  return deviceId
}

export function isAnalyticsEnabled(): boolean {
  return client !== null
}

export function capture(event: string, properties?: Record<string, unknown>): void {
  if (!client) return
  client.capture({ distinctId: deviceId, event, properties })
}

export function captureException(error: unknown, properties?: Record<string, unknown>): void {
  if (!client) return
  client.captureException(error, deviceId, properties)
}

export async function flushAnalytics(): Promise<void> {
  if (!client) return
  await client.flush()
}

export async function flushAnalyticsWithTimeout(timeoutMs = 2_000): Promise<void> {
  if (!client) return

  let timeout: ReturnType<typeof setTimeout> | null = null
  let timedOut = false
  const flush = client.flush().catch((error) => {
    if (timedOut) return
    throw error
  })

  try {
    await Promise.race([
      flush,
      new Promise<void>((resolve) => {
        timeout = setTimeout(() => {
          timedOut = true
          resolve()
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

export async function shutdownAnalytics(timeoutMs = 2_000): Promise<void> {
  if (!client) return

  try {
    await client.shutdown(timeoutMs)
  } finally {
    client = null
  }
}
