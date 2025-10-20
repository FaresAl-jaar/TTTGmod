# TTTGmod Voice Safety Suite

This repository contains two components that work together to keep Discord voice chat in sync with Garry's Mod Trouble in Terrorist Town (TTT) rounds.

## Components

### 1. Garry's Mod Event Emitter (`gmod/ttt_event_emitter.lua`)
* Hooks into core TTT events and sends lightweight HTTP POST payloads to a local webhook (`http://127.0.0.1:3000/ttt`).
* Emits the following events with `event`, `steamid64`, `server_id`, and `round_id` fields:
  * `round_prepare`, `round_start`, `round_end`
  * `death`, `spectate`, `spawn`
* Generates deterministic round identifiers and logs failures to the server console.
* Tracks per-player life state to avoid duplicate notifications and only sends `spawn` when a player respawns mid-round.

Copy the file to your server (e.g. `garrysmod/lua/autorun/server/`) and adjust `SERVER_ID`/endpoint if required.

### 2. Discord Bot + Webhook (`bot/index.js`)
* Express endpoint (`POST /ttt`) receives the event payloads and mirrors player status into Discord voice.
* Uses `discord.js@14` to:
  * Server-mute linked members on `death`/`spectate` when they are in voice.
  * Unmute on `spawn`/`revive` and for every round boundary (`round_prepare`, `round_start`, `round_end`).
  * Maintain an optional “dead chat” private thread per round when `ENABLE_DEAD_TEXT=1` and `DEAD_TEXT_PARENT_CHANNEL_ID` are set.
* Persists SteamID64 → Discord user mappings plus dead-thread metadata in `bot/data/state.json`.
* Provides guild text commands (Manage Server permission required):
  * `!link <steamid64> @user`
  * `!unlink <steamid64|@user>`
  * `!reset`
  * `!status`
* Supports optional HMAC protection via the `X-TTT-SIGN` header when `TTT_SHARED_SECRET` is configured.

Install dependencies in the `bot/` directory and start the bot:

```bash
cd bot
npm install
node index.js
```

Create a `.env` (or set environment variables) with at least:

```
DISCORD_TOKEN=...
PORT=3000
SERVER_ID=gmod-1
# Optional hardening
ALLOWED_GUILD_ID=...
TTT_SHARED_SECRET=...
ENABLE_DEAD_TEXT=1
DEAD_TEXT_PARENT_CHANNEL_ID=...
```

## Development Notes
* The bot never moves users between channels or toggles server deafen; it only adjusts the server mute flag.
* When the webhook receives round boundary events, it forcibly unmutes everyone currently in voice to recover from manual overrides or missed updates.
* All Discord actions are idempotent—duplicate events simply no-op when the desired state is already set.
* The Garry's Mod emitter uses fire-and-forget HTTP requests; failures are logged without retry spam.
