/** Parses JSON error bodies returned by the StudyDrift API. */
export function readApiErrorMessage(raw: unknown): string {
  if (raw && typeof raw === 'object' && 'error' in raw) {
    const err = (raw as { error?: { message?: string } }).error
    if (err?.message) return err.message
  }
  if (raw && typeof raw === 'object' && 'message' in raw) {
    const m = (raw as { message?: unknown }).message
    if (typeof m === 'string') return m
  }
  return 'Request failed'
}
