import { describe, it, expect } from 'bun:test'
import { verifyWebhookSignature, signWebhookPayload } from '../webhook.js'

const SECRET = 'test-webhook-secret-abc123'
const TIMESTAMP = '1714300000'
const PAYLOAD = '{"event":"user.provisioned","data":{}}'

describe('verifyWebhookSignature', () => {
  it('returns true for a valid signature', () => {
    const sig = signWebhookPayload(SECRET, TIMESTAMP, PAYLOAD)
    expect(verifyWebhookSignature(SECRET, TIMESTAMP, PAYLOAD, sig)).toBe(true)
  })

  it('returns false when secret is wrong', () => {
    const sig = signWebhookPayload(SECRET, TIMESTAMP, PAYLOAD)
    expect(verifyWebhookSignature('wrong-secret', TIMESTAMP, PAYLOAD, sig)).toBe(false)
  })

  it('returns false when payload is tampered', () => {
    const sig = signWebhookPayload(SECRET, TIMESTAMP, PAYLOAD)
    expect(verifyWebhookSignature(SECRET, TIMESTAMP, '{"tampered":true}', sig)).toBe(false)
  })

  it('returns false when timestamp is tampered', () => {
    const sig = signWebhookPayload(SECRET, TIMESTAMP, PAYLOAD)
    expect(verifyWebhookSignature(SECRET, '9999999999', PAYLOAD, sig)).toBe(false)
  })

  it('returns false when signature has different length (constant-time guard)', () => {
    const valid = signWebhookPayload(SECRET, TIMESTAMP, PAYLOAD)
    expect(verifyWebhookSignature(SECRET, TIMESTAMP, PAYLOAD, valid + 'x')).toBe(false)
    expect(verifyWebhookSignature(SECRET, TIMESTAMP, PAYLOAD, valid.slice(0, -1))).toBe(false)
  })

  it('produces sha256=hex(...) format', () => {
    const sig = signWebhookPayload(SECRET, TIMESTAMP, PAYLOAD)
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/)
  })

  it('uses constant-time comparison (timingSafeEqual, not string ===)', () => {
    const valid = signWebhookPayload(SECRET, TIMESTAMP, PAYLOAD)
    const tampered = valid.slice(0, -2) + '00'
    expect(verifyWebhookSignature(SECRET, TIMESTAMP, PAYLOAD, tampered)).toBe(false)
  })
})

describe('signWebhookPayload', () => {
  it('produces deterministic output', () => {
    const a = signWebhookPayload(SECRET, TIMESTAMP, PAYLOAD)
    const b = signWebhookPayload(SECRET, TIMESTAMP, PAYLOAD)
    expect(a).toBe(b)
  })

  it('is cross-verified by verifyWebhookSignature', () => {
    const sig = signWebhookPayload('my-secret', '1234567890', '{"hello":"world"}')
    expect(verifyWebhookSignature('my-secret', '1234567890', '{"hello":"world"}', sig)).toBe(true)
  })
})
