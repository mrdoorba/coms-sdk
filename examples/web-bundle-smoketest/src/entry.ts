// Reproduce Heroes' (authed)/+layout.svelte import path verbatim. After F4
// (Rev 4 Spec 02), the bundle-safe path for browser-rendered consumers is
// the explicit subpath, NOT the SDK barrel.
import { APP_LAUNCHER } from '@coms-portal/sdk/constants/app-launcher'

// Type-only barrel import — vanishes at compile time. Confirms the barrel's
// type surface is reachable from a browser consumer without dragging any
// runtime modules into the graph (types are erased before bundling).
import type { PortalSessionUser } from '@coms-portal/sdk'

// Anchor the constant in the global scope so Rollup's tree-shake can't drop
// it. Without this anchor the test would still pass on a no-op bundle that
// optimised the import away — the COMS sentinel assertion would then fail
// for the wrong reason.
declare global {
  // eslint-disable-next-line no-var
  var __APP_LAUNCHER: typeof APP_LAUNCHER
  // eslint-disable-next-line no-var
  var __PORTAL_SESSION_USER_TYPE: PortalSessionUser | undefined
}

globalThis.__APP_LAUNCHER = APP_LAUNCHER
globalThis.__PORTAL_SESSION_USER_TYPE = undefined
