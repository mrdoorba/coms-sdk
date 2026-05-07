import { defineManifest } from '@coms-portal/sdk'

export default defineManifest({
  appId: 'heroes',
  displayName: 'Heroes',
  schemaVersion: 1,
  configSchema: {
    weeklyDigestDay: { type: 'enum', values: ['mon', 'tue', 'wed', 'thu', 'fri'], default: 'fri' },
    notifyOnAssignment: { type: 'boolean', default: true },
  },
  taxonomies: ['team', 'department'],
})
