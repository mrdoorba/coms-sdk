# v0-compat-smoketest

Rev 4 Spec 02 §VA. Closes Spec 01 §AC #5.

A two-dozen-line consumer that imports the v0.1.x SDK surface
(`verifyBrokerToken`, `verifyWebhookSignature`, `signWebhookPayload`,
`resolveAlias`, `introspectSession`, `getAuditLog`) and asserts each one
resolves as a function. Run:

```sh
bun run examples/v0-compat-smoketest/index.ts
```

The script exits `0` on success, `1` if any v0 export has been removed,
renamed, or changed shape. Wire it into CI alongside `bun test` to keep
v0 BC honest as the SDK's surface evolves.
