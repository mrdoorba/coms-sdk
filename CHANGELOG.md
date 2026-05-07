# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] (v1.0 milestone)

Working release line for the SDK v1.0 surface (Rev 4 Spec 01). Each PR (A–H)
ships as its own minor version (`0.2.0` → `0.8.0`); PR H cuts `1.0.0` and
locks the surface under semver. The v0.1.x surface (`verifyBrokerToken`,
`verifyWebhookSignature`, `signWebhookPayload`, `resolveAlias`,
`introspectSession`, `getAuditLog`) is preserved verbatim through the entire
1.x line — the v1.0 additions are purely additive. HS256 verification stays
in v1.x and is removed in v2.0 once Heroes Phase 7 lands.

### Added in 0.3.0

- **Typed webhook envelope.** `defineWebhookHandler(map)` returns a
  dispatcher that type-discriminates on `envelope.event` and invokes the
  matching handler with `{ payload, envelope }` where both are typed via
  `PayloadFor<E>`. Unknown events throw a typed `WebhookEnvelopeError` with
  `code: 'malformed' | 'unknown_event'`. Unhandled known events are silent
  no-ops so an H-app subscribes only to what it cares about.
- **Role envelope reader.** `getAppRole(envelope, options?)` extracts the
  resolved app-local role from `user.provisioned` / `user.updated`
  envelopes per the 2026-05-06 portal role refactor. Returns `null` for
  any other event, malformed input, or absent role. Optional
  `expectedAppSlug` argument acts as a defensive sanity check on shared
  receivers.
- **Type re-exports from `@coms-portal/shared`.** H-apps now import every
  contract type they need from `@coms-portal/sdk` — webhook payloads,
  envelopes, headers, session/auth contracts, integration manifest types
  and helpers. Heroes (and any consumer still importing from `shared`
  directly) continues to work; this is purely additive.

### Added in 0.2.0

- `@coms-portal/shared` is now a runtime dependency (pinned to `v1.6.0`),
  enabling the SDK to re-export the platform's contract types directly to
  H-app consumers. No surface change yet — re-exports land in 0.3.0 (PR B).
- Typecheck passes under jose v6 — replaced the removed `KeyLike` type with
  `CryptoKey` in tests and made the `algorithms` JWT verify option
  conditionally spread to satisfy `exactOptionalPropertyTypes`.

## [0.1.1] - 2026-04-29

### Performance

- JWKS RemoteJWKSet now cached per-URL at module level instead of re-instantiated per call. Closes Spec 03c red-cell finding F-3.

## [0.1.0] - 2026-04-29

### Added

- `verifyBrokerToken(token, options)` — ES256 (JWKS) and HS256 (shared secret) broker token verification with typed `BrokerTokenError` discriminated by `code`
- `verifyWebhookSignature(payload, signature, secret, timestamp)` — HMAC-SHA256 constant-time webhook signature verification
- `signWebhookPayload(secret, timestamp, payload)` — webhook signing helper
- `resolveAlias(client, names)` — POST /api/aliases/resolve-batch with rate-limit header exposure
- `introspectSession(client, params)` — POST /api/auth/broker/introspect
- `getAuditLog(client, params)` — GET /api/v1/audit-log with cursor pagination
- `BrokerTokenError` class with discriminated `code`: `'expired' | 'invalid_signature' | 'invalid_audience' | 'invalid_issuer' | 'missing_kid' | 'unknown_kid' | 'malformed'`
