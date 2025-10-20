# TTT Discord Bot

A Discord bot for Trouble in Terrorist Town (TTT) game mode that manages dead players intelligently:
- **First death**: Player gets muted in their current channel
- **Multiple deaths**: Players are moved to a dedicated dead channel where they can talk to each other

## Features

- 🎮 Automatic game state management
- 🔇 Mutes the first dead player
- 📢 Moves multiple dead players to a separate channel
- 🔄 Revive system to bring players back
- 📊 Real-time game status tracking

## Setup

### Prerequisites

- Node.js 16.x or higher
- A Discord bot token
- Administrator permissions in your Discord server

### Installation

1. Clone this repository:
```bash
git clone https://github.com/FaresAl-jaar/TTTGmod.git
cd TTTGmod
```

2. Install dependencies:
```bash
npm install
```

3. Create your configuration file:
```bash
cp config.example.json config.json
```

4. Edit `config.json` with your bot credentials:
```json
{
  "token": "YOUR_BOT_TOKEN_HERE",
  "guildId": "YOUR_GUILD_ID_HERE",
  "aliveChannelId": "YOUR_ALIVE_VOICE_CHANNEL_ID",
  "deadChannelId": "YOUR_DEAD_VOICE_CHANNEL_ID"
}
```

### Getting Your Configuration Values

#### Bot Token
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application or select an existing one
3. Go to the "Bot" section
4. Click "Reset Token" and copy the token
5. Enable these Privileged Gateway Intents:
   - Server Members Intent
   - Message Content Intent

#### Guild ID
1. Enable Developer Mode in Discord (Settings → Advanced → Developer Mode)
2. Right-click your server and select "Copy ID"

#### Channel IDs
1. Right-click the voice channel and select "Copy ID"
2. You need two voice channels:
   - **Alive Channel**: Where living players stay
   - **Dead Channel**: Where dead players are moved

### Bot Permissions

When inviting the bot to your server, ensure it has these permissions:
- View Channels
- Send Messages
- Move Members
- Mute Members
- Connect
- Speak

Invite URL format:
```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=16785408&scope=bot
```

## Usage

### Starting the Bot

```bash
npm start
```

### Commands

All commands use the `!` prefix:

- `!startgame` - Start a new game (automatically adds all players currently in the alive voice channel)
- `!endgame` - End the current game and reset all players
- `!kill @player` - Kill a player
  - If it's the first death: Player gets muted
  - If there are multiple deaths: Player gets moved to dead channel
- `!revive @player` - Revive a dead player and move them back to alive channel
- `!status` - Show current game status (alive and dead players)
- `!help` - Show help message with all commands

### Game Flow Example

1. Players join the "Alive" voice channel
2. Admin uses `!startgame` to begin
3. When first player dies: `!kill @player1` → Player1 gets muted in alive channel
4. When second player dies: `!kill @player2` → Both Player1 and Player2 are moved to dead channel
5. Any additional deaths: `!kill @player3` → Player3 joins dead channel
6. To bring someone back: `!revive @player1` → Player1 returns to alive channel
7. When game ends: `!endgame` → All players reset

## How It Works

The bot tracks game state and manages players based on the number of deaths:

### Single Dead Player
- Player is muted in their current channel
- Can still hear alive players
- Cannot communicate

### Multiple Dead Players  
- All dead players are moved to a separate "dead" channel
- Can talk to each other freely
- Cannot hear or talk to alive players

This creates an authentic TTT experience where:
- The first dead player can't give away information
- Dead players can discuss the game together once there are multiple deaths
- Alive players maintain tactical communication

## Development

### Project Structure

```
TTTGmod/
├── bot.js                 # Main bot logic
├── config.json            # Configuration (not tracked in git)
├── config.example.json    # Configuration template
├── package.json           # Dependencies
└── README.md             # This file
```

### Technologies Used

- [discord.js](https://discord.js.org/) v14 - Discord API library
- Node.js - Runtime environment

## Troubleshooting

### Bot doesn't respond to commands
- Ensure Message Content Intent is enabled in Discord Developer Portal
- Check that the bot has permission to read messages in your text channel

### Bot can't move/mute players
- Verify the bot has "Move Members" and "Mute Members" permissions
- Ensure the bot's role is higher than the players' roles in the server hierarchy

### Configuration errors
- Double-check all IDs in config.json are correct
- Make sure channel IDs correspond to voice channels, not text channels

## License

MIT
