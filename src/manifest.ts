// ---------------------------------------------------------------------------
// Manifest definition shape — mirrors the portal's services/manifests.ts
// ManifestDefinition. Repeated here (rather than re-exported from
// `@coms-portal/shared`) because that contract package's
// `PortalIntegrationManifest` is a richer descriptor (adapters, routes,
// compliance metadata) used at deploy time, while this is the lean runtime
// shape the portal's `app_manifests` table actually stores.
// ---------------------------------------------------------------------------

export type FieldType = 'enum' | 'boolean' | 'integer' | 'string'

export interface EnumField {
  type: 'enum'
  values: string[]
  default: string
}

export interface BooleanField {
  type: 'boolean'
  default: boolean
}

export interface IntegerField {
  type: 'integer'
  default: number
}

export interface StringField {
  type: 'string'
  default: string
}

export type ConfigField = EnumField | BooleanField | IntegerField | StringField

export interface ManifestDefinition {
  appId: string
  displayName: string
  schemaVersion: number
  configSchema: Record<string, ConfigField>
  /**
   * Spec 07: `taxonomy_id`s the H-app subscribes to. Portal uses this for
   * initial sync at registration time and webhook fan-out (only fires
   * taxonomy events for taxonomies the app has declared). Defaults to `[]`
   * when omitted.
   */
  taxonomies?: string[]
}

// ---------------------------------------------------------------------------
// defineManifest — author-time identity helper
// ---------------------------------------------------------------------------

/**
 * Identity function that constrains the input type at H-app build time.
 * Lets H-app authors get TypeScript-checked manifest field shapes without
 * any runtime cost or validation. Use this in `portal-manifest.ts` so the
 * type system catches drift from the {@link ManifestDefinition} contract
 * before the manifest hits the wire.
 *
 *   import { defineManifest } from '@coms-portal/sdk'
 *
 *   export default defineManifest({
 *     appId: 'heroes',
 *     displayName: 'Heroes',
 *     schemaVersion: 2,
 *     configSchema: { ... },
 *     taxonomies: ['team', 'department'],
 *   })
 */
export function defineManifest(definition: ManifestDefinition): ManifestDefinition {
  return definition
}

// ---------------------------------------------------------------------------
// registerManifest — runtime client (CD-pipeline path)
// ---------------------------------------------------------------------------

export interface RegisterManifestResponse {
  schemaVersion: number
  registeredAt: string
}

export interface RegisterManifestOptions {
  /**
   * Portal base URL (no path). Trailing slash is stripped. Example:
   * `https://coms.ahacommerce.net`.
   */
  portalUrl: string
  /**
   * The manifest produced by {@link defineManifest}, or any object matching
   * {@link ManifestDefinition}.
   */
  manifest: ManifestDefinition
  /**
   * Optional override for the OIDC ID-token minter. Defaults to a lazy
   * `google-auth-library` import that uses Application Default Credentials
   * — works automatically on Cloud Run / Cloud Build / GCE workloads. Pass
   * a custom function in tests, or to thread the call through your own
   * auth library.
   */
  getIdToken?: (audience: string) => Promise<string>
  /**
   * Optional fetch override. Defaults to the global `fetch`. Useful for
   * testing without mocking the global, or to plumb in a fetch with a
   * custom dispatcher / retry policy. Typed as the minimal subset the SDK
   * actually uses so test fakes do not need to implement `Headers.preconnect`
   * etc.
   */
  fetch?: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<Response>
}

async function defaultGetIdToken(audience: string): Promise<string> {
  // Lazy import so consumers without `google-auth-library` installed (e.g.
  // tests passing a custom `getIdToken`) do not pay the load cost or trip a
  // missing-module error. H-apps using the default path must add it as a
  // runtime dependency in their own package.json.
  const mod = await import('google-auth-library')
  const auth = new mod.GoogleAuth()
  const client = await auth.getIdTokenClient(audience)
  const headers = await client.getRequestHeaders()
  // getRequestHeaders returns a Web Headers instance on Node 20+; older
  // shapes return a plain object. Handle both.
  let bearer: string | undefined
  if (headers instanceof Headers) {
    bearer = headers.get('Authorization') ?? undefined
  } else if (headers && typeof headers === 'object') {
    bearer = (headers as Record<string, string>).Authorization
  }
  if (!bearer || !bearer.startsWith('Bearer ')) {
    throw new Error('google-auth-library returned no Bearer token')
  }
  return bearer.slice('Bearer '.length)
}

/**
 * POST the H-app's manifest to the portal's
 * `POST /api/v1/apps/:slug/manifest` endpoint. Idempotent on the portal
 * side — the second call with the same `schemaVersion` is a no-op (or a
 * forward-only schemaVersion bump) thanks to the existing
 * `GREATEST(schemaVersion)` non-regression rule.
 *
 * Authentication: a Google OIDC ID token whose audience equals the
 * `portalUrl` argument. The portal verifies the token via its
 * `requireAppToken` middleware (the same path used by `/api/users` and
 * `/api/taxonomies`).
 *
 * Throws on any non-2xx response or network error. The caller is the CLI
 * `coms-portal-cli register-manifest`, so the thrown error becomes an exit
 * code (see `src/cli.ts` PR E).
 */
export async function registerManifest(
  options: RegisterManifestOptions,
): Promise<RegisterManifestResponse> {
  const portalBase = options.portalUrl.replace(/\/+$/, '')
  const url = `${portalBase}/api/v1/apps/${encodeURIComponent(options.manifest.appId)}/manifest`
  const audience = portalBase

  const getIdToken = options.getIdToken ?? defaultGetIdToken
  const idToken = await getIdToken(audience)

  const fetchImpl = options.fetch ?? ((u, init) => fetch(u, init))
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(options.manifest),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`registerManifest: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`)
  }

  const body = (await res.json()) as RegisterManifestResponse
  if (typeof body?.schemaVersion !== 'number' || typeof body?.registeredAt !== 'string') {
    throw new Error('registerManifest: malformed response — expected { schemaVersion: number, registeredAt: string }')
  }
  return body
}
