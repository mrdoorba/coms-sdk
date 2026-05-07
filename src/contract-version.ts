import { PLATFORM_AUTH_CONTRACT_VERSION } from '@coms-portal/shared/contracts/auth'
import { PORTAL_WEBHOOK_CONTRACT_VERSION as SHARED_WEBHOOK_VERSION } from '@coms-portal/shared/contracts/webhook-events'

/**
 * Major version of the auth/broker-token wire contract this SDK pins. Sourced
 * from `@coms-portal/shared` so the SDK never drifts from the platform's
 * declared version.
 *
 * When set to N, the SDK is willing to decode any auth-side payload whose
 * `contractVersion` reports `Math.floor(received) <= N`. A future major
 * version (`> N`) is rejected by `assertContractVersionCompatible`.
 */
export const PORTAL_AUTH_CONTRACT_VERSION = PLATFORM_AUTH_CONTRACT_VERSION

/**
 * Major version of the webhook wire contract this SDK pins. Sourced from
 * `@coms-portal/shared`.
 */
export const PORTAL_WEBHOOK_CONTRACT_VERSION = SHARED_WEBHOOK_VERSION

export type ContractVersionKind = 'auth' | 'webhook'

export type ContractVersionMismatchCode = 'auth_version_mismatch' | 'webhook_version_mismatch'

/**
 * Thrown by {@link assertContractVersionCompatible} when a wire payload
 * declares a contract version newer than the SDK supports. Discriminated by
 * `code` so callers can branch on the failure mode without parsing strings.
 */
export class ContractVersionMismatchError extends Error {
  readonly code: ContractVersionMismatchCode
  readonly received: number
  readonly supported: number

  constructor(code: ContractVersionMismatchCode, received: number, supported: number) {
    super(
      `Portal ${code === 'auth_version_mismatch' ? 'auth' : 'webhook'} contract version ${received} ` +
        `is newer than this SDK supports (max ${supported}). Upgrade @coms-portal/sdk.`,
    )
    this.name = 'ContractVersionMismatchError'
    this.code = code
    this.received = received
    this.supported = supported
  }
}

/**
 * Assert the received contract version is compatible with the SDK's
 * supported max. Permits same-major minor bumps (`Math.floor(received) <=
 * supported`) but rejects any future major. No-op when `received` is not a
 * finite number — callers that want to enforce presence must check first.
 *
 * Stripe-Version-style fail-loud model: predictable, actionable signal
 * instead of silent partial-data bugs.
 */
export function assertContractVersionCompatible(
  received: number,
  supported: number,
  kind: ContractVersionKind,
): void {
  if (typeof received !== 'number' || !Number.isFinite(received)) return
  if (Math.floor(received) <= supported) return
  const code: ContractVersionMismatchCode =
    kind === 'auth' ? 'auth_version_mismatch' : 'webhook_version_mismatch'
  throw new ContractVersionMismatchError(code, received, supported)
}
