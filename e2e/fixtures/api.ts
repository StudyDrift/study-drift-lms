/**
 * Lightweight API helpers for seeding and inspecting state during e2e tests.
 * All requests go directly to the API (bypassing the browser) for speed.
 */

const apiBase = process.env.E2E_API_URL ?? 'http://localhost:8080'

export interface UserCredentials {
  email: string
  password: string
  displayName?: string
}

export interface AuthTokens {
  access_token: string
}

export async function apiSignup(creds: UserCredentials): Promise<AuthTokens> {
  const res = await fetch(`${apiBase}/api/v1/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: creds.email,
      password: creds.password,
      display_name: creds.displayName,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Signup failed (${res.status}): ${body}`)
  }
  return res.json() as Promise<AuthTokens>
}

export async function apiLogin(creds: UserCredentials): Promise<AuthTokens> {
  const res = await fetch(`${apiBase}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: creds.email, password: creds.password }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Login failed (${res.status}): ${body}`)
  }
  return res.json() as Promise<AuthTokens>
}

export async function apiCreateCourse(
  token: string,
  payload: { title: string; description?: string },
): Promise<{ code: string; title: string }> {
  const res = await fetch(`${apiBase}/api/v1/courses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Create course failed (${res.status}): ${body}`)
  }
  return res.json() as Promise<{ code: string; title: string }>
}
