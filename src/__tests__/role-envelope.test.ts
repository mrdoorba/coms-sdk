import { describe, it, expect } from 'bun:test'
import type { PortalWebhookEnvelope, UserProvisionedPayload, UserUpdatedPayload, UserOffboardedPayload } from '@coms-portal/shared/contracts/webhook-events'
import { getAppRole } from '../role-envelope.js'

const baseEnvelope = {
  contractVersion: 1 as const,
  eventId: '00000000-0000-0000-0000-000000000001',
  occurredAt: '2026-05-07T00:00:00.000Z',
  appSlug: 'heroes',
} as const

function provisionedEnvelope(appRole: string | null): PortalWebhookEnvelope<UserProvisionedPayload> {
  return {
    ...baseEnvelope,
    event: 'user.provisioned',
    payload: {
      userId: 'user-1',
      gipUid: 'gip-1',
      email: 'a@b.com',
      name: 'A',
      portalRole: 'employee',
      teamIds: [],
      apps: ['heroes'],
      appRole,
    },
  }
}

function updatedEnvelope(appRole: string | null): PortalWebhookEnvelope<UserUpdatedPayload> {
  return {
    ...baseEnvelope,
    event: 'user.updated',
    payload: {
      userId: 'user-1',
      gipUid: 'gip-1',
      email: 'a@b.com',
      name: 'A',
      portalRole: 'employee',
      teamIds: [],
      apps: ['heroes'],
      changedFields: ['name'],
      appRole,
    },
  }
}

describe('getAppRole', () => {
  it('returns the resolved app role from a user.provisioned envelope', () => {
    expect(getAppRole(provisionedEnvelope('leader'))).toBe('leader')
  })

  it('returns the resolved app role from a user.updated envelope', () => {
    expect(getAppRole(updatedEnvelope('member'))).toBe('member')
  })

  it('returns null when the resolved role is null on a user event', () => {
    expect(getAppRole(provisionedEnvelope(null))).toBeNull()
    expect(getAppRole(updatedEnvelope(null))).toBeNull()
  })

  it('returns null on events that do not carry a per-recipient role', () => {
    const offboarded: PortalWebhookEnvelope<UserOffboardedPayload> = {
      ...baseEnvelope,
      event: 'user.offboarded',
      payload: {
        userId: 'user-1',
        gipUid: 'gip-1',
        email: 'a@b.com',
        offboardedAt: '2026-05-07T00:00:00.000Z',
      },
    }
    expect(getAppRole(offboarded)).toBeNull()
  })

  it('rejects mismatched appSlug as a defensive sanity check (returns null)', () => {
    const envelope = provisionedEnvelope('leader')
    expect(getAppRole(envelope, { expectedAppSlug: 'someone-else' })).toBeNull()
    expect(getAppRole(envelope, { expectedAppSlug: 'heroes' })).toBe('leader')
  })

  it('returns null for malformed envelopes (defensive — never throws)', () => {
    expect(getAppRole({} as never)).toBeNull()
    expect(getAppRole(null as never)).toBeNull()
    expect(getAppRole(undefined as never)).toBeNull()
  })
})
