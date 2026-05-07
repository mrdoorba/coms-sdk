// Rev 4 Spec 02 §D1 regression canary — closes mrdoorba/coms-sdk#1.
//
// D1 was a Vite/Rollup bundle crash in Heroes' SvelteKit build:
//   "createHmac" is not exported by "__vite-browser-external"
// because the SDK barrel re-exports `APP_LAUNCHER` (a runtime constant), and
// without `sideEffects: false` Rollup conservatively pulled `webhook.ts`
// (`node:crypto`) and `manifest.ts` (lazy `google-auth-library`) into the
// browser graph.
//
// This smoketest browser-bundles a consumer that pulls `APP_LAUNCHER` through
// the bundle-safe subpath `@coms-portal/sdk/constants/app-launcher` (the path
// Heroes uses post-F4) and asserts the resulting bundle is clean of the
// forbidden server-only symbols. If anyone removes `sideEffects: false`,
// merges webhook.ts contents into a barrel-loaded module, or otherwise
// regresses the F3/F4 fix, this test fails before the SDK ships.

import { describe, it, expect, beforeAll } from 'bun:test'
import { build } from 'vite'
import { rm, readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const distDir = join(here, 'dist')
const assetsDir = join(distDir, 'assets')

// Server-only symbols that MUST NOT appear in the browser bundle. If any of
// these literals show up in `dist/assets/*.js`, the SDK has regressed onto
// the D1 failure mode (Rollup pulled a `node:crypto`/`google-auth-library`
// module into the browser graph).
const FORBIDDEN_SYMBOLS = [
  'createHmac',
  'node:crypto',
  'timingSafeEqual',
  'google-auth-library',
  'GoogleAuth',
] as const

// Sentinel string proving APP_LAUNCHER's `portal.label` survived tree-shake —
// confirms the import landed and Rollup didn't drop the whole module.
const SENTINEL = 'COMS'

async function listJsAssets(): Promise<string[]> {
  if (!existsSync(assetsDir)) return []
  const entries = await readdir(assetsDir)
  return entries.filter((f) => f.endsWith('.js')).map((f) => join(assetsDir, f))
}

describe('web-bundle-smoketest — D1 regression canary', () => {
  let bundleContents: string[] = []

  beforeAll(async () => {
    if (existsSync(distDir)) {
      await rm(distDir, { recursive: true, force: true })
    }
    await build({
      root: here,
      logLevel: 'warn',
      build: {
        outDir: distDir,
        emptyOutDir: true,
      },
    })
    const jsFiles = await listJsAssets()
    bundleContents = await Promise.all(jsFiles.map((p) => readFile(p, 'utf8')))
  }, 60_000)

  it('produces at least one JS asset', () => {
    expect(bundleContents.length).toBeGreaterThan(0)
  })

  it('contains no server-only symbols (node:crypto, google-auth-library)', () => {
    for (const symbol of FORBIDDEN_SYMBOLS) {
      const offending = bundleContents.findIndex((src) => src.includes(symbol))
      if (offending !== -1) {
        throw new Error(
          `forbidden symbol "${symbol}" leaked into browser bundle ` +
            `(asset index ${offending}). The SDK's APP_LAUNCHER subpath ` +
            `import is no longer bundle-safe — check sideEffects + subpath.`,
        )
      }
    }
  })

  it('contains the APP_LAUNCHER portal.label sentinel ("COMS")', () => {
    const found = bundleContents.some((src) => src.includes(SENTINEL))
    expect(found).toBe(true)
  })
})
