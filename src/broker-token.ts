import { jwtVerify, decodeProtectedHeader, createRemoteJWKSet } from 'jose'
import type { JWTPayload, JWTVerifyOptions } from 'jose'
import { BrokerTokenError } from './errors.js'
import {
  PORTAL_AUTH_CONTRACT_VERSION,
  assertContractVersionCompatible,
} from './contract-version.js'

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

/** @internal — exported for testing only */
export function getJwks(url: string): ReturnType<typeof createRemoteJWKSet> {
  let jwks = jwksCache.get(url)
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(url))
    jwksCache.set(url, jwks)
  }
  return jwks
}

export { BrokerTokenError }

export type BrokerTokenPayload = JWTPayload & {
  appSlug: string
  userId: string
  gipUid: string
  email: string
  name: string
  portalRole: string
  teamIds: string[]
  apps: string[]
  redirectTo?: string | null
  /**
   * Optional contract-version claim emitted by future portal builds. When
   * `verifyBrokerToken` is called with `strictContractVersion: true`, this
   * field is asserted against `PORTAL_AUTH_CONTRACT_VERSION`. Absent today
   * for backwards compatibility; strict mode is a no-op until present.
   */
  contractVersion?: number
}

export type VerifyBrokerTokenOptions = {
  /**
   * The app slug the token is expected to be issued for.
   * Used to construct the expected audience `portal:app:<appSlug>`.
   */
  appSlug: string
  /**
   * When `true`, after successful signature/audience/issuer verification the
   * decoded payload's `contractVersion` claim (if present) is asserted
   * against `PORTAL_AUTH_CONTRACT_VERSION`. A future major version raises
   * `ContractVersionMismatchError`. Default `false` for back-compat; safe to
   * enable today (no-op until the portal starts emitting the claim).
   */
  strictContractVersion?: boolean
} & (
  | {
      /**
       * URL of the JWKS endpoint (e.g. https://portal.example.com/.well-known/jwks.json).
       * Used for ES256 token verification.
       */
      jwksUrl: string
      /**
       * Expected issuer(s). Accepts both URL-form (Rev 2+) and legacy bare-string.
       * Defaults to accepting `['coms-portal-broker']` (legacy) if not provided.
       */
      issuer?: string | string[]
      sharedSecret?: never
    }
  | {
      jwksUrl?: never
      issuer?: string | string[]
      /**
       * Per-app shared secret (base64 or plain string) for HS256 token verification.
       */
      sharedSecret: string | Uint8Array
    }
)

/**
 * Map jose error names/messages to typed BrokerTokenError codes.
 */
function mapJoseError(err: unknown): BrokerTokenError {
  if (!(err instanceof Error)) {
    return new BrokerTokenError('malformed', String(err))
  }
  const name = err.name
  const msg = err.message

  if (name === 'JWTExpired') return new BrokerTokenError('expired', msg)
  if (name === 'JWSSignatureVerificationFailed') return new BrokerTokenError('invalid_signature', msg)
  if (name === 'JWTClaimValidationFailed') {
    if (msg.includes('aud') || msg.includes('audience')) return new BrokerTokenError('invalid_audience', msg)
    if (msg.includes('iss') || msg.includes('issuer')) return new BrokerTokenError('invalid_issuer', msg)
    if (msg.includes('exp') || msg.includes('expir')) return new BrokerTokenError('expired', msg)
    return new BrokerTokenError('malformed', msg)
  }
  if (name === 'JWKSNoMatchingKey') return new BrokerTokenError('unknown_kid', msg)
  if (name === 'JWSInvalid' || name === 'JWTInvalid') return new BrokerTokenError('malformed', msg)
  return new BrokerTokenError('malformed', msg)
}

/**
 * Verify a COMS portal broker token.
 *
 * Supports both ES256 (JWKS-backed) and HS256 (shared-secret) tokens.
 * Throws a typed `BrokerTokenError` on any verification failure.
 */
export async function verifyBrokerToken(
  token: string,
  options: VerifyBrokerTokenOptions,
): Promise<BrokerTokenPayload> {
  let header: ReturnType<typeof decodeProtectedHeader>
  try {
    header = decodeProtectedHeader(token)
  } catch (err) {
    throw new BrokerTokenError('malformed', `Failed to decode token header: ${String(err)}`)
  }

  const audience = `portal:app:${options.appSlug}`
  const issuer = options.issuer ?? ['coms-portal-broker']

  const verifyOpts: JWTVerifyOptions = {
    audience,
    issuer,
    ...(header.alg === 'ES256' || header.alg === 'HS256'
      ? { algorithms: [header.alg] }
      : {}),
  }

  let payload: BrokerTokenPayload
  try {
    if (header.alg === 'ES256') {
      if (!options.jwksUrl) {
        throw new BrokerTokenError(
          'malformed',
          'ES256 token requires jwksUrl option',
        )
      }

      if (!header.kid) {
        throw new BrokerTokenError('missing_kid', 'ES256 broker token missing kid header')
      }

      const JWKS = getJwks(options.jwksUrl)
      const result = await jwtVerify<BrokerTokenPayload>(token, JWKS, verifyOpts)
      payload = result.payload
    } else if (header.alg === 'HS256') {
      if (!options.sharedSecret) {
        throw new BrokerTokenError(
          'malformed',
          'HS256 token requires sharedSecret option',
        )
      }
      const secret =
        typeof options.sharedSecret === 'string'
          ? new TextEncoder().encode(options.sharedSecret)
          : options.sharedSecret

      const result = await jwtVerify<BrokerTokenPayload>(token, secret, verifyOpts)
      payload = result.payload
    } else {
      throw new BrokerTokenError(
        'malformed',
        `Unsupported token algorithm: ${header.alg ?? 'unknown'}`,
      )
    }
  } catch (err) {
    if (err instanceof BrokerTokenError) throw err
    throw mapJoseError(err)
  }

  if (options.strictContractVersion && typeof payload.contractVersion === 'number') {
    assertContractVersionCompatible(payload.contractVersion, PORTAL_AUTH_CONTRACT_VERSION, 'auth')
  }

  return payload
}
