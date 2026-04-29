/**
 * Thin HTTP client helpers for COMS portal API endpoints.
 *
 * Each function accepts a `ComsClient` configuration object (base URL +
 * optional fetch override + optional broker token) rather than a class
 * instance — keeping the SDK framework-neutral.
 */

export type ComsClient = {
  /** Base URL of the COMS portal API, e.g. https://coms.ahacommerce.net */
  baseUrl: string
  /** Optional fetch implementation. Defaults to global fetch. */
  fetch?: typeof fetch
  /** Broker token to include in Authorization header. */
  brokerToken?: string
}

export type AliasResult = {
  input: string
  match: {
    portalSub: string
    aliasId: string
    isPrimary: boolean
    tombstoned: boolean
    deactivatedAt: string | null
  } | null
}

export type ResolveAliasResponse = {
  results: AliasResult[]
  /** Rate-limit headers from the server, if present. */
  rateLimitHeaders: Record<string, string>
}

/**
 * POST /api/aliases/resolve-batch
 *
 * Resolves up to 1000 alias names in one call. Exposes rate-limit
 * response headers in the return value.
 */
export async function resolveAlias(
  client: ComsClient,
  names: string[],
): Promise<ResolveAliasResponse> {
  const fetcher = client.fetch ?? fetch
  const url = `${client.baseUrl}/api/aliases/resolve-batch`

  const res = await fetcher(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(client.brokerToken ? { Authorization: `Bearer ${client.brokerToken}` } : {}),
    },
    body: JSON.stringify({ names }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`resolveAlias failed: ${res.status} ${res.statusText} — ${body}`)
  }

  const data = (await res.json()) as { results: AliasResult[] }

  const rateLimitHeaders: Record<string, string> = {}
  for (const key of ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after']) {
    const value = res.headers.get(key)
    if (value !== null) rateLimitHeaders[key] = value
  }

  return { results: data.results, rateLimitHeaders }
}

export type SessionUser = {
  id: string
  gipUid: string
  email: string
  name: string
  portalRole: string
  teamIds: string[]
  apps: string[]
}

export type IntrospectSessionResponse =
  | { active: true; user: SessionUser }
  | { active: false; revokedAt?: string; reason?: string }

/**
 * POST /api/auth/broker/introspect
 *
 * Check whether a user session is still active. Authenticated via the
 * app's OIDC token (passed as brokerToken in the client).
 */
export async function introspectSession(
  client: ComsClient,
  params: { userId: string; sessionIssuedAt: string; appSlug: string },
): Promise<IntrospectSessionResponse> {
  const fetcher = client.fetch ?? fetch
  const url = `${client.baseUrl}/api/auth/broker/introspect`

  const res = await fetcher(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(client.brokerToken ? { Authorization: `Bearer ${client.brokerToken}` } : {}),
    },
    body: JSON.stringify(params),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`introspectSession failed: ${res.status} ${res.statusText} — ${body}`)
  }

  return res.json() as Promise<IntrospectSessionResponse>
}

export type AuditLogEntry = {
  id: string
  actorId: string
  action: string
  targetType: string | null
  targetId: string | null
  details: unknown
  requestId: string | null
  createdAt: string
}

export type GetAuditLogParams = {
  from?: string
  to?: string
  cursor?: string
  limit?: number
}

export type GetAuditLogResponse = {
  entries: AuditLogEntry[]
  nextCursor: string | null
}

/**
 * GET /api/v1/audit-log
 *
 * Retrieve audit log entries scoped to the calling app's tenant.
 * Authenticated via the app's broker token (passed as brokerToken in the client).
 */
export async function getAuditLog(
  client: ComsClient,
  params: GetAuditLogParams = {},
): Promise<GetAuditLogResponse> {
  const fetcher = client.fetch ?? fetch
  const url = new URL(`${client.baseUrl}/api/v1/audit-log`)

  if (params.from !== undefined) url.searchParams.set('from', params.from)
  if (params.to !== undefined) url.searchParams.set('to', params.to)
  if (params.cursor !== undefined) url.searchParams.set('cursor', params.cursor)
  if (params.limit !== undefined) url.searchParams.set('limit', String(params.limit))

  const res = await fetcher(url.toString(), {
    method: 'GET',
    headers: {
      ...(client.brokerToken ? { Authorization: `Bearer ${client.brokerToken}` } : {}),
    },
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`getAuditLog failed: ${res.status} ${res.statusText} — ${body}`)
  }

  return res.json() as Promise<GetAuditLogResponse>
}
