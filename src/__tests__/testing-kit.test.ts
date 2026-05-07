import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mintTestBrokerToken, buildEnvelope, stubJwks } from '../testing/index.js'
import { verifyBrokerToken } from '../broker-token.js'
import { defineWebhookHandler } from '../webhook-typed.js'

describe('mintTestBrokerToken', () => {
  it('mints a valid ES256 token verifiable via stubJwks', async () => {
    const minted = await mintTestBrokerToken({
      appSlug: 'heroes',
      userId: 'user-1',
      portalRole: 'employee',
    })

    const stub = stubJwks({ keys: [minted.jwk] })
    try {
      const payload = await verifyBrokerToken(minted.token, {
        appSlug: 'heroes',
        jwksUrl: stub.url,
        issuer: minted.issuer,
      })
      expect(payload.appSlug).toBe('heroes')
      expect(payload.userId).toBe('user-1')
    } finally {
      stub.restore()
    }
  })

  it('mints an HS256 token verifiable with the same secret', async () => {
    const minted = await mintTestBrokerToken({
      alg: 'HS256',
      appSlug: 'orbit',
      userId: 'user-2',
    })

    const payload = await verifyBrokerToken(minted.token, {
      appSlug: 'orbit',
      sharedSecret: minted.sharedSecret!,
      issuer: minted.issuer,
    })
    expect(payload.userId).toBe('user-2')
  })

  it('respects expiresInSeconds (default 300)', async () => {
    const minted = await mintTestBrokerToken({
      appSlug: 'heroes',
      expiresInSeconds: 60,
    })
    const stub = stubJwks({ keys: [minted.jwk] })
    try {
      const payload = await verifyBrokerToken(minted.token, {
        appSlug: 'heroes',
        jwksUrl: stub.url,
        issuer: minted.issuer,
      })
      // exp is in seconds; should be ~60s in the future
      const now = Math.floor(Date.now() / 1000)
      expect(payload.exp! - now).toBeGreaterThan(50)
      expect(payload.exp! - now).toBeLessThanOrEqual(60)
    } finally {
      stub.restore()
    }
  })

  it('mints with sensible defaults when fields are omitted', async () => {
    const minted = await mintTestBrokerToken({})
    const stub = stubJwks({ keys: [minted.jwk] })
    try {
      const payload = await verifyBrokerToken(minted.token, {
        appSlug: minted.appSlug,
        jwksUrl: stub.url,
        issuer: minted.issuer,
      })
      expect(typeof payload.userId).toBe('string')
      expect(typeof payload.appSlug).toBe('string')
    } finally {
      stub.restore()
    }
  })
})

describe('buildEnvelope', () => {
  it('builds a user.provisioned envelope with the supplied payload', () => {
    const env = buildEnvelope('user.provisioned', {
      userId: 'u',
      gipUid: 'g',
      email: 'a@b.com',
      name: 'A',
      portalRole: 'employee',
      teamIds: [],
      apps: ['heroes'],
      appRole: null,
    })
    expect(env.event).toBe('user.provisioned')
    expect(env.payload.userId).toBe('u')
    expect(env.contractVersion).toBe(1)
    expect(typeof env.eventId).toBe('string')
    expect(typeof env.occurredAt).toBe('string')
  })

  it('overrides defaults from opts', () => {
    const env = buildEnvelope(
      'user.offboarded',
      {
        userId: 'u',
        gipUid: 'g',
        email: 'a@b.com',
        offboardedAt: '2026-05-07T00:00:00.000Z',
      },
      { appSlug: 'orbit', eventId: 'evt-fixed', occurredAt: '2026-01-01T00:00:00.000Z' },
    )
    expect(env.appSlug).toBe('orbit')
    expect(env.eventId).toBe('evt-fixed')
    expect(env.occurredAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('integrates with defineWebhookHandler dispatch', async () => {
    let captured: unknown = null
    const dispatch = defineWebhookHandler({
      'user.provisioned': async ({ payload }) => {
        captured = payload
      },
    })

    const env = buildEnvelope('user.provisioned', {
      userId: 'u',
      gipUid: 'g',
      email: 'a@b.com',
      name: 'A',
      portalRole: 'employee',
      teamIds: [],
      apps: ['heroes'],
      appRole: null,
    })

    await dispatch(env)
    expect((captured as { userId?: string })?.userId).toBe('u')
  })
})

describe('stubJwks', () => {
  it('serves the supplied JWKS at the returned URL until restore is called', async () => {
    const jwks = { keys: [{ kty: 'EC', kid: 'fake', alg: 'ES256' }] as Record<string, unknown>[] }
    const stub = stubJwks(jwks)
    try {
      const res = await fetch(stub.url)
      const body = await res.json() as Record<string, unknown>
      expect((body.keys as unknown[]).length).toBe(1)
    } finally {
      stub.restore()
    }
  })

  it('multiple stubs do not collide (each gets its own URL)', () => {
    const a = stubJwks({ keys: [] })
    const b = stubJwks({ keys: [] })
    try {
      expect(a.url).not.toBe(b.url)
    } finally {
      a.restore()
      b.restore()
    }
  })
})
