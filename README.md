# Swiz Community Bot

Discord community tools for support tickets, moderation, attendance and persistent event rosters. A supporting technical project in [Kuzey's game design portfolio](https://github.com/Lloydhf).

**Status:** configurable source release; live deployment requires your own Discord application and server settings.

## What to review

- Ticket ownership and concurrent requests: [tickets](src/tickets.js).
- Event capacity, waiting lists and saved rosters: [activities](src/activities.js).
- SQLite migrations and local backups: [database](src/database.js).
- Permission failures and recovery behavior: [offline tests](test/core.test.js).
- Slow member lookups and large active-member lists: [active-list regression tests](test/aktif.test.js).

The September 2026 update acknowledges `/aktif` before fetching members, then edits the response when the result is ready. Lists larger than Discord's embed limit include a complete text attachment. Both slash and prefix command behavior are covered by offline tests.

## Run locally

Use Node.js 22+. Run `npm ci`. Copy `.env.example` to `.env` and `config.example.json` to `config.local.json`, then provide your own configuration. `PRIVILEGED_ID_1` through `PRIVILEGED_ID_4` replace deployment-specific IDs in the legacy permission map; leave them empty to grant no additional access, or configure intentionally. Never commit local configuration.

Run `npm run check` and `npm test`. [GitHub Actions](.github/workflows/ci.yml) repeats these checks on Node.js 22 for pushes and pull requests without bot credentials. Start with `npm start` only when ready to connect to Discord. Startup registers global slash commands. Enable the privileged intents required by the bot in your own application and test on a dedicated server.

## Design and limitations

Statistics count messages and time connected to voice; they do not record message contents or audio. SQLite files, backups, tokens and local server configuration are excluded. The bot assumes one process and one configured community. Real permission hierarchy, voice and FiveM connectivity require live checks.

[Türkçe kullanım rehberi](docs/GUIDE_TR.md) · [Case study](docs/PORTFOLIO.md) · [Verification](docs/TESTING.md)

## Authorship and assistance

This repository documents a project developed and maintained with AI assistance. Project direction and local configuration belong to Kuzey (Lloydhf); OpenAI Codex assisted with implementation, tests and documentation. This is not a claim that every line was written independently. Third-party dependencies retain their own licenses. Personal design reflections and playtest findings should be added by Kuzey after doing the work.
