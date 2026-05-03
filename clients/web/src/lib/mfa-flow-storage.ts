const KEY = 'studydrift_mfa_flow'

export type MfaFlowMode = 'challenge' | 'setup'

export type MfaFlowState = {
  token: string
  mode: MfaFlowMode
}

export function setMfaFlow(state: MfaFlowState): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

export function getMfaFlow(): MfaFlowState | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const o = JSON.parse(raw) as { token?: string; mode?: string }
    if (typeof o.token !== 'string' || o.token === '') return null
    if (o.mode !== 'challenge' && o.mode !== 'setup') return null
    return { token: o.token, mode: o.mode }
  } catch {
    return null
  }
}

export function clearMfaFlow(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
