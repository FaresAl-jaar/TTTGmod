const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  ChannelType
} = require('discord.js');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const PORT = Number(process.env.PORT || 3000);
const ALLOWED_GUILD_ID = process.env.ALLOWED_GUILD_ID || null;
const SERVER_ID = process.env.SERVER_ID || 'gmod-1';
const DEAD_TEXT_PARENT_CHANNEL_ID = process.env.DEAD_TEXT_PARENT_CHANNEL_ID || null;
const ENABLE_DEAD_TEXT = process.env.ENABLE_DEAD_TEXT === '1';
const SHARED_SECRET = process.env.TTT_SHARED_SECRET || null;

if (!DISCORD_TOKEN) {
  throw new Error('DISCORD_TOKEN is required');
}

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const DATA_FILE = path.join(dataDir, 'state.json');

function loadState() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return { links: {}, deadThread: null };
  }
}

let persistentState = loadState();

function saveState() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(persistentState, null, 2));
}

function setLink(steamId64, discordId) {
  persistentState.links[steamId64] = discordId;
  saveState();
}

function removeLinkBySteam(steamId64) {
  if (persistentState.links[steamId64]) {
    delete persistentState.links[steamId64];
    saveState();
    return true;
  }
  return false;
}

function removeLinkByDiscord(discordId) {
  let removed = false;
  for (const [steamId, linkedDiscordId] of Object.entries(persistentState.links)) {
    if (linkedDiscordId === discordId) {
      delete persistentState.links[steamId];
      removed = true;
    }
  }
  if (removed) {
    saveState();
  }
  return removed;
}

function getDiscordId(steamId64) {
  return persistentState.links[steamId64];
}

function getLinkCount() {
  return Object.keys(persistentState.links).length;
}

function setDeadThread(threadInfo) {
  persistentState.deadThread = threadInfo;
  saveState();
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

let targetGuild = null;
let lastEventTs = null;

client.once('ready', async () => {
  console.log(`[Discord] Logged in as ${client.user.tag}`);
  try {
    if (ALLOWED_GUILD_ID) {
      targetGuild = await client.guilds.fetch(ALLOWED_GUILD_ID);
    } else if (client.guilds.cache.size === 1) {
      targetGuild = client.guilds.cache.first();
    }
  } catch (err) {
    console.error('[Discord] Failed to resolve target guild:', err);
  }

  if (!targetGuild) {
    console.warn('[Discord] Target guild not resolved yet; will resolve per-event');
  } else {
    console.log(`[Discord] Using guild ${targetGuild.name} (${targetGuild.id})`);
  }
});

async function resolveGuild() {
  if (targetGuild) {
    return targetGuild;
  }
  if (ALLOWED_GUILD_ID) {
    try {
      targetGuild = await client.guilds.fetch(ALLOWED_GUILD_ID);
      return targetGuild;
    } catch (err) {
      console.error('[Discord] Unable to fetch guild', err);
      return null;
    }
  }
  const first = client.guilds.cache.first();
  if (first) {
    targetGuild = first;
    return first;
  }
  return null;
}

async function unmuteAll(reason) {
  const guild = await resolveGuild();
  if (!guild) {
    console.warn('[Discord] No guild available for unmuteAll');
    return;
  }
  await guild.members.fetch();
  const voiceStates = guild.voiceStates.cache;
  for (const voiceState of voiceStates.values()) {
    if (voiceState && voiceState.channelId) {
      if (voiceState.serverMute) {
        try {
          await voiceState.setMute(false, reason);
          console.log(`[Voice] Unmuted ${voiceState.id} (${voiceState.member.user.tag})`);
        } catch (err) {
          console.error('[Voice] Failed to unmute member', voiceState.id, err);
        }
      }
    }
  }
}

async function applyMute(steamId64, shouldMute, payload) {
  const discordId = getDiscordId(steamId64);
  if (!discordId) {
    console.log(`[Event] ${payload.event} ignored for unlinked steamid64 ${steamId64}`);
    return;
  }

  const guild = await resolveGuild();
  if (!guild) {
    console.warn('[Discord] No guild resolved; cannot update mute state');
    return;
  }

  let member;
  try {
    member = await guild.members.fetch(discordId);
  } catch (err) {
    console.warn(`[Voice] Unable to fetch member ${discordId}:`, err.message);
    return;
  }

  const voiceState = member.voice;
  if (!voiceState || !voiceState.channelId) {
    console.log(`[Voice] Member ${member.user.tag} not in voice; skipping mute update`);
    return;
  }

  if (voiceState.serverMute === shouldMute) {
    console.log(`[Voice] Member ${member.user.tag} already mute=${shouldMute}; no action`);
    return;
  }

  try {
    await voiceState.setMute(shouldMute, `${payload.event} (${payload.round_id})`);
    console.log(`[Voice] setMute(${shouldMute}) for ${member.user.tag}`);
  } catch (err) {
    console.error('[Voice] Failed to set mute state', err);
  }

  if (ENABLE_DEAD_TEXT && shouldMute) {
    await addUserToDeadThread(discordId);
  } else if (ENABLE_DEAD_TEXT && !shouldMute) {
    await removeUserFromDeadThread(discordId);
  }
}

async function ensureDeadThread(roundId) {
  if (!ENABLE_DEAD_TEXT) {
    return null;
  }
  if (!DEAD_TEXT_PARENT_CHANNEL_ID) {
    console.warn('[DeadText] Parent channel id not configured');
    return null;
  }
  const guild = await resolveGuild();
  if (!guild) {
    return null;
  }

  let threadId = persistentState.deadThread && persistentState.deadThread.id;
  if (threadId) {
    try {
      const existing = await guild.channels.fetch(threadId);
      if (existing) {
        return existing;
      }
    } catch (err) {
      console.warn('[DeadText] Stored thread fetch failed, creating new');
    }
  }

  try {
    const parent = await guild.channels.fetch(DEAD_TEXT_PARENT_CHANNEL_ID);
    if (!parent || parent.type !== ChannelType.GuildText) {
      console.warn('[DeadText] Parent channel is not a text channel');
      return null;
    }

    const threadName = `dead-${roundId}`;
    const thread = await parent.threads.create({
      name: threadName,
      autoArchiveDuration: 60,
      reason: `TTT round ${roundId}`,
      type: ChannelType.PrivateThread,
      invitable: false
    });
    setDeadThread({ id: thread.id, roundId });
    console.log(`[DeadText] Created thread ${threadName}`);
    return thread;
  } catch (err) {
    console.error('[DeadText] Failed to create thread', err);
    return null;
  }
}

async function archiveDeadThread(reason) {
  if (!ENABLE_DEAD_TEXT) {
    return;
  }
  const guild = await resolveGuild();
  if (!guild) {
    return;
  }
  if (!persistentState.deadThread) {
    return;
  }
  try {
    const thread = await guild.channels.fetch(persistentState.deadThread.id);
    if (thread && !thread.archived) {
      await thread.setArchived(true, reason || 'Round ended');
      console.log('[DeadText] Archived dead thread');
    }
  } catch (err) {
    console.warn('[DeadText] Failed to archive dead thread', err);
  }
  setDeadThread(null);
}

async function addUserToDeadThread(discordId) {
  if (!ENABLE_DEAD_TEXT) return;
  const guild = await resolveGuild();
  if (!guild || !persistentState.deadThread) return;
  try {
    const thread = await guild.channels.fetch(persistentState.deadThread.id);
    if (!thread) return;
    await thread.members.add(discordId);
    console.log(`[DeadText] Added ${discordId} to dead thread`);
  } catch (err) {
    console.warn('[DeadText] Failed to add member to thread', err.message);
  }
}

async function removeUserFromDeadThread(discordId) {
  if (!ENABLE_DEAD_TEXT) return;
  const guild = await resolveGuild();
  if (!guild || !persistentState.deadThread) return;
  try {
    const thread = await guild.channels.fetch(persistentState.deadThread.id);
    if (!thread) return;
    await thread.members.remove(discordId);
    console.log(`[DeadText] Removed ${discordId} from dead thread`);
  } catch (err) {
    // Removing from thread is best-effort; ignore errors like unknown member.
  }
}

async function handleRoundEvent(payload) {
  const reason = `${payload.event} (${payload.round_id || 'unknown round'})`;
  await unmuteAll(reason);

  if (!ENABLE_DEAD_TEXT) {
    return;
  }

  if (payload.event === 'round_start') {
    await archiveDeadThread('New round started');
    await ensureDeadThread(payload.round_id || 'round');
  } else {
    await archiveDeadThread(`Round cleanup via ${payload.event}`);
  }
}

async function dispatchTTTEvent(payload) {
  switch (payload.event) {
    case 'round_prepare':
    case 'round_start':
    case 'round_end':
      await handleRoundEvent(payload);
      break;
    case 'death':
    case 'spectate':
      if (payload.steamid64) {
        await applyMute(payload.steamid64, true, payload);
      }
      break;
    case 'revive':
    case 'spawn':
      if (payload.steamid64) {
        await applyMute(payload.steamid64, false, payload);
      }
      break;
    default:
      console.log(`[Event] Ignoring unknown event '${payload.event}'`);
  }
}

function isValidSteamId(steamId) {
  return /^\d{17}$/.test(steamId);
}

function isAdmin(member) {
  if (!member) return false;
  return member.permissions.has(PermissionFlagsBits.ManageGuild);
}

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (ALLOWED_GUILD_ID && message.guild.id !== ALLOWED_GUILD_ID) return;

  const content = message.content.trim();
  if (!content.startsWith('!')) return;

  const args = content.slice(1).split(/\s+/);
  const command = args.shift()?.toLowerCase();
  if (!command) return;

  switch (command) {
    case 'link': {
      if (!isAdmin(message.member)) {
        await message.reply('You do not have permission to use this command.');
        return;
      }
      if (args.length < 2) {
        await message.reply('Usage: !link <steamid64> @user');
        return;
      }
      const steamId = args[0];
      const user = message.mentions.users.first();
      if (!isValidSteamId(steamId)) {
        await message.reply('Invalid SteamID64.');
        return;
      }
      if (!user) {
        await message.reply('You must mention a Discord user.');
        return;
      }
      setLink(steamId, user.id);
      console.log(`[Link] ${steamId} -> ${user.tag}`);
      await message.reply(`Linked SteamID ${steamId} to ${user.tag}.`);
      break;
    }
    case 'unlink': {
      if (!isAdmin(message.member)) {
        await message.reply('You do not have permission to use this command.');
        return;
      }
      if (args.length < 1) {
        await message.reply('Usage: !unlink <steamid64|@user>');
        return;
      }
      const targetUser = message.mentions.users.first();
      let removed = false;
      if (targetUser) {
        removed = removeLinkByDiscord(targetUser.id);
      } else {
        const candidate = args[0];
        if (isValidSteamId(candidate)) {
          removed = removeLinkBySteam(candidate);
        } else {
          removed = removeLinkByDiscord(candidate);
        }
      }
      await message.reply(removed ? 'Link removed.' : 'No link found.');
      break;
    }
    case 'reset': {
      if (!isAdmin(message.member)) {
        await message.reply('You do not have permission to use this command.');
        return;
      }
      await unmuteAll('Manual reset command');
      await message.reply('Unmuted everyone currently in voice channels.');
      break;
    }
    case 'status': {
      const deadThread = persistentState.deadThread
        ? `${persistentState.deadThread.id} (round ${persistentState.deadThread.roundId})`
        : 'none';
      const status = [
        `Server ID: ${SERVER_ID}`,
        `Linked users: ${getLinkCount()}`,
        `Last event: ${lastEventTs || 'never'}`,
        `Dead thread: ${deadThread}`
      ].join('\n');
      await message.reply('```\n' + status + '\n```');
      break;
    }
    default:
      break;
  }
});

const app = express();
app.use(bodyParser.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

function verifySignature(req) {
  if (!SHARED_SECRET) {
    return true;
  }
  const provided = req.get('X-TTT-SIGN');
  if (!provided) {
    return false;
  }
  try {
    const expected = crypto.createHmac('sha256', SHARED_SECRET).update(req.rawBody || Buffer.alloc(0)).digest('hex');
    const providedBuf = Buffer.from(provided, 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    if (providedBuf.length !== expectedBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(providedBuf, expectedBuf);
  } catch (err) {
    console.warn('[Security] Failed to verify signature', err.message);
    return false;
  }
}

app.post('/ttt', async (req, res) => {
  if (!verifySignature(req)) {
    res.status(401).send('invalid signature');
    return;
  }

  const payload = req.body || {};
  if (!payload.event || typeof payload.event !== 'string') {
    res.status(400).send('invalid payload');
    return;
  }

  payload.steamid64 = payload.steamid64 || '';
  payload.server_id = payload.server_id || '';
  payload.round_id = payload.round_id || '';

  const discordId = payload.steamid64 ? getDiscordId(payload.steamid64) : null;
  console.log(`[Webhook] event=${payload.event} server=${payload.server_id} round=${payload.round_id} steam=${payload.steamid64 || 'n/a'} discord=${discordId || 'unlinked'}`);

  lastEventTs = new Date().toISOString();

  try {
    await dispatchTTTEvent(payload);
    res.sendStatus(200);
  } catch (err) {
    console.error('[Webhook] Failed to process event', err);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log(`[HTTP] Listening on port ${PORT}`);
});

client.login(DISCORD_TOKEN).catch((err) => {
  console.error('[Discord] Login failed', err);
  process.exit(1);
});
