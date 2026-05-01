#!/usr/bin/env node
/**
 * Serves the Vite production build with mocked /api/v1/auth/* endpoints
 * so the Clever / ClassLink login buttons can be shown without a real API.
 * Usage: node scripts/k12-login-demo-server.mjs [port]
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..', 'clients', 'web', 'dist')
const port = Number(process.argv[2] || 9777)

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath)
  res.setHeader('Content-Type', mime[ext] || 'application/octet-stream')
  fs.createReadStream(filePath).pipe(res)
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url || '/', `http://127.0.0.1`)
  if (u.pathname === '/api/v1/auth/oidc/status') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(
      JSON.stringify({
        enabled: true,
        apiBase: `http://127.0.0.1:${port}`,
        clever: true,
        classlink: true,
        google: false,
        microsoft: false,
        apple: false,
        custom: [],
      }),
    )
    return
  }
  if (u.pathname === '/api/v1/auth/saml/status') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ enabled: false }))
    return
  }

  let rel = u.pathname === '/' ? '/index.html' : u.pathname
  if (rel.includes('..')) {
    res.writeHead(400)
    res.end()
    return
  }
  let filePath = path.join(root, rel)
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(root, 'index.html')
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(404)
    res.end('dist not found — run: cd clients/web && VITE_API_URL=/api npm run build')
    return
  }
  sendFile(res, filePath)
})

server.listen(port, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`k12 demo http://127.0.0.1:${port}/login`)
})
