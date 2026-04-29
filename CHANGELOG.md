# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-29

### Added

- `verifyBrokerToken(token, options)` — ES256 (JWKS) and HS256 (shared secret) broker token verification with typed `BrokerTokenError` discriminated by `code`
- `verifyWebhookSignature(payload, signature, secret, timestamp)` — HMAC-SHA256 constant-time webhook signature verification
- `signWebhookPayload(secret, timestamp, payload)` — webhook signing helper
- `resolveAlias(client, names)` — POST /api/aliases/resolve-batch with rate-limit header exposure
- `introspectSession(client, params)` — POST /api/auth/broker/introspect
- `getAuditLog(client, params)` — GET /api/v1/audit-log with cursor pagination
- `BrokerTokenError` class with discriminated `code`: `'expired' | 'invalid_signature' | 'invalid_audience' | 'invalid_issuer' | 'missing_kid' | 'unknown_kid' | 'malformed'`
