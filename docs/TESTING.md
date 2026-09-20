# Verification

Publication preparation: 20 September 2026.

The publication copy passed all 16 existing offline tests. The syntax checker validated 13 JavaScript files and command definitions. Test configuration uses distinct synthetic IDs so it does not require a developer's private server settings. Tests use fixtures and temporary storage. A passing suite does not establish live Discord permissions, voice reliability or external API availability. No command registration or production bot startup is part of publication verification.

Run `npm ci`, `npm run check`, then `npm test` with Node.js 22 or newer.
