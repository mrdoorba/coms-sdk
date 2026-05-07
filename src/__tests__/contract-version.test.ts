import { describe, it, expect } from 'bun:test'
import { SignJWT } from 'jose'
import {
  PORTAL_AUTH_CONTRACT_VERSION,
  PORTAL_WEBHOOK_CONTRACT_VERSION,
  assertContractVersionCompatible,
  ContractVersionMismatchError,
} from '../contract-version.js'
import { defineWebhookHandler } from '../webhook-typed.js'
import { verifyBrokerToken } from '../broker-token.js'
import { PLATFORM_AUTH_CONTRACT_VERSION } from '@coms-portal/shared/contracts/auth'
import { PORTAL_WEBHOOK_CONTRACT_VERSION as SHARED_WEBHOOK_VERSION } from '@coms-portal/shared/contracts/webhook-events'

describe('contract-version constants', () => {
  it('PORTAL_AUTH_CONTRACT_VERSION matches @coms-portal/shared', () => {
    expect(PORTAL_AUTH_CONTRACT_VERSION).toBe(PLATFORM_AUTH_CONTRACT_VERSION)
  })

  it('PORTAL_WEBHOOK_CONTRACT_VERSION matches @coms-portal/shared', () => {
    expect(PORTAL_WEBHOOK_CONTRACT_VERSION).toBe(SHARED_WEBHOOK_VERSION)
  })
})

describe('assertContractVersionCompatible', () => {
  it('passes when received version equals supported version', () => {
    expect(() => assertContractVersionCompatible(2, 2, 'auth')).not.toThrow()
  })

  it('passes when received version is a same-major minor bump (e.g. 2.5 vs 2)', () => {
    expect(() => assertContractVersionCompatible(2.5, 2, 'auth')).not.toThrow()
  })

  it('passes when received is older than supported (forwards compatible)', () => {
    expect(() => assertContractVersionCompatible(1, 2, 'auth')).not.toThrow()
  })

  it('throws when received is a future major (Math.floor(received) > supported)', () => {
    try {
      assertContractVersionCompatible(3, 2, 'auth')
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ContractVersionMismatchError)
      expect((err as ContractVersionMismatchError).code).toBe('auth_version_mismatch')
      expect((err as ContractVersionMismatchError).received).toBe(3)
      expect((err as ContractVersionMismatchError).supported).toBe(2)
    }
  })

  it('encodes webhook kind in the error code', () => {
    try {
      assertContractVersionCompatible(99, 1, 'webhook')
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ContractVersionMismatchError)
      expect((err as ContractVersionMismatchError).code).toBe('webhook_version_mismatch')
    }
  })

  it('is a no-op when received is undefined / non-numeric', () => {
    expect(() => assertContractVersionCompatible(undefined as unknown as number, 2, 'auth')).not.toThrow()
    expect(() => assertContractVersionCompatible('2' as unknown as number, 2, 'auth')).not.toThrow()
    expect(() => assertContractVersionCompatible(NaN, 2, 'auth')).not.toThrow()
  })
})

describe('defineWebhookHandler — strict contract version', () => {
  const baseEnvelope = {
    eventId: 'evt-1',
    occurredAt: '2026-05-07T00:00:00.000Z',
    appSlug: 'heroes',
    event: 'user.provisioned' as const,
    payload: {
      userId: 'u',
      gipUid: null,
      email: 'a@b.com',
      name: 'A',
      portalRole: 'employee' as const,
      teamIds: [],
      apps: ['heroes'],
      appRole: null,
    },
  }

  it('passes when envelope contractVersion equals SDK supported', async () => {
    const dispatch = defineWebhookHandler(
      { 'user.provisioned': async () => {} },
      { strictContractVersion: true },
    )
    await expect(
      dispatch({ ...baseEnvelope, contractVersion: PORTAL_WEBHOOK_CONTRACT_VERSION }),
    ).resolves.toBeUndefined()
  })

  it('throws ContractVersionMismatchError on a future major', async () => {
    const dispatch = defineWebhookHandler(
      { 'user.provisioned': async () => {} },
      { strictContractVersion: true },
    )
    await expect(
      dispatch({ ...baseEnvelope, contractVersion: PORTAL_WEBHOOK_CONTRACT_VERSION + 1 }),
    ).rejects.toBeInstanceOf(ContractVersionMismatchError)
  })

  it('does not assert when strictContractVersion is omitted (backwards compatible)', async () => {
    const dispatch = defineWebhookHandler({ 'user.provisioned': async () => {} })
    await expect(
      dispatch({ ...baseEnvelope, contractVersion: PORTAL_WEBHOOK_CONTRACT_VERSION + 99 }),
    ).resolves.toBeUndefined()
  })
})

describe('verifyBrokerToken — strict contract version', () => {
  const APP_SLUG = 'test-app'
  const AUDIENCE = `portal:app:${APP_SLUG}`
  const SECRET = 'super-secret-hs256-signing-key-minimum-length-ok'
  const SECRET_BYTES = new TextEncoder().encode(SECRET)
  const BASE = {
    appSlug: APP_SLUG,
    userId: 'u',
    gipUid: 'g',
    email: 'a@b.com',
    name: 'A',
    portalRole: 'employee',
    teamIds: [],
    apps: [APP_SLUG],
  }

  async function mint(extra: Record<string, unknown> = {}) {
    const now = Math.floor(Date.now() / 1000)
    return new SignJWT({ ...BASE, ...extra })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('coms-portal-broker')
      .setAudience(AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(SECRET_BYTES)
  }

  it('passes strict mode with no contractVersion claim (forward-compat no-op)', async () => {
    const token = await mint()
    const payload = await verifyBrokerToken(token, {
      appSlug: APP_SLUG,
      sharedSecret: SECRET,
      strictContractVersion: true,
    })
    expect(payload.appSlug).toBe(APP_SLUG)
  })

  it('passes strict mode when contractVersion equals SDK supported', async () => {
    const token = await mint({ contractVersion: PORTAL_AUTH_CONTRACT_VERSION })
    const payload = await verifyBrokerToken(token, {
      appSlug: APP_SLUG,
      sharedSecret: SECRET,
      strictContractVersion: true,
    })
    expect(payload.contractVersion).toBe(PORTAL_AUTH_CONTRACT_VERSION)
  })

  it('throws ContractVersionMismatchError on a future major in strict mode', async () => {
    const token = await mint({ contractVersion: PORTAL_AUTH_CONTRACT_VERSION + 1 })
    await expect(
      verifyBrokerToken(token, {
        appSlug: APP_SLUG,
        sharedSecret: SECRET,
        strictContractVersion: true,
      }),
    ).rejects.toBeInstanceOf(ContractVersionMismatchError)
  })

  it('does not assert when strictContractVersion is false', async () => {
    const token = await mint({ contractVersion: PORTAL_AUTH_CONTRACT_VERSION + 99 })
    const payload = await verifyBrokerToken(token, {
      appSlug: APP_SLUG,
      sharedSecret: SECRET,
    })
    expect(payload.contractVersion).toBe(PORTAL_AUTH_CONTRACT_VERSION + 99)
  })
})
