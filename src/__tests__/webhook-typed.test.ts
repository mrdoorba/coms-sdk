import { describe, it, expect, mock } from 'bun:test'
import type {
  PortalWebhookEnvelope,
  UserProvisionedPayload,
  UserUpdatedPayload,
  AliasResolvedPayload,
} from '@coms-portal/shared/contracts/webhook-events'
import { defineWebhookHandler, WebhookEnvelopeError } from '../webhook-typed.js'

const baseEnvelope = {
  contractVersion: 1 as const,
  eventId: 'evt-1',
  occurredAt: '2026-05-07T00:00:00.000Z',
  appSlug: 'heroes',
} as const

function provisioned(appRole: string | null = 'member'): PortalWebhookEnvelope<UserProvisionedPayload> {
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

describe('defineWebhookHandler', () => {
  it('dispatches to the handler matching envelope.event with payload + envelope', async () => {
    const provisionedHandler = mock(async (_ctx: { payload: UserProvisionedPayload; envelope: PortalWebhookEnvelope<UserProvisionedPayload> }) => {})
    const updatedHandler = mock(async (_ctx: { payload: UserUpdatedPayload; envelope: PortalWebhookEnvelope<UserUpdatedPayload> }) => {})

    const dispatch = defineWebhookHandler({
      'user.provisioned': provisionedHandler,
      'user.updated': updatedHandler,
    })

    const env = provisioned()
    await dispatch(env)

    expect(provisionedHandler).toHaveBeenCalledTimes(1)
    expect(updatedHandler).toHaveBeenCalledTimes(0)
    const callArg = provisionedHandler.mock.calls[0]![0]
    expect(callArg.payload.userId).toBe('user-1')
    expect(callArg.envelope.event).toBe('user.provisioned')
    expect(callArg.envelope.appSlug).toBe('heroes')
  })

  it('is a no-op when no handler is registered for the event', async () => {
    const aliasResolvedHandler = mock(async (_ctx: { payload: AliasResolvedPayload; envelope: PortalWebhookEnvelope<AliasResolvedPayload> }) => {})

    const dispatch = defineWebhookHandler({
      'alias.resolved': aliasResolvedHandler,
    })

    await dispatch(provisioned())
    expect(aliasResolvedHandler).toHaveBeenCalledTimes(0)
  })

  it('throws WebhookEnvelopeError(malformed) on a missing event discriminator', async () => {
    const dispatch = defineWebhookHandler({
      'user.provisioned': async () => {},
    })

    await expect(dispatch({ payload: {} } as never)).rejects.toBeInstanceOf(WebhookEnvelopeError)
    try {
      await dispatch({ payload: {} } as never)
    } catch (err) {
      expect(err).toBeInstanceOf(WebhookEnvelopeError)
      expect((err as WebhookEnvelopeError).code).toBe('malformed')
    }
  })

  it('rejects an unknown event name with WebhookEnvelopeError(unknown_event)', async () => {
    const dispatch = defineWebhookHandler({
      'user.provisioned': async () => {},
    })

    try {
      await dispatch({ ...baseEnvelope, event: 'made.up.event', payload: {} } as never)
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(WebhookEnvelopeError)
      expect((err as WebhookEnvelopeError).code).toBe('unknown_event')
      expect((err as WebhookEnvelopeError).message).toMatch(/made\.up\.event/)
    }
  })

  it('propagates handler exceptions to the caller', async () => {
    const dispatch = defineWebhookHandler({
      'user.provisioned': async () => {
        throw new Error('handler boom')
      },
    })

    await expect(dispatch(provisioned())).rejects.toThrow('handler boom')
  })

  it('accepts a parsed JSON object directly (typical Elysia / fetch usage)', async () => {
    const handler = mock(async (_ctx: { payload: UserProvisionedPayload; envelope: PortalWebhookEnvelope<UserProvisionedPayload> }) => {})
    const dispatch = defineWebhookHandler({ 'user.provisioned': handler })

    const raw = JSON.parse(JSON.stringify(provisioned()))
    await dispatch(raw)
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
