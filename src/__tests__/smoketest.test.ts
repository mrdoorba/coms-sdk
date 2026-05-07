import { describe, it, expect, beforeEach } from 'bun:test'
import { runSmoketest } from '../smoketest.js'
import type { SmoketestResult } from '../smoketest.js'

// ---------------------------------------------------------------------------
// Mock fetch: the smoketest function calls two endpoints —
//   1. POST <portalUrl>/api/v1/apps/:slug/smoketest      (the portal route)
//   2. GET <app.url><healthPath>                         (the app's own URL)
// We capture both and let each test override the response per-URL.
// ---------------------------------------------------------------------------

interface CapturedRequest {
  url: string
  method: string
  headers: Record<string, string>
  body: string | undefined
}

let captured: CapturedRequest[] = []
let routeMap: Map<string, () => Response | Promise<Response>> = new Map()

function makeFetch() {
  return (async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const headers: Record<string, string> = {}
    const h = init?.headers
    if (h instanceof Headers) {
      h.forEach((v, k) => {
        if (k) headers[k.toLowerCase()] = v
      })
    } else if (Array.isArray(h)) {
      for (const pair of h) {
        if (!pair) continue
        const [k, v] = pair
        if (typeof k === 'string') headers[k.toLowerCase()] = String(v ?? '')
      }
    } else if (h) {
      for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = String(v)
    }
    captured.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    })
    // Match by URL prefix — the second test's app GET hits `https://fast.example.com/`.
    for (const [prefix, handler] of routeMap) {
      if (url.startsWith(prefix)) return await handler()
    }
    return new Response('no route', { status: 599 })
  }) as typeof fetch
}

function mockRoute(prefix: string, handler: () => Response | Promise<Response>) {
  routeMap.set(prefix, handler)
}

const PORTAL_URL = 'https://coms.example.com'
const APP_URL = 'https://fast.example.com'

const okPortalBody = {
  app: {
    id: 'app-uuid-1',
    slug: 'fast',
    name: 'Fast',
    url: APP_URL,
    status: 'active',
    handoffMode: 'one_time_code',
  },
  endpoints: [
    {
      endpointId: 'ep-1',
      url: `${APP_URL}/webhook`,
      status: 200,
      latencyMs: 87,
    },
  ],
  ok: true,
}

beforeEach(() => {
  captured = []
  routeMap = new Map()
})

describe('runSmoketest — programmatic API', () => {
  it('returns ok=true when portal, app URL, and all endpoints succeed', async () => {
    mockRoute(`${PORTAL_URL}/api/v1/apps/fast/smoketest`, () =>
      new Response(JSON.stringify(okPortalBody), { status: 200 }),
    )
    mockRoute(`${APP_URL}/`, () => new Response('', { status: 200 }))

    const result: SmoketestResult = await runSmoketest({
      portalUrl: PORTAL_URL,
      appSlug: 'fast',
      getIdToken: async () => 'fake-id-token',
      fetch: makeFetch(),
    })

    expect(result.ok).toBe(true)
    expect(result.steps.registry.ok).toBe(true)
    expect(result.steps.registry.app?.slug).toBe('fast')
    expect(result.steps.registry.app?.handoffMode).toBe('one_time_code')
    expect(result.steps.appUrl.ok).toBe(true)
    expect(result.steps.appUrl.status).toBe(200)
    expect(typeof result.steps.appUrl.latencyMs).toBe('number')
    expect(result.steps.webhook.ok).toBe(true)
    expect(result.steps.webhook.endpoints.length).toBe(1)
    expect(result.steps.webhook.endpoints[0]?.status).toBe(200)
  })

  it('passes the OIDC ID token in the Authorization header on the portal POST', async () => {
    mockRoute(`${PORTAL_URL}/api/v1/apps/fast/smoketest`, () =>
      new Response(JSON.stringify(okPortalBody), { status: 200 }),
    )
    mockRoute(`${APP_URL}/`, () => new Response('', { status: 200 }))

    await runSmoketest({
      portalUrl: PORTAL_URL,
      appSlug: 'fast',
      getIdToken: async (audience) => `token-for-${audience}`,
      fetch: makeFetch(),
    })

    const portalCall = captured.find((c) => c.url.includes('/smoketest'))!
    expect(portalCall.headers['authorization']).toBe(`Bearer token-for-${PORTAL_URL}`)
    expect(portalCall.method).toBe('POST')
  })

  it('strips a trailing slash on portalUrl when constructing the endpoint', async () => {
    mockRoute(`${PORTAL_URL}/api/v1/apps/fast/smoketest`, () =>
      new Response(JSON.stringify(okPortalBody), { status: 200 }),
    )
    mockRoute(`${APP_URL}/`, () => new Response('', { status: 200 }))

    await runSmoketest({
      portalUrl: `${PORTAL_URL}/`,
      appSlug: 'fast',
      getIdToken: async () => 't',
      fetch: makeFetch(),
    })

    const portalCall = captured.find((c) => c.url.includes('/smoketest'))!
    expect(portalCall.url).toBe(`${PORTAL_URL}/api/v1/apps/fast/smoketest`)
  })

  it('step 1 fails when the portal returns 404 (app not registered)', async () => {
    mockRoute(`${PORTAL_URL}/api/v1/apps/missing/smoketest`, () =>
      new Response(
        JSON.stringify({ error: 'app_not_registered', reason: "No app_registry row for slug 'missing'" }),
        { status: 404 },
      ),
    )

    const result = await runSmoketest({
      portalUrl: PORTAL_URL,
      appSlug: 'missing',
      getIdToken: async () => 't',
      fetch: makeFetch(),
    })

    expect(result.ok).toBe(false)
    expect(result.steps.registry.ok).toBe(false)
    expect(result.steps.registry.error).toMatch(/not registered|404/i)
    // App-URL probe and webhook fan-out should NOT have been attempted.
    expect(result.steps.appUrl.ok).toBe(false)
    expect(result.steps.appUrl.status).toBeUndefined()
    expect(result.steps.webhook.endpoints.length).toBe(0)
    // Only one outbound request — the portal call.
    expect(captured.length).toBe(1)
  })

  it('step 1 fails on 409 (app not active)', async () => {
    mockRoute(`${PORTAL_URL}/api/v1/apps/deprecated-app/smoketest`, () =>
      new Response(
        JSON.stringify({
          error: 'app_not_active',
          reason: "app_registry.status is 'deprecated', expected 'active'",
        }),
        { status: 409 },
      ),
    )

    const result = await runSmoketest({
      portalUrl: PORTAL_URL,
      appSlug: 'deprecated-app',
      getIdToken: async () => 't',
      fetch: makeFetch(),
    })

    expect(result.ok).toBe(false)
    expect(result.steps.registry.ok).toBe(false)
    expect(result.steps.registry.error).toMatch(/not active|409/i)
  })

  it('step 2 fails when the app URL is unreachable (network error)', async () => {
    mockRoute(`${PORTAL_URL}/api/v1/apps/fast/smoketest`, () =>
      new Response(JSON.stringify(okPortalBody), { status: 200 }),
    )
    mockRoute(`${APP_URL}/`, () => {
      throw new Error('ECONNREFUSED')
    })

    const result = await runSmoketest({
      portalUrl: PORTAL_URL,
      appSlug: 'fast',
      getIdToken: async () => 't',
      fetch: makeFetch(),
    })

    expect(result.ok).toBe(false)
    expect(result.steps.registry.ok).toBe(true)
    expect(result.steps.appUrl.ok).toBe(false)
    expect(result.steps.appUrl.error).toContain('ECONNREFUSED')
    // Step 3 still surfaces because the portal already dispatched and returned
    // its results — they're informational regardless of step 2's outcome.
    expect(result.steps.webhook.ok).toBe(true)
  })

  it('step 2 fails when the app URL returns non-200', async () => {
    mockRoute(`${PORTAL_URL}/api/v1/apps/fast/smoketest`, () =>
      new Response(JSON.stringify(okPortalBody), { status: 200 }),
    )
    mockRoute(`${APP_URL}/`, () => new Response('Not Found', { status: 404 }))

    const result = await runSmoketest({
      portalUrl: PORTAL_URL,
      appSlug: 'fast',
      getIdToken: async () => 't',
      fetch: makeFetch(),
    })

    expect(result.ok).toBe(false)
    expect(result.steps.appUrl.ok).toBe(false)
    expect(result.steps.appUrl.status).toBe(404)
  })

  it('respects healthPath override', async () => {
    mockRoute(`${PORTAL_URL}/api/v1/apps/fast/smoketest`, () =>
      new Response(JSON.stringify(okPortalBody), { status: 200 }),
    )
    mockRoute(`${APP_URL}/healthz`, () => new Response('', { status: 200 }))

    const result = await runSmoketest({
      portalUrl: PORTAL_URL,
      appSlug: 'fast',
      getIdToken: async () => 't',
      fetch: makeFetch(),
      healthPath: '/healthz',
    })

    expect(result.ok).toBe(true)
    const appCall = captured.find((c) => c.url.startsWith(APP_URL))!
    expect(appCall.url).toBe(`${APP_URL}/healthz`)
  })

  it('step 3 fails when the portal reports ok=false (an endpoint did not ack 2xx)', async () => {
    const failedBody = {
      ...okPortalBody,
      ok: false,
      endpoints: [
        {
          endpointId: 'ep-broken',
          url: `${APP_URL}/broken`,
          status: 500,
          latencyMs: 142,
          error: 'HTTP 500 Server Error',
        },
      ],
    }
    mockRoute(`${PORTAL_URL}/api/v1/apps/fast/smoketest`, () =>
      new Response(JSON.stringify(failedBody), { status: 200 }),
    )
    mockRoute(`${APP_URL}/`, () => new Response('', { status: 200 }))

    const result = await runSmoketest({
      portalUrl: PORTAL_URL,
      appSlug: 'fast',
      getIdToken: async () => 't',
      fetch: makeFetch(),
    })

    expect(result.ok).toBe(false)
    expect(result.steps.webhook.ok).toBe(false)
    expect(result.steps.webhook.endpoints[0]?.status).toBe(500)
    expect(result.steps.webhook.endpoints[0]?.error).toContain('500')
  })

  it('step 1 fails on 401 / 403 — auth failure surfaces from getIdToken or portal', async () => {
    mockRoute(`${PORTAL_URL}/api/v1/apps/fast/smoketest`, () =>
      new Response(JSON.stringify({ error: 'unauthorized', reason: 'missing_token' }), { status: 401 }),
    )

    const result = await runSmoketest({
      portalUrl: PORTAL_URL,
      appSlug: 'fast',
      getIdToken: async () => 't',
      fetch: makeFetch(),
    })

    expect(result.ok).toBe(false)
    expect(result.steps.registry.ok).toBe(false)
    expect(result.steps.registry.error).toMatch(/401|unauthorized/i)
  })

  it('zero registered endpoints — step 3 ok=true vacuously, overall ok depends on steps 1 & 2', async () => {
    const noEndpointsBody = { ...okPortalBody, endpoints: [], ok: true }
    mockRoute(`${PORTAL_URL}/api/v1/apps/fast/smoketest`, () =>
      new Response(JSON.stringify(noEndpointsBody), { status: 200 }),
    )
    mockRoute(`${APP_URL}/`, () => new Response('', { status: 200 }))

    const result = await runSmoketest({
      portalUrl: PORTAL_URL,
      appSlug: 'fast',
      getIdToken: async () => 't',
      fetch: makeFetch(),
    })

    expect(result.ok).toBe(true)
    expect(result.steps.webhook.endpoints).toEqual([])
    expect(result.steps.webhook.ok).toBe(true)
  })
})
