import { getAccountType } from './auth'

/** After login or signup, parent accounts land on the parent dashboard unless they already asked for a `/parent` path. */
export function pickPostAuthPath(preferred: string): string {
  if (getAccountType() === 'parent') {
    if (preferred.startsWith('/parent')) {
      return preferred
    }
    return '/parent'
  }
  return preferred
}
