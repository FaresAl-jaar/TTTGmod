const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const fs = require('fs');

// Load configuration
let config;
try {
  config = require('./config.json');
} catch (error) {
  console.error('Error: config.json not found. Please copy config.example.json to config.json and fill in your details.');
  process.exit(1);
}

// Create Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers
  ]
});

// Game state
const gameState = {
  isActive: false,
  alivePlayers: new Set(),
  deadPlayers: new Set(),
  mutedPlayers: new Set()
};

// Bot ready event
client.once('ready', () => {
  console.log(`✅ Bot is online as ${client.user.tag}`);
  console.log(`📊 Serving ${client.guilds.cache.size} guild(s)`);
});

// Message command handler
client.on('messageCreate', async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;

  const prefix = '!';
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  try {
    switch (command) {
      case 'startgame':
        await handleStartGame(message);
        break;
      case 'endgame':
        await handleEndGame(message);
        break;
      case 'kill':
        await handleKillPlayer(message, args);
        break;
      case 'revive':
        await handleRevivePlayer(message, args);
        break;
      case 'status':
        await handleStatus(message);
        break;
      case 'help':
        await handleHelp(message);
        break;
    }
  } catch (error) {
    console.error(`Error handling command ${command}:`, error);
    message.reply(`❌ An error occurred: ${error.message}`);
  }
});

/**
 * Start a new game
 */
async function handleStartGame(message) {
  if (gameState.isActive) {
    return message.reply('❌ A game is already in progress!');
  }

  gameState.isActive = true;
  gameState.alivePlayers.clear();
  gameState.deadPlayers.clear();
  gameState.mutedPlayers.clear();

  // Get all members in the alive voice channel
  const guild = message.guild;
  const aliveChannel = guild.channels.cache.get(config.aliveChannelId);

  if (!aliveChannel) {
    gameState.isActive = false;
    return message.reply('❌ Alive voice channel not found! Check your config.json');
  }

  const members = aliveChannel.members;
  members.forEach(member => {
    gameState.alivePlayers.add(member.id);
  });

  message.reply(`✅ Game started with ${gameState.alivePlayers.size} players!`);
}

/**
 * End the current game
 */
async function handleEndGame(message) {
  if (!gameState.isActive) {
    return message.reply('❌ No game is currently active!');
  }

  const guild = message.guild;
  const aliveChannel = guild.channels.cache.get(config.aliveChannelId);
  const deadChannel = guild.channels.cache.get(config.deadChannelId);

  // Unmute all muted players
  for (const playerId of gameState.mutedPlayers) {
    try {
      const member = await guild.members.fetch(playerId);
      if (member.voice.channel) {
        await member.voice.setMute(false);
      }
    } catch (error) {
      console.error(`Failed to unmute player ${playerId}:`, error);
    }
  }

  // Move all dead players back to alive channel
  if (deadChannel) {
    for (const playerId of gameState.deadPlayers) {
      try {
        const member = await guild.members.fetch(playerId);
        if (member.voice.channel && member.voice.channel.id === deadChannel.id) {
          await member.voice.setChannel(aliveChannel);
        }
      } catch (error) {
        console.error(`Failed to move player ${playerId}:`, error);
      }
    }
  }

  gameState.isActive = false;
  gameState.alivePlayers.clear();
  gameState.deadPlayers.clear();
  gameState.mutedPlayers.clear();

  message.reply('✅ Game ended! All players have been reset.');
}

/**
 * Kill a player
 */
async function handleKillPlayer(message, args) {
  if (!gameState.isActive) {
    return message.reply('❌ No game is currently active! Use !startgame first.');
  }

  if (args.length === 0) {
    return message.reply('❌ Please mention a player to kill. Usage: !kill @player');
  }

  const targetUser = message.mentions.users.first();
  if (!targetUser) {
    return message.reply('❌ Please mention a valid player!');
  }

  const guild = message.guild;
  const member = await guild.members.fetch(targetUser.id);

  if (!gameState.alivePlayers.has(member.id)) {
    return message.reply('❌ This player is not alive or not in the game!');
  }

  // Mark player as dead
  gameState.alivePlayers.delete(member.id);
  gameState.deadPlayers.add(member.id);

  // Check if player is in voice channel
  if (!member.voice.channel) {
    return message.reply(`💀 ${member.displayName} has been killed, but they are not in a voice channel.`);
  }

  const aliveChannel = guild.channels.cache.get(config.aliveChannelId);
  const deadChannel = guild.channels.cache.get(config.deadChannelId);

  // Determine action based on number of dead players
  if (gameState.deadPlayers.size === 1) {
    // First dead player - just mute them
    await member.voice.setMute(true);
    gameState.mutedPlayers.add(member.id);
    message.reply(`💀 ${member.displayName} has been killed and muted (first death).`);
  } else {
    // Multiple dead players - move to dead channel
    if (!deadChannel) {
      return message.reply('❌ Dead voice channel not found! Check your config.json');
    }

    // Move the newly killed player
    await member.voice.setChannel(deadChannel);

    // Check if there was a previously muted player (the first dead player)
    // and move them to the dead channel too
    if (gameState.mutedPlayers.size > 0) {
      for (const mutedPlayerId of gameState.mutedPlayers) {
        try {
          const mutedMember = await guild.members.fetch(mutedPlayerId);
          if (mutedMember.voice.channel) {
            // Unmute before moving
            await mutedMember.voice.setMute(false);
            await mutedMember.voice.setChannel(deadChannel);
          }
        } catch (error) {
          console.error(`Failed to move previously muted player ${mutedPlayerId}:`, error);
        }
      }
      gameState.mutedPlayers.clear();
    }

    message.reply(`💀 ${member.displayName} has been killed and moved to the dead channel.`);
  }
}

/**
 * Revive a player
 */
async function handleRevivePlayer(message, args) {
  if (!gameState.isActive) {
    return message.reply('❌ No game is currently active!');
  }

  if (args.length === 0) {
    return message.reply('❌ Please mention a player to revive. Usage: !revive @player');
  }

  const targetUser = message.mentions.users.first();
  if (!targetUser) {
    return message.reply('❌ Please mention a valid player!');
  }

  const guild = message.guild;
  const member = await guild.members.fetch(targetUser.id);

  if (!gameState.deadPlayers.has(member.id)) {
    return message.reply('❌ This player is not dead!');
  }

  // Mark player as alive
  gameState.deadPlayers.delete(member.id);
  gameState.alivePlayers.add(member.id);

  // Unmute if they were muted
  if (gameState.mutedPlayers.has(member.id)) {
    if (member.voice.channel) {
      await member.voice.setMute(false);
    }
    gameState.mutedPlayers.delete(member.id);
  }

  // Move back to alive channel if they're in dead channel
  if (member.voice.channel) {
    const aliveChannel = guild.channels.cache.get(config.aliveChannelId);
    const deadChannel = guild.channels.cache.get(config.deadChannelId);

    if (member.voice.channel.id === deadChannel?.id) {
      await member.voice.setChannel(aliveChannel);
    }
  }

  // Check if we need to adjust the last remaining dead player
  if (gameState.deadPlayers.size === 1) {
    const lastDeadPlayerId = Array.from(gameState.deadPlayers)[0];
    const lastDeadMember = await guild.members.fetch(lastDeadPlayerId);
    const deadChannel = guild.channels.cache.get(config.deadChannelId);
    const aliveChannel = guild.channels.cache.get(config.aliveChannelId);

    // If the last dead player is in the dead channel, move them back and mute
    if (lastDeadMember.voice.channel && lastDeadMember.voice.channel.id === deadChannel?.id) {
      await lastDeadMember.voice.setChannel(aliveChannel);
      await lastDeadMember.voice.setMute(true);
      gameState.mutedPlayers.add(lastDeadPlayerId);
    }
  }

  message.reply(`✅ ${member.displayName} has been revived!`);
}

/**
 * Show game status
 */
async function handleStatus(message) {
  if (!gameState.isActive) {
    return message.reply('❌ No game is currently active!');
  }

  const guild = message.guild;
  const aliveNames = [];
  const deadNames = [];

  for (const playerId of gameState.alivePlayers) {
    try {
      const member = await guild.members.fetch(playerId);
      aliveNames.push(member.displayName);
    } catch (error) {
      aliveNames.push(`Unknown (${playerId})`);
    }
  }

  for (const playerId of gameState.deadPlayers) {
    try {
      const member = await guild.members.fetch(playerId);
      const isMuted = gameState.mutedPlayers.has(playerId) ? ' (muted)' : '';
      deadNames.push(member.displayName + isMuted);
    } catch (error) {
      deadNames.push(`Unknown (${playerId})`);
    }
  }

  const statusMessage = `
📊 **Game Status**
👥 Alive Players (${gameState.alivePlayers.size}): ${aliveNames.join(', ') || 'None'}
💀 Dead Players (${gameState.deadPlayers.size}): ${deadNames.join(', ') || 'None'}
  `;

  message.reply(statusMessage);
}

/**
 * Show help message
 */
async function handleHelp(message) {
  const helpMessage = `
📚 **TTT Discord Bot Commands**

\`!startgame\` - Start a new game (adds all players in alive channel)
\`!endgame\` - End the current game and reset all players
\`!kill @player\` - Kill a player (mutes if first death, moves to dead channel if multiple deaths)
\`!revive @player\` - Revive a dead player
\`!status\` - Show current game status
\`!help\` - Show this help message

**How it works:**
- When the first player dies, they get muted in their current channel
- When a second player dies, both dead players are moved to the dead channel
- All subsequent deaths result in players being moved to the dead channel
  `;

  message.reply(helpMessage);
}

// Login to Discord
client.login(config.token).catch(error => {
  console.error('Failed to login:', error);
  process.exit(1);
});
