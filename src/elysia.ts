import { Elysia } from 'elysia'
import { verifyBrokerToken, BrokerTokenError } from './broker-token.js'
import type { BrokerTokenPayload, VerifyBrokerTokenOptions } from './broker-token.js'

export interface RequireBrokerAuthOptions {
  appSlug: string
  jwksUrl: string
  issuer?: string | string[]
  /**
   * Forwarded to {@link verifyBrokerToken}. When `true`, a token whose
   * `contractVersion` claim declares a future major version raises
   * `ContractVersionMismatchError` and is rejected with 401. Default `false`.
   */
  strictContractVersion?: boolean
}

/**
 * Elysia plugin that gates downstream routes on a valid portal broker
 * token. Adds `user: BrokerTokenPayload` to the route context on success;
 * throws 401 with a structured `{ error, code }` body on any verification
 * failure (the `code` matches `BrokerTokenError.code` —
 * `'expired' | 'invalid_signature' | 'invalid_audience' | 'invalid_issuer' |
 * 'missing_kid' | 'unknown_kid' | 'malformed' | 'missing_token'`).
 *
 * Single source of truth for broker-token decode: this plugin delegates to
 * the SDK's own `verifyBrokerToken`, so an H-app authoring `/me` does not
 * write its own crypto layer. ES256 is the default path; HS256 is
 * available transitionally via `sharedSecret` (drops in v2.0).
 *
 *   import { requireBrokerAuth } from '@coms-portal/sdk/elysia'
 *
 *   const app = new Elysia()
 *     .use(requireBrokerAuth({
 *       appSlug: 'heroes',
 *       jwksUrl: 'https://coms.ahacommerce.net/.well-known/jwks.json',
 *     }))
 *     .get('/me', ({ user }) => ({ portalSub: user.userId }))
 */
export function requireBrokerAuth(options: RequireBrokerAuthOptions) {
  return new Elysia({ name: 'require-broker-auth' }).derive(
    { as: 'scoped' },
    async ({ request, status }): Promise<{ user: BrokerTokenPayload }> => {
      const authHeader = request.headers.get('authorization')
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw status(401, { error: 'unauthorized', code: 'missing_token' })
      }

      const token = authHeader.slice('Bearer '.length)

      const verifyOpts: VerifyBrokerTokenOptions = {
        appSlug: options.appSlug,
        jwksUrl: options.jwksUrl,
        ...(options.issuer !== undefined ? { issuer: options.issuer } : {}),
        ...(options.strictContractVersion !== undefined
          ? { strictContractVersion: options.strictContractVersion }
          : {}),
      }

      let user: BrokerTokenPayload
      try {
        user = await verifyBrokerToken(token, verifyOpts)
      } catch (err) {
        const code = err instanceof BrokerTokenError ? err.code : 'malformed'
        throw status(401, { error: 'unauthorized', code })
      }

      return { user }
    },
  )
}
