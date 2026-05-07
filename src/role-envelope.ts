import type { PortalWebhookEnvelope } from '@coms-portal/shared/contracts/webhook-events'

/**
 * The resolved app-local role string for a recipient app, as carried on
 * `user.provisioned` / `user.updated` envelopes. Per Spec 07 the portal
 * resolves the role per-recipient before emit; the SDK exposes it as an
 * opaque string so an H-app can declare its own role enum without the SDK
 * pinning the shape.
 */
export type AppRole = string

export interface GetAppRoleOptions {
  /**
   * Defensive sanity check — when provided, `getAppRole` returns `null` if
   * `envelope.appSlug` does not match. Useful in shared receivers that route
   * by slug, when you want to assert the recipient.
   */
  expectedAppSlug?: string
}

/**
 * Extract the resolved app-local role for the recipient app from a
 * `user.provisioned` or `user.updated` webhook envelope. Returns `null` for
 * any other event, for malformed inputs, and when the role is unset.
 *
 * Per the 2026-05-06 portal role refactor (Spec 03d D12), future H-apps must
 * read role from this envelope field — never from `configSchema`.
 */
export function getAppRole(
  envelope: PortalWebhookEnvelope<unknown>,
  options: GetAppRoleOptions = {},
): AppRole | null {
  if (!envelope || typeof envelope !== 'object') return null
  const event = (envelope as { event?: unknown }).event
  if (event !== 'user.provisioned' && event !== 'user.updated') return null

  if (options.expectedAppSlug !== undefined) {
    const slug = (envelope as { appSlug?: unknown }).appSlug
    if (slug !== options.expectedAppSlug) return null
  }

  const payload = (envelope as { payload?: unknown }).payload
  if (!payload || typeof payload !== 'object') return null

  const role = (payload as { appRole?: unknown }).appRole
  if (role === null) return null
  if (typeof role !== 'string') return null
  return role
}
