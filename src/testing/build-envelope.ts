import {
  PORTAL_WEBHOOK_CONTRACT_VERSION,
  type PortalWebhookEnvelope,
  type PortalWebhookEvent,
} from '@coms-portal/shared/contracts/webhook-events'
import type { PayloadFor } from '../event-payload-map.js'

export interface BuildEnvelopeOptions {
  /** Default `'test-app'`. */
  appSlug?: string
  /** Default a fresh `crypto.randomUUID()`. */
  eventId?: string
  /** Default `new Date().toISOString()`. */
  occurredAt?: string
  /**
   * Override the contractVersion field. Default
   * `PORTAL_WEBHOOK_CONTRACT_VERSION`. Useful for testing strict-mode
   * mismatch handling.
   */
  contractVersion?: number
}

/**
 * Construct a {@link PortalWebhookEnvelope} matching the production wire
 * shape. Defaults are deterministic-when-seeded only via the `eventId` and
 * `occurredAt` overrides — call sites that need stable snapshots should
 * pass them explicitly.
 */
export function buildEnvelope<E extends PortalWebhookEvent>(
  event: E,
  payload: PayloadFor<E>,
  opts: BuildEnvelopeOptions = {},
): PortalWebhookEnvelope<PayloadFor<E>> {
  return {
    contractVersion: (opts.contractVersion ?? PORTAL_WEBHOOK_CONTRACT_VERSION) as typeof PORTAL_WEBHOOK_CONTRACT_VERSION,
    event,
    eventId: opts.eventId ?? crypto.randomUUID(),
    occurredAt: opts.occurredAt ?? new Date().toISOString(),
    appSlug: opts.appSlug ?? 'test-app',
    payload,
  }
}
