import { SignJWT, generateKeyPair, exportJWK } from 'jose'
import type { BrokerTokenPayload } from '../broker-token.js'

export interface MintTestBrokerTokenOptions extends Partial<BrokerTokenPayload> {
  /** Default `'ES256'`. Use `'HS256'` for symmetric-secret testing. */
  alg?: 'ES256' | 'HS256'
  /** Default `'test-app'` if `appSlug` is not provided in the payload. */
  appSlug?: string
  /** Default `300` (5 minutes). Negative values mint already-expired tokens. */
  expiresInSeconds?: number
  /** Default `'https://coms.test/broker'`. */
  issuer?: string
  /** Default `'test-kid-1'`. ES256 path only. */
  kid?: string
  /**
   * Override the HS256 shared secret. Default is auto-generated; the
   * returned `sharedSecret` lets the caller pass it to `verifyBrokerToken`.
   */
  sharedSecret?: string
}

export interface MintedTestToken {
  token: string
  /** ES256 public JWK ready to feed `stubJwks`. Undefined for HS256 tokens. */
  jwk: Record<string, unknown>
  /** HS256 shared secret. Undefined for ES256 tokens. */
  sharedSecret?: string
  /** The audience-deriving slug used at sign time. */
  appSlug: string
  /** The issuer string used at sign time — feed this back to verifyBrokerToken. */
  issuer: string
}

const DEFAULTS = {
  appSlug: 'test-app',
  userId: 'test-user-1',
  gipUid: 'test-gip-1',
  email: 'test@example.com',
  name: 'Test User',
  portalRole: 'employee',
  teamIds: [] as string[],
  apps: ['test-app'] as string[],
}

/**
 * Mint a portal-shaped broker token for tests. Returns the token plus the
 * material a verifier needs (a JWK for ES256, the secret for HS256). Pair
 * with {@link stubJwks} for the ES256 happy-path test.
 */
export async function mintTestBrokerToken(
  options: MintTestBrokerTokenOptions = {},
): Promise<MintedTestToken> {
  const alg = options.alg ?? 'ES256'
  const appSlug = options.appSlug ?? options.appSlug ?? DEFAULTS.appSlug
  const expiresInSeconds = options.expiresInSeconds ?? 300
  const issuer = options.issuer ?? 'https://coms.test/broker'
  const kid = options.kid ?? 'test-kid-1'

  const payload: BrokerTokenPayload = {
    appSlug,
    userId: options.userId ?? DEFAULTS.userId,
    gipUid: options.gipUid ?? DEFAULTS.gipUid,
    email: options.email ?? DEFAULTS.email,
    name: options.name ?? DEFAULTS.name,
    portalRole: options.portalRole ?? DEFAULTS.portalRole,
    teamIds: options.teamIds ?? DEFAULTS.teamIds,
    apps: options.apps ?? [appSlug],
    ...(options.redirectTo !== undefined ? { redirectTo: options.redirectTo } : {}),
    ...(options.contractVersion !== undefined ? { contractVersion: options.contractVersion } : {}),
  }

  const now = Math.floor(Date.now() / 1000)
  const audience = `portal:app:${appSlug}`

  if (alg === 'HS256') {
    const secret = options.sharedSecret ?? `test-secret-${crypto.randomUUID()}`
    const token = await new SignJWT({ ...payload })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt(now)
      .setExpirationTime(now + expiresInSeconds)
      .sign(new TextEncoder().encode(secret))
    return { token, jwk: {}, sharedSecret: secret, appSlug, issuer }
  }

  const kp = await generateKeyPair('ES256')
  const publicJwk = (await exportJWK(kp.publicKey)) as Record<string, unknown>
  publicJwk.kid = kid
  publicJwk.alg = 'ES256'
  publicJwk.use = 'sig'

  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'ES256', kid })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds)
    .sign(kp.privateKey)

  return { token, jwk: publicJwk, appSlug, issuer }
}
