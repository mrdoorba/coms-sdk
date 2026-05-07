# Supported Versions

| Version | Status                       | Security Fixes Until    |
|---------|------------------------------|-------------------------|
| 0.2.x   | Pre-release (v1.0 milestone) | Superseded by v1.0 cut  |
| 0.1.x   | Active                       | Current                 |

Versions not listed above are no longer supported and will not receive security updates.

## Support Policy

- **Active** — receives new features, bug fixes, and security patches.
- **Pre-release (v1.0 milestone)** — working release line that lands the SDK v1.0 surface PR-by-PR (A–H per Rev 4 Spec 01). Each minor (`0.2.0` → `0.8.0`) is consumable but not semver-stable; consumers should pin to an exact tag in their `package.json`. The v0.1.x export surface remains backwards-compatible across the entire pre-release line. Once PR H cuts `1.0.0`, this row collapses to the v1.0 row.
- **Security-only** — receives security patches only; no new features or bug fixes.
- **Unsupported** — no longer maintained. Upgrade to an active version.

Pre-1.0 versions (0.x.x) may receive breaking changes between minor releases.
Pin to a specific tag (`#v0.1.0`) in your package manager to avoid unexpected updates.
