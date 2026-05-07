/**
 * `runSmoketest` — Spec 06 (Rev 4) PR B programmatic API.
 *
 * Wraps the portal's `POST /api/v1/apps/:slug/smoketest` route plus a
 * client-side `GET <app.url><healthPath>` probe so the CLI verb (and any
 * caller that prefers a function over a subprocess) can ask three questions
 * in one call:
 *
 *   1. Registry check — is the app registered, and is it active? Surfaces
 *      via the portal's response.app block; failure = 4xx from the portal.
 *   2. App URL reachable — `GET <app.url><healthPath>` returns 200 within
 *      the budget. Always attempted when step 1 succeeds, even if the
 *      portal call itself returned a non-OK overall flag — the appUrl probe
 *      is independent diagnosis.
 *   3. Webhook delivery — the portal already dispatched an `app.smoketest`
 *      envelope to every active webhook endpoint and returned per-endpoint
 *      status/latency in the response. We pass those results through
 *      verbatim; the CLI renders them.
 *
 * The function NEVER throws — all failures are encoded in the result object
 * so the CLI can render a step-by-step report. Network errors during the
 * portal call surface as registry.error; errors during the app probe
 * surface as appUrl.error.
 */

// ---------------------------------------------------------------------------
// Response shapes — must match apps/api/src/routes/app-smoketest.ts in the
// portal repo. If the portal route changes, this contract changes.
// ---------------------------------------------------------------------------

export interface SmoketestAppSummary {
  id: string
  slug: string
  name: string
  url: string
  status: string
  handoffMode: string
}

export interface SmoketestEndpointResult {
  endpointId: string
  url: string
  status: number | null
  latencyMs: number
  error?: string
}

interface PortalSmoketestResponse {
  app: SmoketestAppSummary
  endpoints: SmoketestEndpointResult[]
  ok: boolean
}

// ---------------------------------------------------------------------------
// Result shape returned to the CLI / programmatic callers.
// ---------------------------------------------------------------------------

export interface SmoketestStepRegistry {
  ok: boolean
  app?: SmoketestAppSummary
  error?: string
}

export interface SmoketestStepAppUrl {
  ok: boolean
  url?: string
  status?: number
  latencyMs?: number
  error?: string
}

export interface SmoketestStepWebhook {
  ok: boolean
  endpoints: SmoketestEndpointResult[]
  error?: string
}

export interface SmoketestResult {
  ok: boolean
  steps: {
    registry: SmoketestStepRegistry
    appUrl: SmoketestStepAppUrl
    webhook: SmoketestStepWebhook
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface RunSmoketestOptions {
  /** Portal base URL (no path). Trailing slash stripped. */
  portalUrl: string
  /** App slug — must match the portal's `app_registry.slug`. */
  appSlug: string
  /** OIDC ID-token minter. Audience is the portal base URL. */
  getIdToken: (audience: string) => Promise<string>
  /**
   * Optional fetch override. Defaults to the global `fetch`. Useful for
   * testing without mocking the global, or to thread a custom dispatcher.
   */
  fetch?: typeof fetch
  /**
   * Path to GET on the app's URL for step 2. Defaults to `/`. Override when
   * the app's root does not return 200 (e.g. it redirects to `/login`).
   */
  healthPath?: string
  /** Timeout for the app-URL probe. Default 5000ms. */
  appUrlTimeoutMs?: number
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export async function runSmoketest(options: RunSmoketestOptions): Promise<SmoketestResult> {
  const portalBase = options.portalUrl.replace(/\/+$/, '')
  const audience = portalBase
  const fetchImpl = options.fetch ?? fetch
  const healthPath = options.healthPath ?? '/'
  const timeoutMs = options.appUrlTimeoutMs ?? 5_000

  const result: SmoketestResult = {
    ok: false,
    steps: {
      registry: { ok: false },
      appUrl: { ok: false },
      webhook: { ok: true, endpoints: [] },
    },
  }

  // --- Step 1: portal smoketest call ---------------------------------------

  let portalBody: PortalSmoketestResponse
  try {
    const idToken = await options.getIdToken(audience)
    const url = `${portalBase}/api/v1/apps/${encodeURIComponent(options.appSlug)}/smoketest`
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: '{}',
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      result.steps.registry.error = `portal returned ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`
      return result
    }

    portalBody = (await res.json()) as PortalSmoketestResponse
    if (!portalBody?.app || !Array.isArray(portalBody.endpoints)) {
      result.steps.registry.error = 'portal returned a malformed smoketest response'
      return result
    }
  } catch (err) {
    result.steps.registry.error = err instanceof Error ? err.message : String(err)
    return result
  }

  result.steps.registry = { ok: true, app: portalBody.app }
  result.steps.webhook = {
    ok: portalBody.ok,
    endpoints: portalBody.endpoints,
  }

  // --- Step 2: app URL probe ----------------------------------------------

  const appBase = portalBody.app.url.replace(/\/+$/, '')
  const probeUrl = `${appBase}${healthPath.startsWith('/') ? healthPath : `/${healthPath}`}`
  const startedAt = performance.now()
  try {
    const res = await fetchImpl(probeUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    })
    const latencyMs = Math.round(performance.now() - startedAt)
    if (res.ok) {
      result.steps.appUrl = { ok: true, url: probeUrl, status: res.status, latencyMs }
    } else {
      result.steps.appUrl = {
        ok: false,
        url: probeUrl,
        status: res.status,
        latencyMs,
        error: `HTTP ${res.status} ${res.statusText}`,
      }
    }
  } catch (err) {
    const latencyMs = Math.round(performance.now() - startedAt)
    result.steps.appUrl = {
      ok: false,
      url: probeUrl,
      latencyMs,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  // --- Aggregate ----------------------------------------------------------

  result.ok =
    result.steps.registry.ok && result.steps.appUrl.ok && result.steps.webhook.ok

  return result
}
