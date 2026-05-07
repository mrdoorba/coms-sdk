import { describe, it, expect } from 'bun:test'
import { APP_LAUNCHER as APP_LAUNCHER_FROM_SDK } from '../index.js'
import { APP_LAUNCHER as APP_LAUNCHER_FROM_SUBPATH } from '../constants/app-launcher.js'
import { APP_LAUNCHER as APP_LAUNCHER_FROM_SHARED } from '@coms-portal/shared/constants/app-launcher'

describe('APP_LAUNCHER re-export (Rev 4 Spec 02 §SA + 1.1.1 subpath)', () => {
  it('is the same reference whether imported via barrel, subpath, or shared', () => {
    expect(APP_LAUNCHER_FROM_SDK).toBe(APP_LAUNCHER_FROM_SHARED)
    expect(APP_LAUNCHER_FROM_SUBPATH).toBe(APP_LAUNCHER_FROM_SHARED)
  })

  it('exposes the portal and heroes entries used by Heroes (authed)/+layout.svelte', () => {
    expect(APP_LAUNCHER_FROM_SUBPATH.portal?.label).toBe('COMS')
    expect(APP_LAUNCHER_FROM_SUBPATH.heroes?.label).toBe('Heroes')
  })
})
