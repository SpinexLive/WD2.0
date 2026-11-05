# REMNANT Clan Management Dashboard

Next.js 15 (App Router) + TypeScript + Tailwind, PostgreSQL, Discord OAuth2. All external API calls are made server-side; no token ever reaches the browser.

## Repository inspection result

The repository contained only `.gitattributes`: **no existing Discord bot, database, dependencies or services were found**, so nothing could be reused or overwritten. Consequences:

- The dashboard does **not** create a second bot. It calls Discord's REST API with `DISCORD_BOT_TOKEN`; set this to the token of your **existing REMNANT bot application**. The bot's running process and commands are untouched.
- The bot needs the **Server Members privileged intent** enabled in the Discord developer portal (required by `GET /guilds/{id}/members`), and "View Channel", "Send Messages" and "Embed Links" in the channels you publish to.
- The existing bot exposes no HTTP API we could verify, so publishing goes through the Discord REST API directly (`src/server/services/discord.ts`, reusable by other callers).

## Features

- Discord login: verifies guild membership and either authorised role (`DISCORD_ALLOWED_ROLE_IDS`); roles are re-checked with the bot every 5 minutes, and revoked users lose their session. Both roles have identical, full access.
- Members: clan members (role `DISCORD_MEMBER_ROLE_ID`), Wardogs League status (matched by Discord ID only), Steam ID (from the Wardogs `/links` API), K/D, summary cards, search/filter/sort/refresh, and a banner linking to the WDL page when League members are not in the clan.
- Access tiers: a user with an authorised role (`DISCORD_ALLOWED_ROLE_IDS`) gets the full dashboard. A user with only `DISCORD_MEMBER_ROLE_ID` can sign in but sees just **My stats** (`/me`): their own all-time stats, rank, K/D trend, maps, factions and match history, found from their Discord ID via the Wardogs links. Every API route is staff-only unless it opts in with `allowMember`.
- WDL: pending tournament applications with accept/reject + confirmation + audit log, and League members who are not in the clan (the League API has no removal endpoint).
- WDL fixtures: the WDL page shows upcoming fixtures, recent results and opponent-filtered history; results fetched by the dashboard are archived. If WDL moves a result back to upcoming, the record is retained but hidden from result history until it is completed again. The next League fixture is also shown on Today for signed-in members. WDL's API may only return a limited recent history, so older results are not assumed complete.
- WDL Raid Helper integration: **Admin → WDL fixtures** contains a real test button and automation status. Automation starts off; the owner must inspect and confirm the scheduled test before it is enabled. The test posts in channel `1546184970706616412` and pings the real Wardogs member role. New fixtures are detected relative to the first baseline, so a previously existing fixture that WDL did not return at baseline may be treated as new. Automatic events use the agreed `ct34` template, briefing offset, 10-day Raid Helper posting schedule, member-role restrictions and match-named temporary role. Possible duplicates, uncertain deliveries and fixture changes are flagged for review; existing events are not deleted without explicit owner confirmation.
- Rosters: Raid Helper events, configurable templates, drag-and-drop editor (dnd-kit), draft saving with optimistic concurrency, reset, warnings, publish/update/republish to Discord.
- Squad K/D comparison: use **Compare** on squad cards to show each selected squad's average all-time player K/D in the roster editor. Only placed players with available K/D are averaged; empty slots and players without stats are excluded. Compare selections are saved with the roster and are not posted to Discord.
- Roster icons: drag Defib, Sniper, MAAWs, AH-6R Rockets or Havoc onto a rostered player who has confirmed the matching loadout unlock. Save the roster, then publish or update it to show the icons beside players on Discord.
- Today (`/today`, the landing page after login): your next rostered event with a countdown and Confirm/Decline (same effect as the Discord buttons), who is in voice, your latest match and 30-day clan rank. On phones a bottom tab bar replaces the drawer for the main pages.
- Live updates: `/api/live` is a server-sent-events stream (in-process bus, single container). Voice joins/leaves and roster changes refresh Briefing, Today and the roster editor immediately; the editor shows a banner if someone else saved. Caddy proxies this path without gzip/buffering.
- Match archive: the background sync checks Wardogs regularly and stores every completed match it discovers, with its player details, in PostgreSQL. Archived matches are not removed when they leave the API's recent list. Discovered matches wait in a persistent queue until their details are saved; failures and restarts are retried automatically. Wardogs lists only its latest 100 matches and has no documented paging, so older matches the dashboard never discovered (including during a prolonged outage) cannot be recovered from that list. Keep database backups to protect the archive.
- Recruit alerts: after a complete match sync, the first successful scan baselines existing candidates without notifying them. Newly qualifying recruits trigger a Discord embed in channel `1560238091543912558`, mentioning roles `1546188874986950758` and `1547229723141345351`. The bot needs permission to post embeds and mention those roles. Authorised staff or holders of either mentioned role can send the personalised in-game invitation while the player is online, or dismiss the candidate from Discord; the Recruit dashboard and embed stay in sync. Invitations are sent at most once, mark the player contacted and are audited. Discord and game deliveries with uncertain outcomes are locked against duplicate sends and reported on Recruit and Admin status.
- Recruit message test: **Admin → Recruit test** lists connected players with real stored match statistics and previews the exact in-game invitation. Confirming sends it to the selected player; no sample values are used. Invitations use shorter wording and, if necessary, an abbreviated name to stay within the game server's 256-character limit. A test sent to a recruit counts as their one invitation and marks them contacted; other test recipients are not added to Recruit. Tests are audited, and uncertain deliveries are locked against retries.
- View as (staff): the View as button in the header previews the dashboard exactly as a chosen clan member sees it (Today, My stats, Leaderboard). It is read-only: the effective session is that member's non-staff session, every mutation is refused with 403, staff pages are closed, and starting it is audited. The choice lives in a 4-hour cookie that is ignored unless the real session is still staff. Exit with the banner button.
- Scouting feedback: staff open a Raid Helper event under **Feedback setup** (teams are parsed from `RMNT v A v B`). Players rostered for it fill in one editable form per opposing team (Overview, Strengths, Weaknesses, Tactics) on **Match Feedback**. Holders of `DISCORD_REVIEWER_ROLE_ID` read them on **Scouting**, grouped per team across all matches, anonymously, with an AI overview generated on demand through any OpenAI-compatible API (`AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`; GitHub Models and Gemini both have free tiers). The overview is cached and flagged when newer notes exist. Staff generate overviews and can post them as an embed to `SCOUTING_CHANNEL_ID`. On Feedback setup, staff can also post a prompt with one button per opposing team into the Raid Helper event's channel; the button opens a Discord form (same four sections), checked against the roster. Closing feedback removes the buttons.
- Loadout unlocks: staff pick a channel on **Loadout unlocks** and post an embed with one red button per item (emoji IDs and images in `src/lib/loadout.ts`). Members press a button, then confirm in an ephemeral prompt (pressing an unlocked item offers Remove), so a mis-click saves nothing. The table shows clan members against item images with ticks, live-updating. Staff can reset all unlocks (confirmation + audit). The dashboard owner can send a confirmed reminder to channel `1566382614519218286`, mentioning only members with the Wardogs member role who have no recorded unlocks; the tracker link is included when configured. The bot needs permission to post in the reminder channel and "Use External Emoji" in the tracker channel.
- Live score in server name: **Admin → Server name** sets a base name and a switch. When on, the game server name becomes `Base | L 98ㆍV 45ㆍM 12` via the game RCON `/v1/config` (only the `ServerName` line is edited), at most every 2 minutes and only when the score changes; the score is shown even at 0-0, and switching it off restores the base name. Changes are audited.
- Chart comparison: on a stats page, overlay the K/D line of the clan average or any clan member (`/api/compare`, built from stored matches only).
- Security: OAuth `state` (cookie + single-use DB row), HMAC-hashed server-side sessions in HTTP-only `SameSite=Lax` cookies (`__Host-` prefix in production), per-session CSRF token + `Origin` check on every mutation, Postgres-backed rate limiting, zod input validation, audit logging, security headers, duplicate-submission guards.

## Setup

```bash
npm install
cp .env.example .env.local    # fill in every value; never commit it
npm run migrate               # applies migrations/*.sql (needs DATABASE_URL in the environment)
npm run dev                   # or: npm run build && npm start
```

`npm run migrate` reads `DATABASE_URL` from the process environment, e.g. `DATABASE_URL=postgres://... npm run migrate` (PowerShell: `$env:DATABASE_URL="..."; npm run migrate`). Requires PostgreSQL 13+.

Discord developer portal:
1. OAuth2 → Redirects: add `${APP_URL}/welcome/discord`.
2. Scopes used: `identify guilds.members.read`.
3. Bot → enable **Server Members Intent**.

Run `npm test` (unit tests) and `npm run typecheck`.

## Deployment

Run `npm run build && npm start` behind HTTPS (a reverse proxy such as nginx/Caddy that sets `X-Forwarded-For`). `APP_URL` must be the public HTTPS origin: it drives the OAuth redirect URI, the CSRF origin check and secure cookies. Run `npm run migrate` on each release. Use a strong `SESSION_SECRET` (`openssl rand -hex 32`); rotating it logs everyone out. Rate limiting and caches: rate limits are in Postgres; provider caches are per process (fine for one instance, each instance just refetches).

## External API limitations (read this)

| Service | Status |
|---|---|
| **Wardogs RCON** (`wardogsbot.com/api/v1`) | Docs and OpenAPI read. Read scope only: `/servers`, `/servers/{id}/live`, `/players/{steamId}`, `/links`. There is an official **Discord↔Steam link** endpoint, `GET /links` (needs the `links` scope on the key), which is the only source of Steam IDs; there is no name matching. Members without a link show no Steam ID. K/D comes from `/players/{steamId}`. No moderate/control/config actions exist in this code. |
| **Wardogs League** (`wardogsleague.net/api/v1/team`) | `/fixtures?limit=1000` returns `upcoming` and `recent`; the response shape was checked against the live API, including nullable competition data. No pagination or fixture-created timestamp is documented in the supplied example, so history may be incomplete and an older fixture first seen after baseline may be treated as new. Members/applications are parsed by Discord ID only; unavailable or unreliable data is shown as Unknown. |
| **Raid Helper** | Verified live reads: `GET /api/v4/servers/{guildId}/events` and `GET /api/v4/events/{id}`. Posted-event pagination uses the documented `Page` header. The API documents event creation, scheduled-event listing and deletion; the scheduled-to-posted link and the approved `ct34` configuration must pass the owner-controlled live test before WDL automation is enabled. The test deliberately mentions the real Wardogs member role. |

No mock data is used anywhere: when a provider fails, the UI shows the error, marks cached data as outdated, and tournament statuses fall back to Unknown.

## Roster model

`rosters` stores only the Raid Helper event ID (never title/sign-ups), template link, squads (`roster_squads`), assignments (`roster_assignments`, unique per roster+player), publication rows (`published_messages`: one per Discord message part), status, `version`, last editor and timestamps. Saves must send the version they loaded; a stale version returns HTTP 409 instead of overwriting. Raid Helper sign-up changes never alter assignments; they surface as warnings (e.g. "no longer signed up").

Publishing never happens on save. Publish/update/republish are separate explicit actions that show the destination, require confirmation and use an in-flight lock. Every assigned player is always @mentioned (only the listed players can be pinged, never @everyone/@here) and each message has **Confirm** / **Decline** buttons. Each player line shows ✅ / ❌ / ⏳ and the footer shows the totals. Clicks are received over the Discord gateway by a small listener that starts with the server (`src/instrumentation.ts`, using the same `DISCORD_BOT_TOKEN`), so no public URL is needed and the existing bot keeps handling its own buttons (this dashboard's buttons use the `wdr:` prefix). The click is stored in `roster_responses` and the message is edited in place; the Rosters page shows the same status per player and polls for new responses. Moving a player to another squad or removing them resets their response. Optionally, `POST /api/discord/interactions` (signature-verified with `DISCORD_PUBLIC_KEY`) can be used instead, but setting an Interactions Endpoint URL disables gateway button handling for the whole Discord application, including the existing bot. Long rosters are split across multiple messages (all IDs stored). Updating edits the stored messages in place; if one was deleted you are offered "Republish".

## Testing

`npm test` covers role checks, bot channel permission resolution, League matching/parsing, Raid Helper parsing, roster move/leader/duplicate rules, validation warnings, save-schema validation and embed splitting/limits. Integration against live Discord, Raid Helper, Wardogs and the deployed PostgreSQL requires real credentials; follow the checklist: sign in with each authorised role, an unauthorised user and a non-member; open Members; accept/reject a test application; create a roster, save, reload, save from two tabs (expect conflict); publish to a test channel, edit and update; delete the message and update (expect republish prompt).

The match archive, recruit message, roster comparison and WDL fixtures tests also have PostgreSQL integration tests. Set `TEST_DATABASE_URL` to a test database and run `npx vitest run tests/matchHistory.test.ts`, `npx vitest run tests/recruitTest.test.ts tests/recruitStats.test.ts`, `npx vitest run tests/rosterComparisonDatabase.test.ts`, or `npx vitest run tests/wdlRaid.test.ts tests/wdlFixturesDatabase.test.ts`; the tests use temporary tables and do not call external services.

## Docker deployment

Runs the app, Postgres and Caddy (automatic HTTPS). Migrations are applied on every start.

1. Point a hostname (DNS A record, or `<ip-with-dashes>.sslip.io`) at the server and open ports 80/443.
2. `cp .env.example .env`, fill in the secrets, and set `DOMAIN` (no scheme) and `POSTGRES_PASSWORD`. `APP_URL` and `DATABASE_URL` are set by compose.
3. `docker compose up -d --build`, then `docker compose logs -f app` (look for "roster gateway connected").
4. In the Discord Developer Portal set the OAuth redirect to `https://<DOMAIN>/welcome/discord` and the Interactions Endpoint URL to `https://<DOMAIN>/api/discord/interactions`.

Update with `git pull; docker compose up -d --build`.

**Backups:** the `backup` service writes a compressed dump to `./backups/` every 24 hours and keeps 14 days. Restore with `docker compose exec -T postgres pg_restore -U remnant -d remnant --clean --if-exists < backups/<file>.dump`. Copy the folder off the server occasionally.

**Monitoring:** the owner-only Admin > Status tab shows the health of the database, Discord, the bot connection, Raid Helper, Wardogs RCON, Wardogs League, match sync and the gold channel. Set `ALERT_CHANNEL_ID` (optional) to get a Discord message when one fails for an hour and when it recovers.

**CI:** `.github/workflows/ci.yml` runs typecheck, tests and a production build on every push.

## Landing page

`/` is a public landing page (sign-in button, upcoming Raid Helper events with countdowns, who is in Discord voice, news, game server status, clan stats). It reads from `/api/public/landing` (read-only, rate limited per IP). Voice presence comes from the Discord gateway listener (`GuildVoiceStates` intent, no privileged intents needed). News is managed on the dashboard's News page. Set `DISCORD_INVITE_URL` to show a "Join our Discord" button.