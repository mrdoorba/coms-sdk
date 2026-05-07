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

  // -------------------------------------------------------------------------
  // smoketest verb (Spec 06 Rev 4 PR B) — exercise via spawned bun process.
  // We host a fake portal that responds to POST /api/v1/apps/:slug/smoketest
  // and a fake app server whose URL the portal returns in `app.url`. The
  // CLI should hit the portal, then probe the app's `/`, then render the
  // three-step report.
  // -------------------------------------------------------------------------

  describe('smoketest verb', () => {
    interface FakePortalState {
      response: { status: number; body: unknown }
      lastAuth: string | null
    }

    function startFakePortal(state: FakePortalState, appUrl: string) {
      return Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url)
          if (url.pathname.endsWith('/smoketest') && req.method === 'POST') {
            state.lastAuth = req.headers.get('authorization')
            // Stitch app.url into the response body if the test passed a
            // sentinel — keeps tests from caring about the dynamic port.
            const body = JSON.parse(JSON.stringify(state.response.body))
            if (body && body.app && body.app.url === '__APP_URL__') {
              body.app.url = appUrl
            }
            if (Array.isArray(body?.endpoints)) {
              body.endpoints = body.endpoints.map(
                (e: { url?: string } & Record<string, unknown>) =>
                  e.url === '__APP_URL__/webhook' ? { ...e, url: `${appUrl}/webhook` } : e,
              )
            }
            return new Response(JSON.stringify(body), {
              status: state.response.status,
              headers: { 'Content-Type': 'application/json' },
            })
          }
          return new Response('not found', { status: 404 })
        },
      })
    }

    function startFakeApp(opts: { rootStatus?: number; rootDelayMs?: number }) {
      return Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url)
          if (url.pathname === '/' && req.method === 'GET') {
            if (opts.rootDelayMs) await new Promise((r) => setTimeout(r, opts.rootDelayMs))
            return new Response('', { status: opts.rootStatus ?? 200 })
          }
          if (url.pathname === '/healthz' && req.method === 'GET') {
            return new Response('', { status: 200 })
          }
          return new Response('not found', { status: 404 })
        },
      })
    }

    it('exit 0 on a fully-green smoketest; renders the three-step report', async () => {
      const fakeApp = startFakeApp({ rootStatus: 200 })
      const appUrl = `http://localhost:${fakeApp.port}`
      const state: FakePortalState = {
        lastAuth: null,
        response: {
          status: 200,
          body: {
            app: {
              id: 'app-1', slug: 'fast', name: 'Fast', url: '__APP_URL__',
              status: 'active', handoffMode: 'one_time_code',
            },
            endpoints: [
              { endpointId: 'ep-1', url: '__APP_URL__/webhook', status: 200, latencyMs: 87 },
            ],
            ok: true,
          },
        },
      }
      const fakePortal = startFakePortal(state, appUrl)
      try {
        const res = await runCli([
          'smoketest',
          '--portal-url', `http://localhost:${fakePortal.port}`,
          '--app-slug', 'fast',
        ])
        expect(res.exitCode).toBe(0)
        expect(res.stdout).toContain('[1/3] Registry check')
        expect(res.stdout).toContain('handoff_mode=one_time_code')
        expect(res.stdout).toContain('[2/3] App URL reachable')
        expect(res.stdout).toContain('[3/3] Webhook delivery')
        expect(res.stdout).toContain('Smoketest OK.')
        expect(state.lastAuth).toBe('Bearer fake-token')
      } finally {
        fakePortal.stop()
        fakeApp.stop()
      }
    })

    it('exit 2 with "step 1: app not registered" message on 404', async () => {
      const fakeApp = startFakeApp({ rootStatus: 200 })
      const appUrl = `http://localhost:${fakeApp.port}`
      const state: FakePortalState = {
        lastAuth: null,
        response: { status: 404, body: { error: 'app_not_registered', reason: 'no row' } },
      }
      const fakePortal = startFakePortal(state, appUrl)
      try {
        const res = await runCli([
          'smoketest',
          '--portal-url', `http://localhost:${fakePortal.port}`,
          '--app-slug', 'missing',
        ])
        expect(res.exitCode).toBe(2)
        expect(res.stdout).toContain('[1/3] Registry check     → FAILED')
        expect(res.stdout.toLowerCase()).toMatch(/not registered|404/)
        expect(res.stdout).toContain('Smoketest FAILED.')
      } finally {
        fakePortal.stop()
        fakeApp.stop()
      }
    })

    it('exit 3 when the app URL is unreachable', async () => {
      // Pretend the app responds 500 — the CLI's step-2 probe will see non-2xx.
      const fakeApp = startFakeApp({ rootStatus: 500 })
      const appUrl = `http://localhost:${fakeApp.port}`
      const state: FakePortalState = {
        lastAuth: null,
        response: {
          status: 200,
          body: {
            app: {
              id: 'app-1', slug: 'fast', name: 'Fast', url: '__APP_URL__',
              status: 'active', handoffMode: 'one_time_code',
            },
            endpoints: [],
            ok: true,
          },
        },
      }
      const fakePortal = startFakePortal(state, appUrl)
      try {
        const res = await runCli([
          'smoketest',
          '--portal-url', `http://localhost:${fakePortal.port}`,
          '--app-slug', 'fast',
        ])
        expect(res.exitCode).toBe(3)
        expect(res.stdout).toContain('[2/3] App URL reachable')
        expect(res.stdout).toContain('Smoketest FAILED.')
      } finally {
        fakePortal.stop()
        fakeApp.stop()
      }
    })

    it('exit 3 when an endpoint returns non-2xx (portal ok=false)', async () => {
      const fakeApp = startFakeApp({ rootStatus: 200 })
      const appUrl = `http://localhost:${fakeApp.port}`
      const state: FakePortalState = {
        lastAuth: null,
        response: {
          status: 200,
          body: {
            app: {
              id: 'app-1', slug: 'fast', name: 'Fast', url: '__APP_URL__',
              status: 'active', handoffMode: 'one_time_code',
            },
            endpoints: [
              {
                endpointId: 'ep-1', url: '__APP_URL__/webhook', status: 500, latencyMs: 142,
                error: 'HTTP 500 Server Error',
              },
            ],
            ok: false,
          },
        },
      }
      const fakePortal = startFakePortal(state, appUrl)
      try {
        const res = await runCli([
          'smoketest',
          '--portal-url', `http://localhost:${fakePortal.port}`,
          '--app-slug', 'fast',
        ])
        expect(res.exitCode).toBe(3)
        expect(res.stdout).toMatch(/\[3\/3\] Webhook delivery/)
        expect(res.stdout).toContain('status=500')
        expect(res.stdout).toContain('Smoketest FAILED.')
      } finally {
        fakePortal.stop()
        fakeApp.stop()
      }
    })

    it('exit 1 on auth failure (portal returns 401)', async () => {
      const fakeApp = startFakeApp({ rootStatus: 200 })
      const appUrl = `http://localhost:${fakeApp.port}`
      const state: FakePortalState = {
        lastAuth: null,
        response: { status: 401, body: { error: 'unauthorized', reason: 'missing_token' } },
      }
      const fakePortal = startFakePortal(state, appUrl)
      try {
        const res = await runCli([
          'smoketest',
          '--portal-url', `http://localhost:${fakePortal.port}`,
          '--app-slug', 'fast',
        ])
        expect(res.exitCode).toBe(1)
        expect(res.stdout).toMatch(/\[1\/3\] Registry check     → FAILED/)
      } finally {
        fakePortal.stop()
        fakeApp.stop()
      }
    })

    it('--health-path overrides the probe target', async () => {
      const fakeApp = startFakeApp({ rootStatus: 500 }) // root would fail; /healthz returns 200
      const appUrl = `http://localhost:${fakeApp.port}`
      const state: FakePortalState = {
        lastAuth: null,
        response: {
          status: 200,
          body: {
            app: {
              id: 'app-1', slug: 'fast', name: 'Fast', url: '__APP_URL__',
              status: 'active', handoffMode: 'one_time_code',
            },
            endpoints: [],
            ok: true,
          },
        },
      }
      const fakePortal = startFakePortal(state, appUrl)
      try {
        const res = await runCli([
          'smoketest',
          '--portal-url', `http://localhost:${fakePortal.port}`,
          '--app-slug', 'fast',
          '--health-path', '/healthz',
        ])
        expect(res.exitCode).toBe(0)
        expect(res.stdout).toContain('/healthz')
        expect(res.stdout).toContain('Smoketest OK.')
      } finally {
        fakePortal.stop()
        fakeApp.stop()
      }
    })

    it('exit 2 when --portal-url or --app-slug is missing', async () => {
      const res = await runCli(['smoketest', '--app-slug', 'fast'])
      expect(res.exitCode).toBe(2)
    })
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
