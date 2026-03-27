/**
 * Avatar color utilities for generating consistent colors from names
 */

export const AVATAR_COLORS = [
  "bg-red-500/20",
  "bg-emerald-500/20",
  "bg-blue-500/20",
  "bg-purple-500/20",
  "bg-amber-500/20",
  "bg-cyan-500/20",
  "bg-pink-500/20",
  "bg-lime-500/20",
  "bg-indigo-500/20",
  "bg-orange-500/20",
  "bg-teal-500/20",
  "bg-fuchsia-500/20",
  "bg-yellow-500/20",
  "bg-violet-500/20",
  "bg-rose-500/20",
  "bg-sky-500/20",
  "bg-green-500/20",
] as const

export const TEXT_COLORS = [
  "text-red-400",
  "text-emerald-400",
  "text-blue-400",
  "text-purple-400",
  "text-amber-400",
  "text-cyan-400",
  "text-pink-400",
  "text-lime-400",
  "text-indigo-400",
  "text-orange-400",
  "text-teal-400",
  "text-fuchsia-400",
  "text-yellow-400",
  "text-violet-400",
  "text-rose-400",
  "text-sky-400",
  "text-green-400",
] as const

export const BORDER_COLORS = [
  "border-red-500/40",
  "border-emerald-500/40",
  "border-blue-500/40",
  "border-purple-500/40",
  "border-amber-500/40",
  "border-cyan-500/40",
  "border-pink-500/40",
  "border-lime-500/40",
  "border-indigo-500/40",
  "border-orange-500/40",
  "border-teal-500/40",
  "border-fuchsia-500/40",
  "border-yellow-500/40",
  "border-violet-500/40",
  "border-rose-500/40",
  "border-sky-500/40",
  "border-green-500/40",
] as const

/**
 * Generate a deterministic hash from a name string
 */
function hashName(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return Math.abs(hash)
}

/**
 * Generate a deterministic background color class from a name string
 * Uses a simple hash function to ensure the same name always gets the same color
 */
export function getColorFromName(name: string): string {
  return AVATAR_COLORS[hashName(name) % AVATAR_COLORS.length]
}

/**
 * Generate a deterministic text color class from a name string
 * Uses a simple hash function to ensure the same name always gets the same color
 */
export function getTextColorFromName(name: string): string {
  return TEXT_COLORS[hashName(name) % TEXT_COLORS.length]
}

/**
 * Generate a deterministic border color class from a name string
 * Uses a simple hash function to ensure the same name always gets the same color
 */
export function getBorderColorFromName(name: string): string {
  return BORDER_COLORS[hashName(name) % BORDER_COLORS.length]
}
