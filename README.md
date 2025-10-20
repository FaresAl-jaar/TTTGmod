# TTTGmod Discord Bot

This bot automates the "dead player" workflow for Trouble in Terrorist Town sessions. When a player is marked as killed they are muted, and once there are multiple dead players they are moved into a dedicated voice channel until a moderator revives them.

## Features

- Slash commands (`/kill`, `/revive`) and legacy text commands (`!kill`, `!revive`).
- Tracks dead players in memory, keeping their original voice channel so they can be returned when revived.
- Automatically mutes the first dead player and moves all dead players into a configured "dead" voice channel once a second player dies.
- Restores the last remaining dead player to their original channel when only one player remains.

## Requirements

- Python 3.9 or newer.
- A Discord bot token with the following privileged intents enabled:
  - **Server Members Intent** (required to fetch members).
  - **Message Content Intent** (required for the legacy `!kill`/`!revive` commands).
- The bot must have permission to **Move Members** and **Mute Members** in your server.

Install the runtime dependency with:

```bash
pip install -r requirements.txt
```

## Configuration

Set the following environment variables before launching the bot:

| Variable | Description |
| --- | --- |
| `DISCORD_TOKEN` | Bot token from the [Discord Developer Portal](https://discord.com/developers/applications). |
| `DISCORD_DEAD_CHANNEL_ID` | Voice channel ID where dead players should gather once there are multiple dead players. |
| `DISCORD_GUILD_ID` *(optional)* | Restrict slash-command registration to a single guild for faster updates. |
| `DISCORD_COMMAND_PREFIX` *(optional)* | Prefix for legacy text commands (defaults to `!`). |

You can store these variables in a `.env` file and export them before running the bot.

## Running the bot

```bash
python -m src.bot
```

The bot will log into Discord and synchronise slash commands automatically.

## Commands

| Command | Description |
| --- | --- |
| `/kill @member` or `!kill @member` | Marks a player as dead. The first dead player is muted; once a second player is killed, all dead players are moved into the configured dead voice channel. |
| `/revive @member` or `!revive @member` | Revives a player. They are unmuted and moved back to their original voice channel if possible. |

Only members with the **Move Members** permission can use these commands.

## Usage workflow

1. Start a voice session with your players in the main game channel.
2. When a player dies, run `/kill @player` (or the text command). They will be muted in their current channel.
3. When another player dies, use `/kill` again. The bot moves all dead players into the dead channel.
4. Once a player should rejoin the living players, run `/revive @player`. They are unmuted and moved back to where they started.

This keeps living players free from spoilers while allowing the dead to talk among themselves.
