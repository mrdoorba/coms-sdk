import { describe, it, expect } from 'bun:test'
import { APP_LAUNCHER as APP_LAUNCHER_FROM_SDK } from '../index.js'
import { APP_LAUNCHER as APP_LAUNCHER_FROM_SHARED } from '@coms-portal/shared/constants/app-launcher'

describe('APP_LAUNCHER re-export (Rev 4 Spec 02 §SA)', () => {
  it('is the same reference as the shared-package export', () => {
    expect(APP_LAUNCHER_FROM_SDK).toBe(APP_LAUNCHER_FROM_SHARED)
  })

  it('exposes the portal and heroes entries used by Heroes (authed)/+layout.svelte', () => {
    expect(APP_LAUNCHER_FROM_SDK.portal?.label).toBe('COMS')
    expect(APP_LAUNCHER_FROM_SDK.heroes?.label).toBe('Heroes')
  })
})
