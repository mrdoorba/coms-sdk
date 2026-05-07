# web-bundle-smoketest

Rev 4 Spec 02 D1 regression canary. Closes
[`mrdoorba/coms-sdk#1`](https://github.com/mrdoorba/coms-sdk/issues/1).

## What this proves

Browser-bundles a consumer that imports `APP_LAUNCHER` through the SDK's
`@coms-portal/sdk/constants/app-launcher` subpath (the same path Heroes'
SvelteKit `(authed)/+layout.svelte` uses), then asserts the produced bundle
contains no server-only symbols (`createHmac`, `node:crypto`,
`timingSafeEqual`, `google-auth-library`, `GoogleAuth`) and does carry the
`APP_LAUNCHER.portal.label` sentinel `'COMS'`.

## What D1 was

Heroes' first CD run after Spec 02 PR HA died at
`vite-plugin-sveltekit-compile`:

> `node_modules/.bun/@coms-portal+sdk@.../webhook.ts (1:9): "createHmac" is
> not exported by "__vite-browser-external"`

Cause: `(authed)/+layout.svelte` imported `APP_LAUNCHER` from the SDK
barrel. Without `"sideEffects": false`, Rollup conservatively pulled
`webhook.ts` (`node:crypto`) and `manifest.ts` (lazy
`google-auth-library`) into the browser graph alongside the constant.

Fix (F3 + F4):

- SDK declared `"sideEffects": false` package-wide.
- SDK opened a `./constants/app-launcher` subpath that re-exports only
  `APP_LAUNCHER`.
- Heroes' layout flipped to `import { APP_LAUNCHER } from
  '@coms-portal/sdk/constants/app-launcher'`.

This smoketest exercises the `F4` import path under a real `vite build` and
will fail if anyone removes `sideEffects: false`, merges server-only code
into a barrel-loaded module, or otherwise regresses the fix — surfaced
inside the SDK repo before it ships to a downstream H-app.

## Run

```sh
cd examples/web-bundle-smoketest
bun install
bun test
```

`bun test` invokes Vite programmatically, builds to `dist/`, scans every
`dist/assets/*.js` file, and asserts the rules above.

## Why not the barrel

If you flip `src/entry.ts` to import `APP_LAUNCHER` from `'@coms-portal/sdk'`
instead of the subpath, the build crashes with the same class of error D1
exhibited (`MISSING_EXPORT` on `createHmac`). The subpath remains the
bundle-safe path for browser consumers.
