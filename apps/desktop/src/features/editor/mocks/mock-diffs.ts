import type { DiffData } from "../types"

export const mockDiffs: Record<string, DiffData> = {
  "utils.ts": {
    original: `export function formatDate(date: Date): string {
  return date.toLocaleDateString()
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str
  return str.slice(0, length) + "..."
}`,
    modified: `export function formatDate(date: Date, locale = "en-US"): string {
  return date.toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

export function capitalize(str: string): string {
  if (!str) return str
  return str.charAt(0).toUpperCase() + str.slice(1)
}

export function truncate(str: string, length: number, suffix = "..."): string {
  if (str.length <= length) return str
  return str.slice(0, length - suffix.length) + suffix
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
}`,
  },
}

export function getDiffData(filename: string): DiffData | undefined {
  return mockDiffs[filename]
}
