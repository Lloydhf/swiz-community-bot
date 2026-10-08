# Verification

Latest local verification: 8 October 2026.

The current public source was cloned into a clean folder, installed from `package-lock.json` with `npm ci`, and passed all 20 offline tests on Windows with Node.js 24.21.0. The syntax checker validated 14 JavaScript files and command definitions. The latest local bot contains no additional application changes beyond the published September update; the public copy retains configurable permissions and synthetic test IDs instead of private deployment values. Tests use fixtures and temporary storage.

Four active-list regressions cover acknowledging a slash command before member retrieval, preserving membership/presence filters, exporting all 400 fixture members when the embed is too long, returning an empty prefix-command result, and resolving a deferred interaction after a failed fetch.

The [CI workflow](../.github/workflows/ci.yml) installs the locked dependencies and runs the same checks on Node.js 22. It uses a read-only repository token and does not register commands or start a bot. The [24 September run](https://github.com/Lloydhf/swiz-community-bot/actions/runs/35990557566) succeeded for application commit `b0f70b0`; this result was checked again on 8 October. It is separate evidence from the fresh local test run above. This documentation update adds no bot features.

A passing suite does not establish live Discord permissions, voice reliability or external API availability. No command registration or production bot startup is part of publication verification.

Run `npm ci`, `npm run check`, then `npm test` with Node.js 22 or newer.
