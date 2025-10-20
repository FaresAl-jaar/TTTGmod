# TTT Bot Setup Guide

This guide will walk you through setting up the TTT Discord bot step by step.

## Step 1: Create a Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and give it a name (e.g., "TTT Bot")
3. Go to the "Bot" section in the left sidebar
4. Click "Add Bot" and confirm
5. Under "Privileged Gateway Intents", enable:
   - ✅ Server Members Intent
   - ✅ Message Content Intent
6. Click "Reset Token" and copy the token (you'll need this for config.json)

## Step 2: Set Up Your Discord Server

You need two voice channels:
1. **Alive Channel**: Where living players communicate during the game
2. **Dead Channel**: Where dead players are moved once there are multiple deaths

### Creating Voice Channels

1. Right-click on your server name
2. Select "Create Channel"
3. Choose "Voice Channel"
4. Name it "Alive Players" (or whatever you prefer)
5. Repeat for the "Dead Players" channel

### Getting Channel IDs

1. Enable Developer Mode: Settings → Advanced → Developer Mode ✅
2. Right-click each voice channel and select "Copy ID"
3. Save these IDs for config.json

### Getting Guild (Server) ID

1. Right-click your server name
2. Select "Copy ID"
3. Save this ID for config.json

## Step 3: Invite the Bot to Your Server

1. In the Discord Developer Portal, go to "OAuth2" → "URL Generator"
2. Select these scopes:
   - ✅ bot
3. Select these bot permissions:
   - ✅ View Channels
   - ✅ Send Messages
   - ✅ Move Members
   - ✅ Mute Members
   - ✅ Connect
   - ✅ Speak
4. Copy the generated URL and open it in your browser
5. Select your server and authorize the bot

## Step 4: Configure the Bot

1. Navigate to the bot directory:
```bash
cd TTTGmod
```

2. Copy the example configuration:
```bash
cp config.example.json config.json
```

3. Edit config.json with your favorite text editor:
```json
{
  "token": "YOUR_BOT_TOKEN_FROM_STEP_1",
  "guildId": "YOUR_SERVER_ID_FROM_STEP_2",
  "aliveChannelId": "YOUR_ALIVE_CHANNEL_ID_FROM_STEP_2",
  "deadChannelId": "YOUR_DEAD_CHANNEL_ID_FROM_STEP_2"
}
```

## Step 5: Install Dependencies

```bash
npm install
```

## Step 6: Start the Bot

```bash
npm start
```

You should see:
```
✅ Bot is online as YourBotName#1234
📊 Serving 1 guild(s)
```

## Step 7: Test the Bot

1. Join the "Alive Players" voice channel with some friends
2. In any text channel, type: `!startgame`
3. The bot will register all players in the alive voice channel
4. Test killing a player: `!kill @username`
   - First death: Player gets muted
   - Second death: Both players move to dead channel
5. Check status: `!status`
6. End the game: `!endgame`

## Common Issues

### Bot doesn't respond to commands
- Check that Message Content Intent is enabled
- Make sure the bot has "Send Messages" permission in the text channel

### Bot can't move/mute players
- Verify the bot has "Move Members" and "Mute Members" permissions
- Ensure the bot's role is higher than the players' roles in Server Settings → Roles

### "config.json not found" error
- Make sure you copied config.example.json to config.json
- The file must be in the same directory as bot.js

### Invalid token error
- Double-check your bot token in config.json
- Make sure there are no extra spaces or quotes
- You may need to reset the token in Discord Developer Portal

## Bot Commands Quick Reference

| Command | Description |
|---------|-------------|
| `!startgame` | Start a new game with players in alive channel |
| `!endgame` | End the game and reset all players |
| `!kill @player` | Kill a player (mute if first, move if multiple) |
| `!revive @player` | Revive a dead player |
| `!status` | Show current game status |
| `!help` | Show help message |

## Security Notes

⚠️ **Never share your bot token!**
- Keep config.json private (it's in .gitignore)
- If your token is leaked, reset it immediately in Discord Developer Portal
- Never commit config.json to version control

## Need Help?

If you encounter issues not covered here, check:
- Discord.js documentation: https://discord.js.org/
- Discord Developer Portal: https://discord.com/developers/docs/intro
