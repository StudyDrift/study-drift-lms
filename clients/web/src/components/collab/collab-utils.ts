/** Shared utilities for collaborative document components. */

const COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#ec4899', '#f97316',
]

/** Deterministic color for a user name (consistent across page loads). */
export function colorForUser(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h) + name.charCodeAt(i)
  return COLORS[Math.abs(h) % COLORS.length]
}
