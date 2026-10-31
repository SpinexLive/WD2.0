# Discord Seeding AFK protection

Seeding is determined solely by the connected player count being below the configured threshold. The dashboard polls the game server through the existing direct RCON connection. No event feed, webhook, or extra token is required.

## Setup

1. Keep `GAME_RCON_URL` (the game listener origin, without `/v1`) and `GAME_RCON_PASSWORD` in the dashboard environment.
2. Apply database migrations with `npm run migrate:local` for the local environment, or the existing production migration process. Migrations 024 and 025 provide settings, registrations and reminder scheduling.
3. Restart the dashboard.
4. Open **Admin → Seeding AFK**, set the player threshold and switch interval, enter the Discord channel ID, and choose **Save and publish embed**. The bot needs View Channel, Send Messages and Embed Links. An existing message must belong to this bot.
5. Players with an existing Discord → Steam link can click **Seeding AFK** while connected. **I'm back** stops their reminders and team switching.

Official account links use the existing Wardogs API key with the `links` scope. Manual dashboard links also work. Account linking is always required and names are never used to identify accounts. An old `SEEDING_AFK_FEED_TOKEN` setting can be removed; this feature no longer reads it.

## Behaviour

- Defaults: enabled, player threshold 20, team switching every 120 seconds. The threshold and switch interval are configurable in Admin.
- Polls every 15 seconds and reads fresh player counts before each action. The larger of the status count and roster count is used. Below the threshold, players can opt in. At or above it, all registrations are cleared and both switching and reminders stop.
- Once the threshold has been reached, protection stays off for that server session even if the count drops or the threshold setting is raised. A server process restart or map change starts a fresh session and clears old registrations. A dashboard restart clears registrations but preserves the threshold stop.
- Match readiness is inferred from population. There is no match-state integration. A same-map match restart without a process restart cannot be distinguished from the same session; it does not reopen protection after the threshold stop. A match manually started below the configured threshold is still treated as seeding.
- Connected, registered players receive a private in-game reminder on the next polling pass after registration, then every 60 seconds, with up to one polling interval of delay. It directs them to click **I'm back** in Discord. Reminder scheduling is independent of team moves and balance. Failed whispers are logged and retried at the next minute without replaying ambiguous HTTP requests.
- Disconnects clear registrations on the next roster poll. A disconnect/reconnect entirely between polls cannot be detected. Returning players must register again after an observed disconnect.
- Reads `/v1/health`, `/v1/status`, `/v1/players`, and `/v1/config`. Uptime/map identify the server session. Complete player IDs, faction names and explicit `bLockOverpopulatedTeamsConfig` / `OverpopulatedTeamThresholdConfig` settings are required. Missing safety data or RCON outages stop actions and clear registrations. Healthy low-population polling allows fresh registration after recovery.
- Supports multiple factions. A move must leave the population spread at most one, must not worsen the existing spread, and must satisfy the configured server overpopulation threshold. Unknown/unassigned factions prevent moves. Even teams may prevent all switching, so protection against AFK kicks is best effort.
- Team moves use `PATCH /v1/players/{steamId}` with `{ faction }`; reminders use `POST /v1/players/{steamId}/message`. This feature does not kill players or alter inactivity settings. Whether changing faction resets the installed build's AFK timer needs a staging check.
- Shared database locks serialize actions across workers. Cooldowns are committed before requests; game writes are not automatically retried. A return removes consent immediately and drains any request already in flight before acknowledging. A request already accepted by the game cannot be cancelled.
- Saving settings clears registrations. Registration, withdrawal, disconnects, switches, skips, errors, threshold and termination events appear in the existing Admin audit log. Admin lists current registered accounts, next checks, population and polling errors.

## Validation

Use a staging server to verify that only opted-in connected players receive reminders and balanced team changes. Test **I'm back**, disconnects, threshold crossing followed by a population drop, map/process restarts, RCON outages, and dashboard restarts. Tests mock game writes and do not affect the live server.

The dashboard needs persistent Node hosting, as do the existing Discord gateway and schedulers.
