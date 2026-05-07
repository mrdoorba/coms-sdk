// Rev 4 Spec 02 §VA — falsifiable proof that a v0.1.x consumer's import
// surface still resolves against @coms-portal/sdk@v1.0.0+ with zero code
// changes. Closes Spec 01 §AC #5. Run: `bun run examples/v0-compat-smoketest`.
//
// If any of these names ever stops being a function, this script throws —
// surfacing a v0 BC break before a real H-app discovers it.

import {
  verifyBrokerToken,
  verifyWebhookSignature,
  signWebhookPayload,
  resolveAlias,
  introspectSession,
  getAuditLog,
} from '@coms-portal/sdk'

const v0Surface = {
  verifyBrokerToken,
  verifyWebhookSignature,
  signWebhookPayload,
  resolveAlias,
  introspectSession,
  getAuditLog,
}

for (const [name, value] of Object.entries(v0Surface)) {
  if (typeof value !== 'function') {
    console.error(`v0 BC break: ${name} is ${typeof value}, expected function`)
    process.exit(1)
  }
}

console.log(`v0-compat-smoketest: all ${Object.keys(v0Surface).length} names resolve as functions.`)
