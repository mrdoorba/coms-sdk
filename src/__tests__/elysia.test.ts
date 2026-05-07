import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { Elysia } from 'elysia'
import { SignJWT, generateKeyPair, exportJWK } from 'jose'
import { requireBrokerAuth } from '../elysia.js'

const APP_SLUG = 'heroes'
const AUDIENCE = `portal:app:${APP_SLUG}`
const ISSUER = 'https://coms.ahacommerce.net/broker'

let privateKey: CryptoKey
let publicJwk: Record<string, unknown>
let mockJwksServer: { url: string; stop: () => void }

beforeAll(async () => {
  const kp = await generateKeyPair('ES256')
  privateKey = kp.privateKey
  publicJwk = await exportJWK(kp.publicKey) as Record<string, unknown>
  publicJwk.kid = 'test-kid-1'
  publicJwk.alg = 'ES256'
  publicJwk.use = 'sig'

  const server = Bun.serve({
    port: 0,
    fetch: () =>
      new Response(JSON.stringify({ keys: [publicJwk] }), {
        headers: { 'Content-Type': 'application/json' },
      }),
  })
  mockJwksServer = { url: `http://localhost:${server.port}`, stop: () => server.stop() }
})

afterAll(() => mockJwksServer.stop())

async function mintToken(overrides: Record<string, unknown> = {}, expSecs = 300) {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({
    appSlug: APP_SLUG,
    userId: 'user-1',
    gipUid: 'gip-1',
    email: 'a@b.com',
    name: 'A',
    portalRole: 'employee',
    teamIds: ['team-a'],
    apps: [APP_SLUG],
    ...overrides,
  })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-kid-1' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + expSecs)
    .sign(privateKey)
}

function makeApp() {
  return new Elysia()
    .use(
      requireBrokerAuth({
        appSlug: APP_SLUG,
        jwksUrl: mockJwksServer.url,
        issuer: ISSUER,
      }),
    )
    .get('/me', ({ user }) => ({
      userId: user.userId,
      portalRole: user.portalRole,
    }))
}

describe('requireBrokerAuth (Elysia plugin)', () => {
  it('attaches `user: BrokerTokenPayload` to the route context on a valid token', async () => {
    const app = makeApp()
    const token = await mintToken()

    const res = await app.handle(
      new Request('http://localhost/me', {
        headers: { Authorization: `Bearer ${token}` },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.userId).toBe('user-1')
    expect(body.portalRole).toBe('employee')
  })

  it('returns 401 with structured error when Authorization is missing', async () => {
    const app = makeApp()
    const res = await app.handle(new Request('http://localhost/me'))
    expect(res.status).toBe(401)
    const body = await res.json() as Record<string, unknown>
    expect(body.error).toBe('unauthorized')
    expect(body.code).toBe('missing_token')
  })

  it('returns 401 when Authorization header is not a Bearer token', async () => {
    const app = makeApp()
    const res = await app.handle(
      new Request('http://localhost/me', { headers: { Authorization: 'Basic xyz' } }),
    )
    expect(res.status).toBe(401)
    const body = await res.json() as Record<string, unknown>
    expect(body.code).toBe('missing_token')
  })

  it('returns 401 with the BrokerTokenError code on a bad token', async () => {
    const app = makeApp()
    const res = await app.handle(
      new Request('http://localhost/me', { headers: { Authorization: 'Bearer not.a.token' } }),
    )
    expect(res.status).toBe(401)
    const body = await res.json() as Record<string, unknown>
    expect(body.error).toBe('unauthorized')
    expect(typeof body.code).toBe('string')
  })

  it('returns 401 expired on an expired token', async () => {
    const app = makeApp()
    const token = await mintToken({}, -10)
    const res = await app.handle(
      new Request('http://localhost/me', { headers: { Authorization: `Bearer ${token}` } }),
    )
    expect(res.status).toBe(401)
    const body = await res.json() as Record<string, unknown>
    expect(body.code).toBe('expired')
  })

  it('returns 401 invalid_audience for a token issued for a different app', async () => {
    const app = makeApp()
    const token = await mintToken({ appSlug: 'orbit' })

    // Token is signed for AUDIENCE=portal:app:heroes regardless of payload
    // (audience is in the JWT claims, set by setAudience at signing time).
    // Re-sign with a different audience to actually test the path:
    const now = Math.floor(Date.now() / 1000)
    const otherToken = await new SignJWT({ appSlug: APP_SLUG, userId: 'u', gipUid: 'g', email: 'a@b.com', name: 'A', portalRole: 'employee', teamIds: [], apps: [APP_SLUG] })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-kid-1' })
      .setIssuer(ISSUER)
      .setAudience('portal:app:orbit')
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .sign(privateKey)
    void token

    const res = await app.handle(
      new Request('http://localhost/me', { headers: { Authorization: `Bearer ${otherToken}` } }),
    )
    expect(res.status).toBe(401)
    const body = await res.json() as Record<string, unknown>
    expect(body.code).toBe('invalid_audience')
  })
})
