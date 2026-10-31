# Discord Seeding AFK protection

This feature is available under **Admin → Seeding AFK** (dashboard owner only).
It uses the existing official/manual Discord → Steam links. It never matches names.
Account linking is mandatory; the return button always permits withdrawal even if links are unavailable.

## Setup

1. Apply migrations with `npm run migrate:local` for the local environment (or the existing production migration process). Migration 024 creates the settings and registrations tables.
2. Configure `GAME_RCON_URL` (the game listener origin, without `/v1`) and `GAME_RCON_PASSWORD`. Set `WARDOGS_API_KEY` with the `links` scope for official account links. Manual dashboard links also work.
3. Add `SEEDING_AFK_FEED_TOKEN` to the server environment, using a unique random secret of at least 32 characters. Restart the dashboard. Never expose this token to browsers or put it in a Discord embed.
4. In the game server's Season 2 event feed configuration, add an endpoint whose URL is `https://YOUR-DASHBOARD/api/seeding-afk/feed` and whose Token is that secret. Use a dedicated secret and endpoint for this one game server. Preserve other existing feed endpoints. Enable the feed with `bEventFeedEnabled=True`; configure `EventFeedEndpoints` in the server config file, as required by your game build/host. This feature does not modify game config.
5. In Admin, choose the player threshold, interval, channel ID, and embed text. **Save and publish embed** creates a bot message, or updates the configured existing bot message. The bot needs View Channel, Send Messages and Embed Links. Existing messages must be owned by this bot. Changing channel clears the message ID.
6. Allow the game to enter a new waiting-for-players pre-match state. Protection will not start from population alone. Check the displayed state/reason before asking players to register. Discord buttons work through the existing gateway or signed interactions endpoint.

Default settings enable protection, use a 120-second interval and a configurable threshold initially set to 20. Nothing moves until setup, a confirmed pre-match event, and individual registration. Settings saves clear registrations. The normal running Node dashboard process owns polling; this requires persistent hosting, just like the existing Discord gateway and schedulers.

## Behaviour and limits

- Registered, connected players receive a private in-game reminder on the next polling pass after registration, then every 60 seconds (with up to one polling interval of delay). It tells them they are Seeding AFK and to click **I'm back** in Discord when they return. Withdrawal, disconnect, threshold shutdown and session cleanup stop reminders alongside team switching. Reminder delivery is independent of team balance and the team-switch interval. Failed whispers are logged and attempted again at the next reminder interval, without disabling protection. Apply migration 025 before running this version. Existing `GAME_RCON_URL` and `GAME_RCON_PASSWORD` settings are reused.

- Polls every 15 seconds and reads uncached game data again before every move. Player-count events can terminate protection between polls. The larger of the status count and roster count is used. Counts at or above the threshold latch protection off for that session, including after population falls or settings change. Only a new pre-match session can reopen protection.
- Requires `MatchState.PreMatch.WaitingForPlayers` or its `.PlayerCount` substate from the authenticated game feed. Playing, post-match, match end, map change, process restart, or unavailable safety data clear registrations. After a safety-data failure, wait for a new pre-match transition. A dashboard restart also clears all registrations.
- Reads `/v1/health`, `/v1/status`, `/v1/players`, and `/v1/config`. It requires uptime, a complete uniquely identified roster, faction names, and explicit `bLockOverpopulatedTeamsConfig` / `OverpopulatedTeamThresholdConfig` settings. Missing data stops protection. Direct RCON is required because the hosted API's documented live response does not establish all these safety signals.
- Supports the game's multiple factions. Chooses a different faction only if the resulting population spread is at most one, does not worsen the existing spread, and satisfies the configured overpopulation threshold. Unknown/unassigned factions cause the move to be skipped. Evenly populated teams may therefore prevent moves entirely. **Team switching is best effort and is not a guarantee against AFK kicks.** Whether a faction change resets inactivity must be verified on the installed game build.
- Uses only `PATCH /v1/players/{steamId}` with `{ faction }`; it does not kill players or change AFK settings. The API cannot atomically check population, connectivity and balance with a move: a player can join/leave or a match can start during a request already in flight. The worker checks before each request; it cannot cancel a request the game has already accepted.
- Shared PostgreSQL advisory locking serializes game actions across workers, buttons, and feed updates; no automatic move queue is maintained. Cooldowns are committed before sending a move. HTTP writes are never automatically retried because a timeout may mean success. Subsequent attempts require a fresh observation. Returns delete consent immediately, then wait for any action already in flight before acknowledging; no further moves are sent after that acknowledgement.
- Disconnects clear registrations from feed events or the next roster poll. Polling alone cannot detect a disconnect/reconnect that occurs entirely between observations, so keep the event feed connected. Reliable, ordered delivery of match-state events is required; RCON has no authoritative match-state read endpoint on some live builds. Five minutes without an authenticated feed batch stops protection and requires a new pre-match session. Empty authenticated batches count as heartbeats. If the game sends events only when something happens, completely quiet seeding will also hit this safeguard; continuous protection needs a trusted feed relay that can confirm the game's state and supply heartbeats. Do not send synthetic heartbeats without confirming the feed is healthy.
- Registration, return, disconnect, switches, balance skips, failures, threshold and termination events appear in the existing audit log. Admin lists current Discord/Steam registrations, next checks, last poll, state and errors.

## References

- [Warcon WDRCON reference](https://github.com/warcon-app/warcon/blob/main/docs/wardogs-api.md): player faction PATCH, health/uptime, balance config, Season 2 match-state and player events, and limitations of match clocks on live builds.
- [Wardogs hosted API](https://wardogsbot.com/developers): linked accounts and hosted server API. Existing account resolution remains in use; game writes use direct RCON for this feature.

## Staging verification

Use a staging game server to confirm event delivery, actual faction names/config, and whether PATCH resets the installed build's AFK timer. Register two linked test accounts, verify only opted-in connected players move when a balanced destination exists, withdraw one, cross the threshold, then drop below it and confirm protection stays stopped. Test a match start/end, same-map restart, disconnect, RCON outage, and dashboard restart. Unit tests mock game actions and do not send live team changes.
