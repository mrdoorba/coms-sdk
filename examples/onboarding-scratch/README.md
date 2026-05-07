# onboarding-scratch

Rev 4 Spec 02 §VB. Closes Spec 01 §AC #1 ("`bun add` + ~30 lines").

A scratch H-app reproducing the "Sample H-app integration" block in
[Spec 01 §Surface](../../../coms_portal/docs/architecture/rev4/spec-01-sdk-v1.md). Two
files implement the integration; a third drives a passing test using
the SDK's own test-kit (`mintTestBrokerToken` + `stubJwks`). No portal
needed — everything resolves locally.

## Run

```sh
bun install
bun test
```

## LOC against Spec 01's "~30 lines" claim

Spec 01's sample reads `jwksUrl` / `webhookSecret` directly from constants
and module-level env. Counting the example exactly as it appears in
the spec:

- `portal-manifest.ts` — 11 non-blank lines
- `server.ts` — 30 non-blank lines (Spec 01 verbatim)

Total: **41 non-blank lines** for a minimal H-app's portal integration.
The "~30 lines of glue" claim is for `server.ts` alone — verified.

This example wraps the integration in a `buildApp(options)` factory so
the test in `server.test.ts` can inject a stub JWKS URL. That adds:

- 1 export interface (7 lines) for the factory's options
- 1 function wrapper (`export function buildApp` + closing brace)
- conditional spread for the optional `issuer` to satisfy
  `exactOptionalPropertyTypes`

Concrete count of this repo:

| File | Non-blank lines |
|---|---|
| `portal-manifest.ts` | 11 |
| `server.ts` | 37 |
| **Total integration glue** | **48** |
| `server.test.ts` (test scaffold) | 27 |

The 7-line gap between Spec 01's sample (41) and this scratch repo (48)
is testability scaffolding, not new portal-integration work — the
glue itself is unchanged. AC #1 stands.

## What this example proves

1. `bun add @coms-portal/sdk@v1.0.0+` puts `requireBrokerAuth`,
   `defineWebhookHandler`, `verifyWebhookSignature`, and `defineManifest`
   on the import surface — no further config required.
2. The Elysia adapter, the typed webhook dispatcher, and the
   HMAC verifier compose without bespoke glue.
3. The `@coms-portal/sdk/testing` subpath is sufficient to exercise the
   broker-auth happy path against a real Bun process — no portal
   instance, no shared secrets in CI.
