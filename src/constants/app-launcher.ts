// Subpath re-export of APP_LAUNCHER (Rev 4 Spec 02 §SA follow-up). Lets
// browser-bundled consumers (Heroes' SvelteKit web layout) import the
// constant without the bundler scanning the SDK's barrel — which transitively
// pulls webhook.ts (`node:crypto`) and manifest.ts (`google-auth-library`)
// into the browser graph and fails the build.
//
// The top-level `export { APP_LAUNCHER } from '@coms-portal/sdk'` stays for
// server-side consumers; this subpath is the bundle-safe path.

export { APP_LAUNCHER } from '@coms-portal/shared/constants/app-launcher'
