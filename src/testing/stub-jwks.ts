export interface StubJwksHandle {
  /** URL to feed `verifyBrokerToken({ jwksUrl })`. Unique per stub. */
  url: string
  /** Stop the underlying server. Idempotent. */
  restore: () => void
}

/**
 * Stand up a tiny HTTP server that serves the supplied JWKS at `/`. Use the
 * returned `url` as the `jwksUrl` option for `verifyBrokerToken`. Intended
 * for tests; the spec calls for a fetch interceptor, but a real
 * `Bun.serve`-backed server is simpler, doesn't depend on jose internals,
 * and works identically against `createRemoteJWKSet`.
 */
export function stubJwks(jwks: { keys: Record<string, unknown>[] }): StubJwksHandle {
  const body = JSON.stringify(jwks)
  const server = Bun.serve({
    port: 0,
    fetch: () =>
      new Response(body, {
        headers: { 'Content-Type': 'application/json' },
      }),
  })

  let stopped = false
  return {
    url: `http://localhost:${server.port}`,
    restore: () => {
      if (stopped) return
      stopped = true
      server.stop()
    },
  }
}
