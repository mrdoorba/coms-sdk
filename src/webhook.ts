import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Compute HMAC-SHA256 webhook signature.
 *
 * Format: sha256=hex(HMAC-SHA256(secret, timestamp + '.' + payload))
 */
function computeSignature(secret: string, timestamp: string, payload: string): string {
  const mac = createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex')
  return `sha256=${mac}`
}

/**
 * Verify a COMS portal webhook signature using constant-time comparison.
 *
 * @param secret - The per-endpoint shared secret
 * @param timestamp - The value of the PORTAL_WEBHOOK_TIMESTAMP_HEADER header
 * @param rawBody - The raw request body string (JSON, before parsing)
 * @param signatureHeader - The value of the PORTAL_WEBHOOK_SIGNATURE_HEADER header
 * @returns true if the signature is valid, false otherwise
 */
export function verifyWebhookSignature(
  secret: string,
  timestamp: string,
  rawBody: string,
  signatureHeader: string,
): boolean {
  const expected = computeSignature(secret, timestamp, rawBody)
  if (signatureHeader.length !== expected.length) return false
  const a = Buffer.from(signatureHeader)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Sign a webhook payload. Returns the value to set on PORTAL_WEBHOOK_SIGNATURE_HEADER.
 */
export function signWebhookPayload(secret: string, timestamp: string, payload: string): string {
  return computeSignature(secret, timestamp, payload)
}
