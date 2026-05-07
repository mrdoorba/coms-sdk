#!/usr/bin/env bun
/**
 * coms-portal-cli — single-binary CD-pipeline helper shipped via the SDK's
 * `bin` entry. Today's only verb is `register-manifest`; future verbs are
 * added by future specs as needed.
 *
 * Exit codes (per Spec 01 §Surface):
 *   0 — success (or idempotent no-op upsert)
 *   1 — auth failure (no GCP creds, app not registered with serviceAccountEmail)
 *   2 — manifest validation failure (configSchema shape, missing args, slug mismatch)
 *   3 — network / portal error (5xx from portal, fetch failure)
 */

import { parseArgs } from 'node:util'
import { resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerManifest, type ManifestDefinition } from './manifest.js'
import { runSmoketest, type SmoketestResult } from './smoketest.js'

const HELP = `coms-portal-cli — CD-pipeline helper for COMS portal integrators

Usage:
  coms-portal-cli register-manifest \\
    --portal-url <url> \\
    --app-slug <slug> \\
    --manifest <path>

  coms-portal-cli smoketest \\
    --portal-url <url> \\
    --app-slug <slug> \\
    [--health-path <path>]      # default '/'

Auth (in priority order, both verbs):
  1. COMS_PORTAL_CLI_OIDC_TOKEN env var — a pre-minted OIDC ID token
     whose audience equals --portal-url. Use this in CD pipelines that
     mint tokens externally (e.g. google-github-actions/auth with
     token_format: 'id_token'). Bypasses google-auth-library entirely.
  2. Application Default Credentials. Cloud Run / GCB / GCE inherit
     them automatically; locally, run \`gcloud auth application-default
     login\` or set GOOGLE_APPLICATION_CREDENTIALS. Note: ADC paths
     using external_account credentials (WIF) with service-account
     impersonation cannot mint OIDC ID tokens through google-auth-
     library's getIdTokenClient — use #1 for those workflows.

Exit codes: 0 success, 1 auth failure, 2 validation, 3 network/portal.`

function exitWithError(code: 1 | 2 | 3, message: string): never {
  process.stderr.write(`coms-portal-cli: ${message}\n`)
  process.exit(code)
}

function isManifestShape(value: unknown): value is ManifestDefinition {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.appId === 'string' &&
    typeof v.displayName === 'string' &&
    typeof v.schemaVersion === 'number' &&
    typeof v.configSchema === 'object' &&
    v.configSchema !== null
  )
}

async function loadManifest(path: string): Promise<ManifestDefinition> {
  const abs = resolvePath(process.cwd(), path)
  let mod: { default?: unknown }
  try {
    mod = await import(pathToFileURL(abs).href)
  } catch (err) {
    exitWithError(2, `failed to load manifest at ${abs}: ${(err as Error).message}`)
  }
  const candidate = mod.default
  if (!isManifestShape(candidate)) {
    exitWithError(
      2,
      `manifest at ${abs} does not export a default ManifestDefinition (need appId, displayName, schemaVersion, configSchema)`,
    )
  }
  return candidate
}

async function runRegisterManifest(rest: string[]): Promise<void> {
  let parsed: { values: Record<string, string | undefined> }
  try {
    parsed = parseArgs({
      args: rest,
      options: {
        'portal-url': { type: 'string' },
        'app-slug': { type: 'string' },
        manifest: { type: 'string' },
      },
      strict: true,
    }) as { values: Record<string, string | undefined> }
  } catch (err) {
    exitWithError(2, `invalid arguments: ${(err as Error).message}`)
  }

  const portalUrl = parsed.values['portal-url']
  const appSlug = parsed.values['app-slug']
  const manifestPath = parsed.values.manifest

  if (!portalUrl || !appSlug || !manifestPath) {
    process.stderr.write(HELP + '\n')
    exitWithError(2, 'missing required arguments: --portal-url, --app-slug, --manifest are all required')
  }

  const manifest = await loadManifest(manifestPath)

  if (manifest.appId !== appSlug) {
    exitWithError(
      2,
      `manifest slug "${manifest.appId}" does not match --app-slug "${appSlug}"`,
    )
  }

  // Two pre-minted-token paths bypass google-auth-library:
  //   COMS_PORTAL_CLI_TEST_TOKEN — test-only; the unit tests set this so
  //     they don't need ADC / a working metadata server. The unique name
  //     prevents production CD from accidentally tripping it.
  //   COMS_PORTAL_CLI_OIDC_TOKEN — production-grade; CD environments that
  //     mint ID tokens externally (e.g. google-github-actions/auth with
  //     token_format: 'id_token') set this so the CLI does not invoke
  //     google-auth-library at all. Necessary for WIF + service-account
  //     impersonation chains, where getIdTokenClient cannot mint ID
  //     tokens locally.
  const testToken = process.env.COMS_PORTAL_CLI_TEST_TOKEN
  const oidcToken = process.env.COMS_PORTAL_CLI_OIDC_TOKEN
  const getIdToken = testToken
    ? async () => testToken
    : oidcToken
      ? async () => oidcToken
      : undefined

  let result
  try {
    result = await registerManifest({
      portalUrl,
      manifest,
      ...(getIdToken ? { getIdToken } : {}),
    })
  } catch (err) {
    const msg = (err as Error).message
    // 1 — auth failure surfaces as a credentials-load error from
    // google-auth-library or as a 401/403 from the portal
    if (
      /credentials/i.test(msg) ||
      /unauthorized|forbidden|missing_token|app_not_registered/i.test(msg) ||
      /\b40[13]\b/.test(msg)
    ) {
      exitWithError(1, `auth failure: ${msg}`)
    }
    // 2 — portal-side validation failures (slug mismatch, configSchema shape)
    if (/\b40[09]\b/.test(msg) || /\b422\b/.test(msg) || /validation_failed|app_slug_mismatch/i.test(msg)) {
      exitWithError(2, `validation failure: ${msg}`)
    }
    // 3 — network / 5xx
    exitWithError(3, `portal error: ${msg}`)
  }

  process.stdout.write(
    `Registered manifest for "${manifest.appId}" — schemaVersion=${result.schemaVersion}, registeredAt=${result.registeredAt}\n`,
  )
}

// ---------------------------------------------------------------------------
// smoketest verb (Spec 06 Rev 4 PR B)
// ---------------------------------------------------------------------------

function formatSmoketestReport(result: SmoketestResult): string {
  const lines: string[] = []

  // [1/3] Registry check
  if (result.steps.registry.ok && result.steps.registry.app) {
    const a = result.steps.registry.app
    lines.push(
      `[1/3] Registry check     → app registered, status=${a.status}, handoff_mode=${a.handoffMode}`,
    )
  } else {
    lines.push(`[1/3] Registry check     → FAILED: ${result.steps.registry.error ?? 'unknown error'}`)
  }

  // [2/3] App URL reachable
  if (result.steps.registry.ok) {
    if (result.steps.appUrl.ok) {
      lines.push(`[2/3] App URL reachable  → GET ${result.steps.appUrl.url}`)
      lines.push(`                            ✓ ${result.steps.appUrl.status} OK (${result.steps.appUrl.latencyMs}ms)`)
    } else {
      const probedUrl = result.steps.appUrl.url ?? '(skipped)'
      const reason =
        result.steps.appUrl.status !== undefined
          ? `${result.steps.appUrl.status} ${result.steps.appUrl.error ?? ''}`.trim()
          : (result.steps.appUrl.error ?? 'unknown error')
      lines.push(`[2/3] App URL reachable  → GET ${probedUrl}`)
      lines.push(`                            ✗ ${reason}`)
    }
  } else {
    lines.push(`[2/3] App URL reachable  → SKIPPED (step 1 failed)`)
  }

  // [3/3] Webhook delivery
  if (result.steps.registry.ok) {
    lines.push(`[3/3] Webhook delivery   → POST <portal>/api/v1/apps/<slug>/smoketest`)
    if (result.steps.webhook.endpoints.length === 0) {
      lines.push(`                            (no webhook endpoints registered)`)
    } else {
      for (const ep of result.steps.webhook.endpoints) {
        const mark = ep.status !== null && ep.status >= 200 && ep.status < 300 ? '✓' : '✗'
        const errSuffix = ep.error ? `  error="${ep.error}"` : ''
        lines.push(
          `                            ${mark} endpoint=${ep.url}  status=${ep.status ?? 'null'}  latency=${ep.latencyMs}ms${errSuffix}`,
        )
      }
    }
  } else {
    lines.push(`[3/3] Webhook delivery   → SKIPPED (step 1 failed)`)
  }

  lines.push(result.ok ? '' : '')
  lines.push(result.ok ? 'Smoketest OK.' : 'Smoketest FAILED.')
  return lines.join('\n')
}

async function runSmoketestCli(rest: string[]): Promise<void> {
  let parsed: { values: Record<string, string | undefined> }
  try {
    parsed = parseArgs({
      args: rest,
      options: {
        'portal-url': { type: 'string' },
        'app-slug': { type: 'string' },
        'health-path': { type: 'string' },
      },
      strict: true,
    }) as { values: Record<string, string | undefined> }
  } catch (err) {
    exitWithError(2, `invalid arguments: ${(err as Error).message}`)
  }

  const portalUrl = parsed.values['portal-url']
  const appSlug = parsed.values['app-slug']
  const healthPath = parsed.values['health-path']

  if (!portalUrl || !appSlug) {
    process.stderr.write(HELP + '\n')
    exitWithError(2, 'missing required arguments: --portal-url and --app-slug are both required')
  }

  // Same auth-token resolution as register-manifest. The two env vars are
  // intentionally distinct from each other: TEST_TOKEN exists for unit tests
  // so they don't need a working metadata server, OIDC_TOKEN is the
  // production CD-pipeline path for WIF + impersonation chains.
  const testToken = process.env.COMS_PORTAL_CLI_TEST_TOKEN
  const oidcToken = process.env.COMS_PORTAL_CLI_OIDC_TOKEN
  const getIdToken = testToken
    ? async () => testToken
    : oidcToken
      ? async () => oidcToken
      : async (audience: string) => {
          // Mirror manifest.ts:defaultGetIdToken so the smoketest CLI works
          // out of the box on Cloud Run / GCB / GCE without an explicit
          // env-var. Lazy import keeps consumers without google-auth-library
          // (e.g. tests) from paying the load cost.
          const mod = await import('google-auth-library')
          const auth = new mod.GoogleAuth()
          const client = await auth.getIdTokenClient(audience)
          const headers = await client.getRequestHeaders()
          let bearer: string | undefined
          if (headers instanceof Headers) {
            bearer = headers.get('Authorization') ?? undefined
          } else if (headers && typeof headers === 'object') {
            bearer = (headers as Record<string, string>).Authorization
          }
          if (!bearer || !bearer.startsWith('Bearer ')) {
            throw new Error('google-auth-library returned no Bearer token')
          }
          return bearer.slice('Bearer '.length)
        }

  let result: SmoketestResult
  try {
    result = await runSmoketest({
      portalUrl,
      appSlug,
      getIdToken,
      ...(healthPath ? { healthPath } : {}),
    })
  } catch (err) {
    // runSmoketest does not throw on contract failures, only on programmer
    // error. Treat as a network/portal class.
    exitWithError(3, `smoketest crashed: ${(err as Error).message}`)
  }

  const report = formatSmoketestReport(result)
  process.stdout.write(`${report}\n`)

  if (result.ok) return

  // Map the failed step → exit code, mirroring register-manifest's classes.
  if (!result.steps.registry.ok) {
    const err = result.steps.registry.error ?? ''
    if (/\b40[13]\b/.test(err) || /unauthorized|forbidden|missing_token/i.test(err)) {
      process.exit(1) // auth failure
    }
    if (/\b40[49]\b/.test(err) || /not registered|not active/i.test(err)) {
      process.exit(2) // validation: unregistered or inactive
    }
    process.exit(3) // network / portal 5xx
  }
  // Step 2 or 3 failure — both are network/portal class.
  process.exit(3)
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)

  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(HELP + '\n')
    process.exit(0)
  }

  const sub = argv[0]
  const rest = argv.slice(1)

  if (sub === 'register-manifest') {
    await runRegisterManifest(rest)
    return
  }
  if (sub === 'smoketest') {
    await runSmoketestCli(rest)
    return
  }

  process.stderr.write(`coms-portal-cli: unknown subcommand "${sub}"\n${HELP}\n`)
  process.exit(2)
}

await main()
