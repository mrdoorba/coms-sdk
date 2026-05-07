# Supported Versions

| Version | Status         | Security Fixes Until                |
|---------|----------------|-------------------------------------|
| 1.0.x   | Active         | Current                             |
| 0.2–0.8 | Archived       | None — superseded by 1.0.0          |
| 0.1.x   | Security-only  | Until v2.0 cut (HS256 removal)      |

Versions not listed above are no longer supported and will not receive security updates.

## Support Policy

- **Active** — receives new features, bug fixes, and security patches. Consumers may pin via semver range (`^1.0.0`).
- **Security-only** — receives security patches only; no new features or bug fixes. Consumers should plan migration to the Active line.
- **Archived** — pre-release versions cut on the path to v1.0.0 (`0.2.0` through `0.8.0`, one per Rev 4 Spec 01 PR). Tags remain on the repo for archival reference but receive no fixes; upgrade to `^1.0.0`.
- **Unsupported** — no longer maintained.

The 1.x line is semver-stable. Breaking changes increment the major:
v2.0 (planned) drops HS256 broker-token verification, gated on Heroes
Phase 7.
