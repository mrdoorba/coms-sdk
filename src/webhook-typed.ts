import type {
  PortalWebhookEnvelope,
  PortalWebhookEvent,
} from '@coms-portal/shared/contracts/webhook-events'
import { PORTAL_WEBHOOK_EVENTS } from '@coms-portal/shared/contracts/webhook-events'
import type { PayloadFor } from './event-payload-map.js'

export class WebhookEnvelopeError extends Error {
  readonly code: 'malformed' | 'unknown_event'
  constructor(code: 'malformed' | 'unknown_event', message: string) {
    super(message)
    this.name = 'WebhookEnvelopeError'
    this.code = code
  }
}

/**
 * Context passed to a per-event webhook handler. `payload` is the
 * event-specific shape (typed via `PayloadFor<E>`); `envelope` is the full
 * envelope including `eventId`, `occurredAt`, `appSlug`.
 */
export interface WebhookHandlerContext<E extends PortalWebhookEvent> {
  payload: PayloadFor<E>
  envelope: PortalWebhookEnvelope<PayloadFor<E>>
}

/**
 * Map of event discriminator → handler. Authors typically supply a partial
 * map (only the events they care about); unhandled events become no-ops.
 */
export type WebhookHandlerMap = {
  [E in PortalWebhookEvent]?: (ctx: WebhookHandlerContext<E>) => Promise<void> | void
}

const KNOWN_EVENTS = new Set<string>(PORTAL_WEBHOOK_EVENTS)

/**
 * Build a typed webhook dispatcher. The returned function accepts a parsed
 * envelope (object form, not a raw string) and dispatches to the matching
 * handler in `map`. Events not present in `map` are silent no-ops; events
 * not in the {@link PORTAL_WEBHOOK_EVENTS} list throw `unknown_event`.
 *
 * Typical Elysia/fetch usage:
 *
 *   const dispatch = defineWebhookHandler({
 *     'user.provisioned': async ({ payload }) => { ... },
 *   })
 *   app.post('/portal/webhook', async ({ body }) => {
 *     await dispatch(body)
 *     return new Response('OK')
 *   })
 */
export function defineWebhookHandler(map: WebhookHandlerMap): (envelope: unknown) => Promise<void> {
  return async (envelope: unknown): Promise<void> => {
    if (!envelope || typeof envelope !== 'object') {
      throw new WebhookEnvelopeError('malformed', 'Webhook envelope is not an object')
    }
    const event = (envelope as { event?: unknown }).event
    if (typeof event !== 'string') {
      throw new WebhookEnvelopeError('malformed', 'Webhook envelope is missing the `event` discriminator')
    }
    if (!KNOWN_EVENTS.has(event)) {
      throw new WebhookEnvelopeError('unknown_event', `Unknown event: ${event}`)
    }

    const handler = map[event as PortalWebhookEvent]
    if (!handler) return

    const typedEnvelope = envelope as PortalWebhookEnvelope<PayloadFor<PortalWebhookEvent>>
    const ctx = {
      payload: typedEnvelope.payload,
      envelope: typedEnvelope,
    } as WebhookHandlerContext<PortalWebhookEvent>

    await handler(ctx as never)
  }
}
