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
- WDL: pending tournament applications with accept/reject + confirmation + audit log, and League members who are not in the clan (the League API has no removal endpoint).
- Rosters: Raid Helper events, configurable templates, drag-and-drop editor (dnd-kit), draft saving with optimistic concurrency, reset, warnings, publish/update/republish to Discord.
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
| **Wardogs League** (`wardogsleague.net/api/v1/team`) | Endpoints exist (confirmed `401` without a key) but no public documentation of response fields was available. Parsing accepts an array or `{members\|applications\|data\|results\|items: [...]}` where each item carries a **string** Discord ID (`discordId`, `discord_id` or `discord.id`). If no usable Discord ID is found, everyone shows **Unknown** instead of guessing. Pending applications = items from `GET /applications` whose `status` (if present) is `pending`. **Verify against a real response before relying on it.** |
| **Raid Helper** | Verified live against the real API: `GET /api/v4/servers/{guildId}/events` (returns `postedEvents[]`, with `id`, `title`, `startTime`, `signUpCount`, `channelId`) and `GET /api/v4/events/{id}` (returns `signUps[]` with `userId`, `name`, `className`, `status`). These are the defaults; paths can be overridden via `RAID_HELPER_EVENTS_PATH` / `RAID_HELPER_EVENT_PATH`. The Discord event link is derived from guild/channel/event (event ID = message ID). |

No mock data is used anywhere: when a provider fails, the UI shows the error, marks cached data as outdated, and tournament statuses fall back to Unknown.

## Roster model

`rosters` stores only the Raid Helper event ID (never title/sign-ups), template link, squads (`roster_squads`), assignments (`roster_assignments`, unique per roster+player), publication rows (`published_messages`: one per Discord message part), status, `version`, last editor and timestamps. Saves must send the version they loaded; a stale version returns HTTP 409 instead of overwriting. Raid Helper sign-up changes never alter assignments; they surface as warnings (e.g. "no longer signed up").

Publishing never happens on save. Publish/update/republish are separate explicit actions that show the destination, require confirmation and use an in-flight lock. Every assigned player is always @mentioned (only the listed players can be pinged, never @everyone/@here) and each message has **Confirm** / **Decline** buttons. Each player line shows ✅ / ❌ / ⏳ and the footer shows the totals. Clicks are received over the Discord gateway by a small listener that starts with the server (`src/instrumentation.ts`, using the same `DISCORD_BOT_TOKEN`), so no public URL is needed and the existing bot keeps handling its own buttons (this dashboard's buttons use the `wdr:` prefix). The click is stored in `roster_responses` and the message is edited in place; the Rosters page shows the same status per player and polls for new responses. Moving a player to another squad or removing them resets their response. Optionally, `POST /api/discord/interactions` (signature-verified with `DISCORD_PUBLIC_KEY`) can be used instead, but setting an Interactions Endpoint URL disables gateway button handling for the whole Discord application, including the existing bot. Long rosters are split across multiple messages (all IDs stored). Updating edits the stored messages in place; if one was deleted you are offered "Republish".

## Testing

`npm test` covers role checks, bot channel permission resolution, League matching/parsing, Raid Helper parsing, roster move/leader/duplicate rules, validation warnings, save-schema validation and embed splitting/limits. Integration against live Discord, Raid Helper, Wardogs and PostgreSQL requires real credentials and was not run in this repository; follow the checklist: sign in with each authorised role, an unauthorised user and a non-member; open Members; accept/reject a test application; create a roster, save, reload, save from two tabs (expect conflict); publish to a test channel, edit and update; delete the message and update (expect republish prompt).

## Docker deployment

Runs the app, Postgres and Caddy (automatic HTTPS). Migrations are applied on every start.

1. Point a hostname (DNS A record, or `<ip-with-dashes>.sslip.io`) at the server and open ports 80/443.
2. `cp .env.example .env`, fill in the secrets, and set `DOMAIN` (no scheme) and `POSTGRES_PASSWORD`. `APP_URL` and `DATABASE_URL` are set by compose.
3. `docker compose up -d --build`, then `docker compose logs -f app` (look for "roster gateway connected").
4. In the Discord Developer Portal set the OAuth redirect to `https://<DOMAIN>/welcome/discord` and the Interactions Endpoint URL to `https://<DOMAIN>/api/discord/interactions`.

Update with `git pull; docker compose up -d --build`. Back up with `docker compose exec -T postgres pg_dump -U remnant remnant > backup.sql`.
## Landing page

`/` is a public landing page (sign-in button, upcoming Raid Helper events with countdowns, who is in Discord voice, news, game server status, clan stats). It reads from `/api/public/landing` (read-only, rate limited per IP). Voice presence comes from the Discord gateway listener (`GuildVoiceStates` intent, no privileged intents needed). News is managed on the dashboard's News page. Set `DISCORD_INVITE_URL` to show a "Join our Discord" button.