import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function b64urlJson(obj) {
  const s = JSON.stringify(obj)
  return Buffer.from(s, 'utf8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function fakeJwt(payload) {
  const header = { alg: 'none', typ: 'JWT' }
  return `${b64urlJson(header)}.${b64urlJson(payload)}.`
}

async function main() {
  const port = Number(process.env.PORT || 5174)
  const host = process.env.HOST || '127.0.0.1'
  const base = `http://${host}:${port}`

  const orgId = 'a0000000-0000-4000-8000-0000000000a0'
  const access = fakeJwt({
    sub: 'demo-user',
    org_id: orgId,
    org_slug: 'default',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
  })

  const server = spawn('npm', ['run', 'dev', '--', '--host', host, '--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  })

  let ready = false
  const onLine = (buf) => {
    const s = String(buf)
    if (s.includes('http') && s.includes(String(port))) ready = true
    process.stdout.write(s)
  }
  server.stdout.on('data', onLine)
  server.stderr.on('data', onLine)

  for (let i = 0; i < 50; i++) {
    if (ready) break
    await sleep(200)
  }
  await sleep(500)

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1200, height: 720 } })

  const problems = []
  page.on('console', (msg) => {
    const t = msg.type()
    if (t === 'warning' || t === 'error') {
      problems.push({ type: t, text: msg.text() })
    }
  })

  await page.addInitScript((token) => {
    localStorage.setItem('studydrift_access_token', token)
  }, access)

  // Prevent background websocket clients from spamming console warnings.
  await page.addInitScript(() => {
    // Minimal WebSocket shim: never connects, never errors.
    class QuietWebSocket {
      static CONNECTING = 0
      static OPEN = 1
      static CLOSING = 2
      static CLOSED = 3
      readyState = QuietWebSocket.CLOSED
      url = ''
      protocol = ''
      onopen = null
      onerror = null
      onclose = null
      onmessage = null
      constructor(url) {
        this.url = String(url || '')
      }
      close() {}
      send() {}
      addEventListener() {}
      removeEventListener() {}
      dispatchEvent() {
        return false
      }
    }
    window.WebSocket = QuietWebSocket
  })

  await page.route('**/api/v1/settings/account', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        email: 'org-admin@example.edu',
        displayName: 'Org Admin',
        firstName: 'Org',
        lastName: 'Admin',
        avatarUrl: null,
        uiTheme: 'light',
      }),
    })
  })

  await page.route('**/api/v1/me/permissions**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        permissionStrings: ['tenant:org:roles:manage', 'tenant:org:roles:view', 'tenant:org:units:admin'],
      }),
    })
  })

  await page.route(`**/api/v1/orgs/${orgId}/role-grants**`, async (route) => {
    const url = route.request().url()
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          grants: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              orgId,
              userId: '22222222-2222-4222-8222-222222222222',
              userEmail: 'principal@example.edu',
              displayName: 'Principal Lincoln',
              orgUnitId: '33333333-3333-4333-8333-333333333333',
              orgUnitName: 'Lincoln High',
              role: 'org_unit_admin',
              grantedAt: new Date().toISOString(),
              expiresAt: null,
            },
            {
              id: '44444444-4444-4444-8444-444444444444',
              orgId,
              userId: '55555555-5555-4555-8555-555555555555',
              userEmail: 'auditor@example.edu',
              displayName: 'Org Auditor',
              orgUnitId: null,
              orgUnitName: null,
              role: 'org_viewer',
              grantedAt: new Date().toISOString(),
              expiresAt: null,
            },
          ],
        }),
      })
      return
    }
    // POST: accept and return id
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ id: '66666666-6666-4666-8666-666666666666' }),
    })
  })

  await page.route(`**/api/v1/admin/orgs/${orgId}/units/tree**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tree: [
          {
            id: '33333333-3333-4333-8333-333333333333',
            name: 'Lincoln High',
            children: [
              { id: '77777777-7777-4777-8777-777777777777', name: 'Math Department', children: [] },
            ],
          },
        ],
      }),
    })
  })

  await page.route(`**/api/v1/orgs/${orgId}/users**`, async (route) => {
    const u = new URL(route.request().url())
    const q = (u.searchParams.get('q') || '').toLowerCase()
    const all = [
      { id: '88888888-8888-4888-8888-888888888888', email: 'teacher@example.edu', displayName: 'Ms. Frizzle' },
      { id: '55555555-5555-4555-8555-555555555555', email: 'auditor@example.edu', displayName: 'Org Auditor' },
    ]
    const users = all.filter((x) => x.email.toLowerCase().includes(q) || (x.displayName || '').toLowerCase().includes(q))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ users }),
    })
  })

  // Avoid noisy errors for unrelated endpoints.
  await page.route('**/api/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })

  await page.goto(`${base}/settings/org-roles`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)

  await page.screenshot({ path: '../../docs/completed/assets/5.8-org-roles.png', fullPage: true })

  await browser.close()
  server.kill('SIGTERM')

  if (problems.length > 0) {
    console.error('Console warnings/errors captured:')
    for (const p of problems) console.error(`${p.type}: ${p.text}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

