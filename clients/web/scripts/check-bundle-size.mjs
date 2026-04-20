#!/usr/bin/env node
/**
 * Fails CI when the gzip size of all emitted JS under dist/assets exceeds a ceiling.
 * Baseline is updated intentionally when adding features; do not raise without review.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

const distAssets = join(process.cwd(), 'dist/assets')
const files = readdirSync(distAssets).filter((f) => f.endsWith('.js'))
let totalGzip = 0
for (const f of files) {
  const buf = readFileSync(join(distAssets, f))
  totalGzip += gzipSync(buf).length
}

const defaultMax = 620 * 1024
const maxBytes = Number(process.env.BUNDLE_MAX_JS_GZIP_BYTES ?? defaultMax)

if (Number.isNaN(maxBytes) || maxBytes <= 0) {
  console.error('Invalid BUNDLE_MAX_JS_GZIP_BYTES')
  process.exit(1)
}

if (totalGzip > maxBytes) {
  console.error(
    `Bundle gzip size ${totalGzip} bytes (all JS under dist/assets) exceeds max ${maxBytes} bytes. ` +
      `Raise the budget in scripts/check-bundle-size.mjs only with deliberate review.`,
  )
  process.exit(1)
}

console.log(`OK: total JS gzip ${totalGzip} bytes (ceiling ${maxBytes})`)
