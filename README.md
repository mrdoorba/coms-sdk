# @coms-portal/sdk

Onboarding SDK for COMS portal integrators (H-apps). Verify broker tokens,
handle typed webhooks, register manifests as code, and wire your Elysia routes
in roughly 30 lines of glue.

## Requirements

- Bun ≥ 1.0 or Node.js ≥ 18
- TypeScript ≥ 5 (ESM-only)

## Installation

```bash
bun add git+https://github.com/mrdoorba/coms-sdk.git#v1.0.0
# or
npm install git+https://github.com/mrdoorba/coms-sdk.git#v1.0.0
```

For the default `registerManifest` ID-token path you also want
`google-auth-library` (declared as an optional peer dep):

```bash
bun add google-auth-library
```

For the Elysia adapter:

```bash
bun add elysia
```

## Quick start — the full H-app integration

```typescript
// portal-manifest.ts
import { defineManifest } from '@coms-portal/sdk'

export default defineManifest({
  appId: 'heroes',
  displayName: 'Heroes',
  schemaVersion: 2,
  configSchema: {
    weeklyDigestDay: { type: 'enum', values: ['mon', 'tue', 'wed', 'thu', 'fri'], default: 'fri' },
    notifyOnAssignment: { type: 'boolean', default: true },
  },
  taxonomies: ['team', 'department'],
})
```

```typescript
// server.ts
import { Elysia } from 'elysia'
import { requireBrokerAuth } from '@coms-portal/sdk/elysia'
import { defineWebhookHandler, verifyWebhookSignature } from '@coms-portal/sdk'

const app = new Elysia()
  .use(requireBrokerAuth({
    appSlug: 'heroes',
    jwksUrl: 'https://coms.ahacommerce.net/.well-known/jwks.json',
  }))
  .get('/me', ({ user }) => ({ portalSub: user.userId, role: user.portalRole }))

const handlePortalEvents = defineWebhookHandler({
  'user.provisioned': async ({ payload }) => { /* … */ },
  'user.updated':     async ({ payload }) => { /* … */ },
  'user.offboarded':  async ({ payload }) => { /* … */ },
})

app.post('/portal/webhook', async ({ request }) => {
  const body = await request.text()
  const ok = verifyWebhookSignature(
    process.env.WEBHOOK_SECRET!,
    request.headers.get('x-portal-webhook-timestamp')!,
    body,
    request.headers.get('x-portal-webhook-signature')!,
  )
  if (!ok) return new Response('Invalid signature', { status: 401 })
  await handlePortalEvents(JSON.parse(body))
  return new Response('OK')
})
```

CD pipeline:

```bash
coms-portal-cli register-manifest \
  --portal-url https://coms.ahacommerce.net \
  --app-slug heroes \
  --manifest ./portal-manifest.ts
```

That's the full H-app integration. No crypto code, no envelope-shape
declarations, no manifest-as-form-fill.

## Surface (v1.0)

### Auth

- `verifyBrokerToken(token, options)` — ES256 (JWKS) and HS256 (shared
  secret) broker-token verification. Throws typed `BrokerTokenError`. Set
  `strictContractVersion: true` to reject future major auth contracts.
- `BrokerTokenError` — `code: 'expired' | 'invalid_signature' |
  'invalid_audience' | 'invalid_issuer' | 'missing_kid' | 'unknown_kid' |
  'malformed'`.

### Webhooks

- `verifyWebhookSignature(secret, timestamp, body, signature)` — HMAC-SHA256
  constant-time verifier.
- `signWebhookPayload(secret, timestamp, body)` — symmetric helper.
- `defineWebhookHandler(map, options?)` — typed dispatcher. `map[E]` is
  invoked with `{ payload, envelope }` typed via `PayloadFor<E>`. Pass
  `{ strictContractVersion: true }` to reject envelopes from a future
  major webhook contract.
- `WebhookEnvelopeError` — `code: 'malformed' | 'unknown_event'`.
- `getAppRole(envelope, options?)` — extract the resolved app-local role
  from `user.provisioned` / `user.updated` envelopes. Returns `null`
  otherwise.

### Manifest

- `defineManifest(definition)` — author-time identity helper that
  type-checks your `portal-manifest.ts`.
- `registerManifest({ portalUrl, manifest, getIdToken?, fetch? })` —
  POSTs to `${portalUrl}/api/v1/apps/:slug/manifest`. Default `getIdToken`
  uses `google-auth-library` (lazy import). Returns `{ schemaVersion,
  registeredAt }`.

### Contract versions

- `PORTAL_AUTH_CONTRACT_VERSION` / `PORTAL_WEBHOOK_CONTRACT_VERSION` —
  re-exported constants pinning the SDK's supported max.
- `assertContractVersionCompatible(received, supported, kind)` — Stripe-
  Version-style assertion.
- `ContractVersionMismatchError` — `code:
  'auth_version_mismatch' | 'webhook_version_mismatch'`.

### Client helpers (preserved from v0.1.x)

- `resolveAlias`, `introspectSession`, `getAuditLog` — thin HTTP clients.

### Re-exports from `@coms-portal/shared`

H-apps import every contract type from `@coms-portal/sdk` directly:
`PortalWebhookEnvelope`, per-event payloads, `PortalSessionUser`,
`PortalRole`, `PortalIntegrationManifest`, header constants, etc.

## Subpaths

| Import path | Purpose |
|---|---|
| `@coms-portal/sdk` | Framework-neutral primary surface |
| `@coms-portal/sdk/elysia` | `requireBrokerAuth` Elysia plugin |
| `@coms-portal/sdk/testing` | `mintTestBrokerToken`, `buildEnvelope`, `stubJwks` for unit tests |

## CLI

The package ships a `coms-portal-cli` binary on `$PATH` after install. One
verb today:

```bash
coms-portal-cli register-manifest --portal-url <url> --app-slug <slug> --manifest <path>
```

Exit codes: `0` success, `1` auth failure, `2` validation failure (slug
mismatch, malformed manifest, missing args), `3` network / portal 5xx. Auth
uses Application Default Credentials (Cloud Run / GCB / GCE inherit
automatically).

## Testing your H-app

```typescript
import { mintTestBrokerToken, stubJwks, buildEnvelope } from '@coms-portal/sdk/testing'
import { Elysia } from 'elysia'
import { requireBrokerAuth } from '@coms-portal/sdk/elysia'

test('GET /me returns the portal user', async () => {
  const minted = await mintTestBrokerToken({ appSlug: 'heroes', userId: 'u-1' })
  const stub = stubJwks({ keys: [minted.jwk] })

  const app = new Elysia()
    .use(requireBrokerAuth({ appSlug: 'heroes', jwksUrl: stub.url, issuer: minted.issuer }))
    .get('/me', ({ user }) => ({ id: user.userId }))

  const res = await app.handle(
    new Request('http://localhost/me', { headers: { Authorization: `Bearer ${minted.token}` } }),
  )
  expect(await res.json()).toEqual({ id: 'u-1' })

  stub.restore()
})
```

## Migration from v0.1.x

The v0.1.x export surface is preserved verbatim in v1.0. Existing imports
keep working with no code changes; just bump the pinned tag:

```diff
-"@coms-portal/sdk": "git+https://github.com/mrdoorba/coms-sdk.git#v0.1.1"
+"@coms-portal/sdk": "git+https://github.com/mrdoorba/coms-sdk.git#v1.0.0"
```

See [MIGRATION.md](./MIGRATION.md) for the full walkthrough of which v1.0
features replace which v0.1.x patterns.

## Versioning

The 1.x line is semver-stable. Breaking changes ship in v2.0 (planned: HS256
verify removal, gated on Heroes Phase 7). See
[CHANGELOG.md](./CHANGELOG.md) for release notes and
[SUPPORTED_VERSIONS.md](./SUPPORTED_VERSIONS.md) for the support matrix.

## Security

Report security issues to the portal team directly at
coms@ahacommerce.net. Do not open public GitHub issues for security
vulnerabilities.
