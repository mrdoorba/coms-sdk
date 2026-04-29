# @coms-portal/sdk

Framework-neutral TypeScript SDK for COMS portal integrators. Verify broker tokens,
validate webhook signatures, and query portal APIs — without any framework dependencies.

## Requirements

- Bun ≥ 1.0 or Node.js ≥ 18
- TypeScript ≥ 5.0 (ESM project)

## Installation

```bash
bun add git+https://github.com/mrdoorba/coms-sdk.git#v0.1.0
# or
npm install git+https://github.com/mrdoorba/coms-sdk.git#v0.1.0
```

## Exports

### `verifyBrokerToken(token, options)`

Verify a COMS portal broker token. Supports ES256 (JWKS-backed) and HS256 (shared-secret).
Throws a typed `BrokerTokenError` on failure.

```typescript
import { verifyBrokerToken, BrokerTokenError } from '@coms-portal/sdk'

// ES256 (recommended — uses portal JWKS endpoint)
try {
  const payload = await verifyBrokerToken(token, {
    appSlug: 'my-app',
    jwksUrl: 'https://coms.ahacommerce.net/.well-known/jwks.json',
    issuer: ['https://coms.ahacommerce.net/broker', 'coms-portal-broker'],
  })
  console.log('User:', payload.email, 'Role:', payload.portalRole)
} catch (err) {
  if (err instanceof BrokerTokenError) {
    // err.code is one of:
    // 'expired' | 'invalid_signature' | 'invalid_audience' | 'invalid_issuer'
    // 'missing_kid' | 'unknown_kid' | 'malformed'
    console.error('Token rejected:', err.code, err.message)
  }
}

// HS256 (legacy — per-app shared secret)
const payload = await verifyBrokerToken(token, {
  appSlug: 'my-app',
  sharedSecret: process.env.PORTAL_BROKER_SIGNING_SECRET!,
})
```

### `verifyWebhookSignature(payload, signature, secret, timestamp)`

Verify a COMS portal webhook signature using constant-time HMAC-SHA256 comparison.

```typescript
import { verifyWebhookSignature } from '@coms-portal/sdk'

// In your webhook handler:
const body = await request.text()
const signature = request.headers.get('x-portal-webhook-signature') ?? ''
const timestamp = request.headers.get('x-portal-webhook-timestamp') ?? ''

if (!verifyWebhookSignature(process.env.WEBHOOK_SECRET!, timestamp, body, signature)) {
  return new Response('Invalid signature', { status: 401 })
}

const event = JSON.parse(body)
```

### `resolveAlias(client, names)`

Resolve up to 1000 alias names to portal identities in one call.
Rate-limited at 20 RPS / 40 burst per app token.

```typescript
import { resolveAlias } from '@coms-portal/sdk'

const client = {
  baseUrl: 'https://coms.ahacommerce.net',
  brokerToken: myBrokerToken,
}

const { results, rateLimitHeaders } = await resolveAlias(client, [
  'alice@example.com',
  'emp-001',
])

for (const result of results) {
  if (result.match) {
    console.log(result.input, '->', result.match.portalSub)
  }
}
```

### `introspectSession(client, params)`

Check whether a user's portal session is still active (not revoked, user still active,
app still accessible).

```typescript
import { introspectSession } from '@coms-portal/sdk'

const response = await introspectSession(client, {
  userId: payload.userId,
  sessionIssuedAt: payload.sessionIssuedAt,
  appSlug: 'my-app',
})

if (!response.active) {
  // Session was revoked — force re-authentication
  redirect('/login')
}
```

### `getAuditLog(client, params)`

Retrieve audit log entries scoped to your app's tenant. Authenticated via broker token.

```typescript
import { getAuditLog } from '@coms-portal/sdk'

const { entries, nextCursor } = await getAuditLog(client, {
  from: new Date(Date.now() - 86_400_000).toISOString(), // last 24h
  limit: 50,
})

// Paginate:
if (nextCursor) {
  const nextPage = await getAuditLog(client, { cursor: nextCursor, limit: 50 })
}
```

## Versioning

This SDK follows [Semantic Versioning](https://semver.org/). Breaking changes
increment the major version. See [CHANGELOG.md](./CHANGELOG.md) for release notes
and [SUPPORTED_VERSIONS.md](./SUPPORTED_VERSIONS.md) for the support matrix.

## Security

Report security issues to the portal team directly. Do not open public GitHub issues
for security vulnerabilities.
