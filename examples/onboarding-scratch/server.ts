import { Elysia } from 'elysia'
import { requireBrokerAuth } from '@coms-portal/sdk/elysia'
import { defineWebhookHandler, verifyWebhookSignature } from '@coms-portal/sdk'

export interface ServerOptions {
  jwksUrl: string
  issuer?: string
  webhookSecret: string
}

export function buildApp(options: ServerOptions) {
  const app = new Elysia()
    .use(
      requireBrokerAuth({
        appSlug: 'heroes',
        jwksUrl: options.jwksUrl,
        ...(options.issuer ? { issuer: options.issuer } : {}),
      }),
    )
    .get('/me', ({ user }) => ({ portalSub: user.userId, role: user.portalRole }))

  const handlePortalEvents = defineWebhookHandler({
    'user.provisioned': async ({ payload, envelope }) => {},
    'user.updated': async ({ payload, envelope }) => {},
    'user.offboarded': async ({ payload, envelope }) => {},
  })

  app.post('/portal/webhook', async ({ request }) => {
    const body = await request.text()
    const ok = verifyWebhookSignature(
      options.webhookSecret,
      request.headers.get('x-portal-webhook-timestamp')!,
      body,
      request.headers.get('x-portal-webhook-signature')!,
    )
    if (!ok) return new Response('Invalid signature', { status: 401 })

    await handlePortalEvents(JSON.parse(body))
    return new Response('OK')
  })

  return app
}
