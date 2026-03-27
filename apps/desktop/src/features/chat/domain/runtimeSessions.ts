import { nanoid } from "nanoid"
import type { HarnessId, RuntimeSession } from "../types"

export function deriveSessionTitle(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ")
  if (normalized.length <= 80) {
    return normalized
  }

  return `${normalized.slice(0, 77).trimEnd()}...`
}

export function touchSession(session: RuntimeSession, title?: string): RuntimeSession {
  return {
    ...session,
    title: title ?? session.title,
    updatedAt: Date.now(),
  }
}

export function replaceSession(
  sessions: RuntimeSession[],
  nextSession: RuntimeSession
): RuntimeSession[] {
  return [...sessions]
    .map((session) => (session.id === nextSession.id ? nextSession : session))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function createOptimisticRuntimeSession(
  harnessId: HarnessId,
  projectPath: string
): RuntimeSession {
  const now = Date.now()

  return {
    id: `draft-${nanoid()}`,
    harnessId,
    projectPath,
    createdAt: now,
    updatedAt: now,
  }
}

export function getRemoteSessionId(session: RuntimeSession): string {
  return session.remoteId ?? session.id
}
