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

const HELP = `coms-portal-cli — register an H-app's portal manifest

Usage:
  coms-portal-cli register-manifest \\
    --portal-url <url> \\
    --app-slug <slug> \\
    --manifest <path>

Auth (in priority order):
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

  process.stderr.write(`coms-portal-cli: unknown subcommand "${sub}"\n${HELP}\n`)
  process.exit(2)
}

await main()
