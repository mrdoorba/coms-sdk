import { describe, it, expect } from 'bun:test'
import { mintTestBrokerToken, stubJwks } from '@coms-portal/sdk/testing'
import { buildApp } from './server.ts'

describe('onboarding-scratch — Spec 01 §Surface sample H-app integration', () => {
  it('GET /me returns the portal user encoded in the broker token', async () => {
    const minted = await mintTestBrokerToken({
      appSlug: 'heroes',
      userId: 'usr_h_001',
      portalRole: 'manager',
    })
    const jwks = stubJwks({ keys: [minted.jwk] })

    try {
      const app = buildApp({
        jwksUrl: jwks.url,
        issuer: minted.issuer,
        webhookSecret: 'irrelevant-for-this-test',
      })

      const res = await app.handle(
        new Request('http://localhost/me', {
          headers: { Authorization: `Bearer ${minted.token}` },
        }),
      )
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ portalSub: 'usr_h_001', role: 'manager' })
    } finally {
      jwks.restore()
    }
  })
})
