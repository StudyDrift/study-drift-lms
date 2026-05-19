import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { visualizer } from 'rollup-plugin-visualizer'

const __dirname = dirname(fileURLToPath(import.meta.url))
const packageVersion = (
  JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')) as { version: string }
).version

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_RELEASE_VERSION__: JSON.stringify(process.env.VITE_APP_RELEASE_VERSION ?? packageVersion),
  },
  plugins: [
    react(),
    tailwindcss(),
    ...(process.env.ANALYZE === 'true' || process.env.ANALYZE === '1'
      ? [
          visualizer({
            filename: 'dist/stats.html',
            gzipSize: true,
            brotliSize: true,
            open: false,
          }),
        ]
      : []),
  ],
  server: {
    host: true,
    watch: {
      usePolling: process.env.CHOKIDAR_USEPOLLING === 'true',
    },
    // If anything still fetches a relative /api/... path, send it to the API (avoids 404 from Vite).
    // In compose, set VITE_DEV_API_PROXY to http://server:8080 so the Vite container can reach the API service.
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API_PROXY ?? 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    include: ['turndown'],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.spec.{ts,tsx}',
        'src/test/**',
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
    },
  },
})
