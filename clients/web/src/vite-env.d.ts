/// <reference types="vite/client" />
/// <reference types="vitest/globals" />

/** Injected at build time via Vite `define` in `vite.config.ts`. */
declare const __APP_RELEASE_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_API_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
