import { describe, it, expect, beforeAll } from 'bun:test'
import {
  SignJWT,
  generateKeyPair,
  exportJWK,
  importJWK,
  type KeyLike,
} from 'jose'
import { verifyBrokerToken, BrokerTokenError } from '../broker-token.js'

// Shared test fixtures
const APP_SLUG = 'test-app'
const AUDIENCE = `portal:app:${APP_SLUG}`
const HS256_SECRET = 'super-secret-hs256-signing-key-minimum-length-ok'
const SECRET_BYTES = new TextEncoder().encode(HS256_SECRET)

const BASE_PAYLOAD = {
  appSlug: APP_SLUG,
  userId: 'user-123',
  gipUid: 'gip-uid-456',
  email: 'user@example.com',
  name: 'Test User',
  portalRole: 'member',
  teamIds: ['team-a'],
  apps: [APP_SLUG],
}

let es256PrivateKey: KeyLike
let es256PublicJwk: Record<string, unknown>
let mockJwksServer: { url: string; stop: () => void } | null = null

// Build a minimal in-process JWKS server for ES256 tests
async function startJwksServer(jwks: object): Promise<{ url: string; stop: () => void }> {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(JSON.stringify(jwks), {
        headers: { 'Content-Type': 'application/json' },
      })
    },
  })
  return {
    url: `http://localhost:${server.port}/.well-known/jwks.json`,
    stop: () => server.stop(),
  }
}

beforeAll(async () => {
  const kp = await generateKeyPair('ES256')
  es256PrivateKey = kp.privateKey
  const publicJwk = await exportJWK(kp.publicKey)
  es256PublicJwk = { ...publicJwk, kid: 'test-kid-1', use: 'sig' }

  mockJwksServer = await startJwksServer({ keys: [es256PublicJwk] })
})

function stopJwks() {
  mockJwksServer?.stop()
}

async function mintHS256(overrides: Partial<typeof BASE_PAYLOAD> = {}, expOverride?: number) {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ ...BASE_PAYLOAD, ...overrides })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('coms-portal-broker')
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(expOverride ?? now + 300)
    .sign(SECRET_BYTES)
}

async function mintES256(overrides: Partial<typeof BASE_PAYLOAD> = {}, expOverride?: number) {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ ...BASE_PAYLOAD, ...overrides })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-kid-1' })
    .setIssuer('https://coms.ahacommerce.net/broker')
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(expOverride ?? now + 300)
    .sign(es256PrivateKey)
}

// HS256 tests
describe('verifyBrokerToken — HS256', () => {
  it('verifies a valid HS256 token', async () => {
    const token = await mintHS256()
    const payload = await verifyBrokerToken(token, { appSlug: APP_SLUG, sharedSecret: HS256_SECRET })
    expect(payload.appSlug).toBe(APP_SLUG)
    expect(payload.email).toBe('user@example.com')
  })

  it('throws expired for an expired HS256 token', async () => {
    const now = Math.floor(Date.now() / 1000)
    const token = await mintHS256({}, now - 10)
    await expect(
      verifyBrokerToken(token, { appSlug: APP_SLUG, sharedSecret: HS256_SECRET }),
    ).rejects.toMatchObject({ code: 'expired' })
  })

  it('throws invalid_signature when secret is wrong', async () => {
    const token = await mintHS256()
    await expect(
      verifyBrokerToken(token, { appSlug: APP_SLUG, sharedSecret: 'wrong-secret' }),
    ).rejects.toMatchObject({ code: 'invalid_signature' })
  })

  it('throws invalid_audience when audience is wrong', async () => {
    const token = await mintHS256()
    await expect(
      verifyBrokerToken(token, { appSlug: 'other-app', sharedSecret: HS256_SECRET }),
    ).rejects.toMatchObject({ code: 'invalid_audience' })
  })

  it('throws malformed for a completely invalid token string', async () => {
    await expect(
      verifyBrokerToken('not.a.token', { appSlug: APP_SLUG, sharedSecret: HS256_SECRET }),
    ).rejects.toMatchObject({ code: 'malformed' })
  })

  it('throws malformed when HS256 token requires jwksUrl instead', async () => {
    const token = await mintHS256()
    // Using ES256 path without jwksUrl — should fail gracefully
    await expect(
      verifyBrokerToken(token, { appSlug: APP_SLUG, jwksUrl: 'http://unreachable/jwks.json' }),
    ).rejects.toBeInstanceOf(BrokerTokenError)
  })
})

// ES256 tests
describe('verifyBrokerToken — ES256', () => {
  it('verifies a valid ES256 token', async () => {
    const token = await mintES256()
    const payload = await verifyBrokerToken(token, {
      appSlug: APP_SLUG,
      jwksUrl: mockJwksServer!.url,
      issuer: 'https://coms.ahacommerce.net/broker',
    })
    expect(payload.appSlug).toBe(APP_SLUG)
  })

  it('throws expired for an expired ES256 token', async () => {
    const now = Math.floor(Date.now() / 1000)
    const token = await mintES256({}, now - 10)
    await expect(
      verifyBrokerToken(token, {
        appSlug: APP_SLUG,
        jwksUrl: mockJwksServer!.url,
        issuer: 'https://coms.ahacommerce.net/broker',
      }),
    ).rejects.toMatchObject({ code: 'expired' })
  })

  it('throws invalid_audience when audience is wrong', async () => {
    const token = await mintES256()
    await expect(
      verifyBrokerToken(token, {
        appSlug: 'other-app',
        jwksUrl: mockJwksServer!.url,
        issuer: 'https://coms.ahacommerce.net/broker',
      }),
    ).rejects.toMatchObject({ code: 'invalid_audience' })
  })

  it('throws invalid_issuer when issuer is wrong', async () => {
    const token = await mintES256()
    await expect(
      verifyBrokerToken(token, {
        appSlug: APP_SLUG,
        jwksUrl: mockJwksServer!.url,
        issuer: 'https://wrong-issuer.example.com/broker',
      }),
    ).rejects.toMatchObject({ code: 'invalid_issuer' })
  })

  it('throws missing_kid when kid header is absent', async () => {
    // Mint a token without kid header
    const now = Math.floor(Date.now() / 1000)
    const tokenNoKid = await new SignJWT(BASE_PAYLOAD)
      .setProtectedHeader({ alg: 'ES256' }) // no kid
      .setIssuer('https://coms.ahacommerce.net/broker')
      .setAudience(AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(es256PrivateKey)
    await expect(
      verifyBrokerToken(tokenNoKid, {
        appSlug: APP_SLUG,
        jwksUrl: mockJwksServer!.url,
        issuer: 'https://coms.ahacommerce.net/broker',
      }),
    ).rejects.toMatchObject({ code: 'missing_kid' })
  })

  it('throws unknown_kid when kid does not match JWKS', async () => {
    // Mint with an unknown kid
    const now = Math.floor(Date.now() / 1000)
    const tokenBadKid = await new SignJWT(BASE_PAYLOAD)
      .setProtectedHeader({ alg: 'ES256', kid: 'non-existent-kid' })
      .setIssuer('https://coms.ahacommerce.net/broker')
      .setAudience(AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(es256PrivateKey)
    await expect(
      verifyBrokerToken(tokenBadKid, {
        appSlug: APP_SLUG,
        jwksUrl: mockJwksServer!.url,
        issuer: 'https://coms.ahacommerce.net/broker',
      }),
    ).rejects.toMatchObject({ code: 'unknown_kid' })
  })

  it('accepts legacy bare-string issuer for dual-mode compat', async () => {
    const now = Math.floor(Date.now() / 1000)
    const token = await new SignJWT(BASE_PAYLOAD)
      .setProtectedHeader({ alg: 'ES256', kid: 'test-kid-1' })
      .setIssuer('coms-portal-broker') // legacy issuer
      .setAudience(AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(es256PrivateKey)

    const payload = await verifyBrokerToken(token, {
      appSlug: APP_SLUG,
      jwksUrl: mockJwksServer!.url,
      issuer: ['https://coms.ahacommerce.net/broker', 'coms-portal-broker'],
    })
    expect(payload.appSlug).toBe(APP_SLUG)
  })
})

describe('BrokerTokenError', () => {
  it('has correct name and code properties', async () => {
    try {
      const now = Math.floor(Date.now() / 1000)
      const token = await mintHS256({}, now - 10)
      await verifyBrokerToken(token, { appSlug: APP_SLUG, sharedSecret: HS256_SECRET })
    } catch (err) {
      expect(err).toBeInstanceOf(BrokerTokenError)
      expect((err as BrokerTokenError).name).toBe('BrokerTokenError')
      expect((err as BrokerTokenError).code).toBe('expired')
    }
  })
})
