/** i18n-style keys aligned with server `internal/auth/passwordpolicy`. */
export type PasswordStrengthKey = 'password.strength.weak' | 'password.strength.fair' | 'password.strength.strong'

const DISPLAY: Record<PasswordStrengthKey, string> = {
  'password.strength.weak': 'Weak',
  'password.strength.fair': 'Fair',
  'password.strength.strong': 'Strong',
}

function hasUpper(s: string): boolean {
  return /[A-Z]/.test(s)
}
function hasLower(s: string): boolean {
  return /[a-z]/.test(s)
}
function hasDigit(s: string): boolean {
  return /\d/.test(s)
}
function hasSpecial(s: string): boolean {
  for (const ch of s) {
    if (!/[A-Za-z0-9]/.test(ch)) return true
  }
  return false
}

/** Rule-based strength (matches server heuristic). */
export function passwordStrengthKey(password: string): PasswordStrengthKey {
  let classes = 0
  if (hasUpper(password)) classes++
  if (hasLower(password)) classes++
  if (hasDigit(password)) classes++
  if (hasSpecial(password)) classes++
  const n = password.length
  if (n < 8 || classes <= 1) return 'password.strength.weak'
  if (n >= 12 && classes >= 3) return 'password.strength.strong'
  return 'password.strength.fair'
}

export function passwordStrengthEnglish(key: PasswordStrengthKey): string {
  return DISPLAY[key]
}
