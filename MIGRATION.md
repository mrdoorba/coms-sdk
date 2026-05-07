# Migration v0.1.x → v1.0

The v1.0 cut is **additive** for existing v0.1.x consumers. There are **no
breaking changes** — every v0.1.x export is preserved verbatim. The
opportunities below are opt-in: adopt them when convenient, not because
you must.

## Step 1 — bump the pinned tag (required)

```diff
-"@coms-portal/sdk": "git+https://github.com/mrdoorba/coms-sdk.git#v0.1.1"
+"@coms-portal/sdk": "git+https://github.com/mrdoorba/coms-sdk.git#v1.0.0"
```

After this single change, run your existing test suite. Everything that
was green on v0.1.1 should be green on v1.0.0.

## Step 2 — opt into the new surface (recommended, in any order)

### Replace bespoke webhook envelope shapes with `defineWebhookHandler`

**Before (v0.1.x):**

```typescript
type UserProvisionedEvent = {
  event: 'user.provisioned'
  payload: { userId: string; email: string; appRole: string | null /* … */ }
}

app.post('/portal/webhook', async ({ request }) => {
  const body = await request.text()
  if (!verifyWebhookSignature(/* … */)) return new Response('401', { status: 401 })

  const evt = JSON.parse(body) as { event: string; payload: unknown }
  switch (evt.event) {
    case 'user.provisioned':
      await onProvisioned(evt.payload as UserProvisionedEvent['payload'])
      break
    case 'user.updated':
      await onUpdated(evt.payload as UserUpdatedEvent['payload'])
      break
    /* … */
  }
  return new Response('OK')
})
```

**After (v1.0):**

```typescript
import { defineWebhookHandler, verifyWebhookSignature } from '@coms-portal/sdk'

const handlePortalEvents = defineWebhookHandler({
  'user.provisioned': async ({ payload }) => { /* payload is UserProvisionedPayload */ },
  'user.updated':     async ({ payload }) => { /* … */ },
})

app.post('/portal/webhook', async ({ request }) => {
  const body = await request.text()
  if (!verifyWebhookSignature(/* … */)) return new Response('401', { status: 401 })
  await handlePortalEvents(JSON.parse(body))
  return new Response('OK')
})
```

The payload type for each handler is auto-derived from the event name —
no more hand-typed envelope shapes that drift from `@coms-portal/shared`.

### Replace the bespoke auth middleware with `requireBrokerAuth`

**Before:** ~30 lines extracting the bearer token, calling
`verifyBrokerToken`, attaching the user to context.

**After:**

```typescript
import { requireBrokerAuth } from '@coms-portal/sdk/elysia'

const app = new Elysia()
  .use(requireBrokerAuth({
    appSlug: 'heroes',
    jwksUrl: 'https://coms.ahacommerce.net/.well-known/jwks.json',
  }))
  .get('/me', ({ user }) => ({ portalSub: user.userId }))
```

### Replace `payload.appRole` reads with `getAppRole`

```typescript
import { getAppRole } from '@coms-portal/sdk'

const role = getAppRole(envelope) // string | null
```

Returns `null` for any non-`user.*` event and for malformed inputs;
defensive sanity-check via `getAppRole(envelope, { expectedAppSlug: 'heroes' })`.

### Replace the App Registry admin UI with manifest-as-code

Authoring step (in the H-app repo):

```typescript
// portal-manifest.ts
import { defineManifest } from '@coms-portal/sdk'

export default defineManifest({
  appId: 'heroes',
  displayName: 'Heroes',
  schemaVersion: 2,
  configSchema: { /* … */ },
  taxonomies: ['team'],
})
```

Deploy step (in CD pipeline):

```bash
coms-portal-cli register-manifest \
  --portal-url https://coms.ahacommerce.net \
  --app-slug heroes \
  --manifest ./portal-manifest.ts
```

The portal continues to accept human-driven registrations through the
admin UI — manifest-as-code is a parallel path, not a replacement.

### Opt into strict contract-version assertion

Once your H-app is comfortable failing loud on a future major:

```typescript
.use(requireBrokerAuth({ appSlug, jwksUrl, strictContractVersion: true }))

const dispatch = defineWebhookHandler(handlers, { strictContractVersion: true })
```

Both flags are no-ops when the wire payload's `contractVersion` field is
absent — safe to enable today.

### Replace bespoke test scaffolding with `@coms-portal/sdk/testing`

```typescript
import { mintTestBrokerToken, stubJwks, buildEnvelope } from '@coms-portal/sdk/testing'
```

See the README's "Testing your H-app" section for the full pattern.

## What stays the same

- `verifyBrokerToken`, `verifyWebhookSignature`, `signWebhookPayload`,
  `resolveAlias`, `introspectSession`, `getAuditLog` — same signatures,
  same behaviour, same imports.
- `BrokerTokenError`, `BrokerTokenPayload`, `VerifyBrokerTokenOptions`,
  the client-helper types — all preserved.
- HS256 broker-token verification still works in the entire 1.x line. It
  is removed in v2.0, gated on Heroes Phase 7.

## Rollback

Pin back to `#v0.1.1` and re-run `bun install`. No on-disk schema, no
state, no migration to undo. The portal-side route added in PR D is
backwards-compatible — H-apps still on v0.1.x continue to use the App
Registry admin UI.
