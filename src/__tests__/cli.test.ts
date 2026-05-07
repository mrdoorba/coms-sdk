import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// We exercise the CLI by spawning Bun on src/cli.ts (not a built dist file).
// The CLI imports `registerManifest` and `defineManifest` from ../manifest.js;
// to avoid coupling tests to GoogleAuth we point the CLI at a fake portal HTTP
// server and arrange the H-app's manifest module to short-circuit ID-token
// minting via a `COMS_PORTAL_CLI_TEST_TOKEN` env var bypass.
// ---------------------------------------------------------------------------

const TMP = join(tmpdir(), 'coms-sdk-cli-test')
let server: ReturnType<typeof Bun.serve>
let lastRequestBody: unknown = null
let nextResponse: { status: number; body: unknown } = {
  status: 200,
  body: { schemaVersion: 2, registeredAt: '2026-05-07T12:00:00.000Z' },
}

beforeAll(() => {
  mkdirSync(TMP, { recursive: true })
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      lastRequestBody = await req.json()
      const auth = req.headers.get('authorization')
      if (!auth?.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'no auth' }), { status: 401 })
      }
      return new Response(JSON.stringify(nextResponse.body), {
        status: nextResponse.status,
        headers: { 'Content-Type': 'application/json' },
      })
    },
  })
})

afterAll(() => {
  server.stop()
  rmSync(TMP, { recursive: true, force: true })
})

function writeManifest(name: string, body: string): string {
  const path = join(TMP, name)
  writeFileSync(path, body)
  return path
}

const validManifestSrc = `
import { defineManifest } from '${join(import.meta.dir, '..', 'manifest.ts')}'
export default defineManifest({
  appId: 'heroes',
  displayName: 'Heroes',
  schemaVersion: 2,
  configSchema: {
    notifyOnAssignment: { type: 'boolean', default: true },
  },
  taxonomies: ['team'],
})
`

async function runCli(args: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn(['bun', 'run', join(import.meta.dir, '..', 'cli.ts'), ...args], {
    env: { ...process.env, ...env, COMS_PORTAL_CLI_TEST_TOKEN: 'fake-token' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const exitCode = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  return { exitCode, stdout, stderr }
}

describe('coms-portal-cli register-manifest', () => {
  it('exit 0 on a successful registration; POSTs the manifest body', async () => {
    const manifestPath = writeManifest('valid.ts', validManifestSrc)
    nextResponse = { status: 200, body: { schemaVersion: 2, registeredAt: '2026-05-07T12:00:00.000Z' } }
    lastRequestBody = null

    const portalUrl = `http://localhost:${server.port}`
    const res = await runCli([
      'register-manifest',
      '--portal-url', portalUrl,
      '--app-slug', 'heroes',
      '--manifest', manifestPath,
    ])

    expect(res.exitCode).toBe(0)
    expect(lastRequestBody).toMatchObject({ appId: 'heroes', displayName: 'Heroes' })
  })

  it('exit 2 when the manifest file is malformed', async () => {
    const manifestPath = writeManifest('bad.ts', `export default { not: 'a manifest' }`)
    const portalUrl = `http://localhost:${server.port}`
    const res = await runCli([
      'register-manifest',
      '--portal-url', portalUrl,
      '--app-slug', 'heroes',
      '--manifest', manifestPath,
    ])
    expect(res.exitCode).toBe(2)
    expect(res.stderr).toMatch(/manifest|appId|displayName/i)
  })

  it('exit 3 on a 5xx from the portal', async () => {
    const manifestPath = writeManifest('valid2.ts', validManifestSrc)
    nextResponse = { status: 503, body: { error: 'unavailable' } }
    const portalUrl = `http://localhost:${server.port}`
    const res = await runCli([
      'register-manifest',
      '--portal-url', portalUrl,
      '--app-slug', 'heroes',
      '--manifest', manifestPath,
    ])
    expect(res.exitCode).toBe(3)
  })

  it('exit 2 when --app-slug does not match manifest.appId', async () => {
    const manifestPath = writeManifest('valid3.ts', validManifestSrc)
    nextResponse = { status: 200, body: { schemaVersion: 2, registeredAt: '2026-05-07T12:00:00.000Z' } }
    const portalUrl = `http://localhost:${server.port}`
    const res = await runCli([
      'register-manifest',
      '--portal-url', portalUrl,
      '--app-slug', 'orbit',
      '--manifest', manifestPath,
    ])
    expect(res.exitCode).toBe(2)
    expect(res.stderr).toMatch(/slug/i)
  })

  it('exit 2 when required arguments are missing', async () => {
    const res = await runCli(['register-manifest', '--app-slug', 'heroes'])
    expect(res.exitCode).toBe(2)
  })

  it('exit 2 on an unknown subcommand', async () => {
    const res = await runCli(['nuke-everything'])
    expect(res.exitCode).toBe(2)
  })

  // Production-grade pre-minted token path (Spec 02 §HB CD-pipeline path).
  // The CD environment mints the OIDC ID token externally (e.g. via
  // google-github-actions/auth `token_format: 'id_token'`) and supplies it
  // through COMS_PORTAL_CLI_OIDC_TOKEN so the CLI does not invoke
  // google-auth-library at all — necessary for WIF + service-account
  // impersonation chains that getIdTokenClient cannot handle.
  it('uses COMS_PORTAL_CLI_OIDC_TOKEN as the bearer when set (production CD path)', async () => {
    const manifestPath = writeManifest('valid-oidc.ts', validManifestSrc)
    nextResponse = { status: 200, body: { schemaVersion: 2, registeredAt: '2026-05-07T12:00:00.000Z' } }
    const captured: { auth: string | null } = { auth: null }
    const oidcServer = Bun.serve({
      port: 0,
      async fetch(req) {
        captured.auth = req.headers.get('authorization')
        return new Response(JSON.stringify(nextResponse.body), { status: 200 })
      },
    })
    try {
      const portalUrl = `http://localhost:${oidcServer.port}`
      const proc = Bun.spawn(
        ['bun', 'run', join(import.meta.dir, '..', 'cli.ts'),
          'register-manifest',
          '--portal-url', portalUrl,
          '--app-slug', 'heroes',
          '--manifest', manifestPath,
        ],
        {
          // Note: NO COMS_PORTAL_CLI_TEST_TOKEN — only the production env var.
          env: { ...process.env, COMS_PORTAL_CLI_OIDC_TOKEN: 'preminted-oidc-token-xyz' },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      )
      const exitCode = await proc.exited
      expect(exitCode).toBe(0)
      expect(captured.auth).toBe('Bearer preminted-oidc-token-xyz')
    } finally {
      oidcServer.stop()
    }
  })
})
