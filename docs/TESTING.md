# Verification

Latest verification: 24 September 2026.

The publication copy was installed from `package-lock.json` with `npm ci` and passed all 20 offline tests on Windows with Node.js 24.21.0. The syntax checker validated 14 JavaScript files and command definitions. Test configuration uses distinct synthetic IDs so it does not require a developer's private server settings. Tests use fixtures and temporary storage.

Four active-list regressions cover acknowledging a slash command before member retrieval, preserving membership/presence filters, exporting all 400 fixture members when the embed is too long, returning an empty prefix-command result, and resolving a deferred interaction after a failed fetch.

The [CI workflow](../.github/workflows/ci.yml) installs the locked dependencies and runs the same checks on Node.js 22. It uses a read-only repository token and does not register commands or start a bot. Its run history is separate evidence from the local result above.

A passing suite does not establish live Discord permissions, voice reliability or external API availability. No command registration or production bot startup is part of publication verification.

Run `npm ci`, `npm run check`, then `npm test` with Node.js 22 or newer.
