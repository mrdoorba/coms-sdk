import { jwtVerify, decodeProtectedHeader, createRemoteJWKSet } from 'jose'
import type { JWTPayload, JWTVerifyOptions } from 'jose'
import { BrokerTokenError } from './errors.js'

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
}

export type VerifyBrokerTokenOptions = {
  /**
   * The app slug the token is expected to be issued for.
   * Used to construct the expected audience `portal:app:<appSlug>`.
   */
  appSlug: string
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
    algorithms: header.alg === 'ES256' ? ['ES256'] : header.alg === 'HS256' ? ['HS256'] : undefined,
  }

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

      const JWKS = createRemoteJWKSet(new URL(options.jwksUrl))
      const { payload } = await jwtVerify<BrokerTokenPayload>(token, JWKS, verifyOpts)
      return payload
    }

    if (header.alg === 'HS256') {
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

      const { payload } = await jwtVerify<BrokerTokenPayload>(token, secret, verifyOpts)
      return payload
    }

    throw new BrokerTokenError('malformed', `Unsupported token algorithm: ${header.alg ?? 'unknown'}`)
  } catch (err) {
    if (err instanceof BrokerTokenError) throw err
    throw mapJoseError(err)
  }
}
