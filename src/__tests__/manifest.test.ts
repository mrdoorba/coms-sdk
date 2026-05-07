import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { defineManifest, registerManifest } from '../manifest.js'
import type { ManifestDefinition } from '../manifest.js'

const validManifest: ManifestDefinition = {
  appId: 'heroes',
  displayName: 'Heroes',
  schemaVersion: 2,
  configSchema: {
    weeklyDigestDay: { type: 'enum', values: ['mon', 'tue', 'wed', 'thu', 'fri'], default: 'fri' },
    notifyOnAssignment: { type: 'boolean', default: true },
  },
  taxonomies: ['team', 'department'],
}

describe('defineManifest', () => {
  it('is the identity function (returns its input verbatim)', () => {
    const result = defineManifest(validManifest)
    expect(result).toBe(validManifest)
  })

  it('preserves all field shapes — enum, boolean, integer, string', () => {
    const m = defineManifest({
      appId: 'orbit',
      displayName: 'Orbit',
      schemaVersion: 2,
      configSchema: {
        e: { type: 'enum', values: ['a', 'b'], default: 'a' },
        b: { type: 'boolean', default: false },
        i: { type: 'integer', default: 42 },
        s: { type: 'string', default: 'hello' },
      },
    })
    expect(m.configSchema.e!.type).toBe('enum')
    expect(m.configSchema.b!.type).toBe('boolean')
    expect(m.configSchema.i!.type).toBe('integer')
    expect(m.configSchema.s!.type).toBe('string')
  })
})

describe('registerManifest', () => {
  let lastFetchCall: { url: string; init: { method: string; headers: Record<string, string>; body: string } } | null = null
  let mockFetchResponse = new Response(
    JSON.stringify({ schemaVersion: 2, registeredAt: '2026-05-07T12:00:00.000Z' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )

  type FetchImpl = NonNullable<Parameters<typeof registerManifest>[0]['fetch']>
  const mockFetch: FetchImpl = ((
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ) => {
    lastFetchCall = { url, init }
    return Promise.resolve(mockFetchResponse.clone())
  }) as unknown as FetchImpl

  beforeEach(() => {
    lastFetchCall = null
    mockFetchResponse = new Response(
      JSON.stringify({ schemaVersion: 2, registeredAt: '2026-05-07T12:00:00.000Z' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  })

  it('POSTs to /v1/apps/:slug/manifest with the manifest body', async () => {
    const result = await registerManifest({
      portalUrl: 'https://coms.ahacommerce.net',
      manifest: validManifest,
      getIdToken: async () => 'fake-id-token',
      fetch: mockFetch,
    })

    expect(result.schemaVersion).toBe(2)
    expect(result.registeredAt).toBe('2026-05-07T12:00:00.000Z')
    expect(lastFetchCall?.url).toBe('https://coms.ahacommerce.net/api/v1/apps/heroes/manifest')
    expect(lastFetchCall?.init?.method).toBe('POST')
    const body = JSON.parse(lastFetchCall?.init?.body as string)
    expect(body.appId).toBe('heroes')
    expect(body.taxonomies).toEqual(['team', 'department'])
  })

  it('passes the OIDC ID token in the Authorization header', async () => {
    await registerManifest({
      portalUrl: 'https://coms.ahacommerce.net',
      manifest: validManifest,
      getIdToken: async (audience) => `token-for-${audience}`,
      fetch: mockFetch,
    })
    const auth = (lastFetchCall?.init?.headers as Record<string, string>)['Authorization']
    expect(auth).toBe('Bearer token-for-https://coms.ahacommerce.net')
  })

  it('strips a trailing slash on portalUrl when constructing the endpoint', async () => {
    await registerManifest({
      portalUrl: 'https://coms.ahacommerce.net/',
      manifest: validManifest,
      getIdToken: async () => 't',
      fetch: mockFetch,
    })
    expect(lastFetchCall?.url).toBe('https://coms.ahacommerce.net/api/v1/apps/heroes/manifest')
  })

  it('throws on a non-2xx response with the body text', async () => {
    mockFetchResponse = new Response(
      JSON.stringify({ error: 'app_slug_mismatch' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    )
    await expect(
      registerManifest({
        portalUrl: 'https://coms.ahacommerce.net',
        manifest: validManifest,
        getIdToken: async () => 't',
        fetch: mockFetch,
      }),
    ).rejects.toThrow(/409/)
  })

  it('throws when the response body is not JSON', async () => {
    mockFetchResponse = new Response('not json', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
    await expect(
      registerManifest({
        portalUrl: 'https://coms.ahacommerce.net',
        manifest: validManifest,
        getIdToken: async () => 't',
        fetch: mockFetch,
      }),
    ).rejects.toThrow()
  })

  it('propagates getIdToken errors (e.g. no GCP creds)', async () => {
    await expect(
      registerManifest({
        portalUrl: 'https://coms.ahacommerce.net',
        manifest: validManifest,
        getIdToken: async () => {
          throw new Error('Could not load the default credentials')
        },
        fetch: mockFetch,
      }),
    ).rejects.toThrow(/credentials/i)
  })
})
