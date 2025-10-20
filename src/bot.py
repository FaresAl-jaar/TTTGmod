"""Discord bot for managing dead player voice workflow."""
from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from typing import Dict, Optional

import discord
from discord import app_commands
from discord.ext import commands


log = logging.getLogger(__name__)


@dataclass
class BotConfig:
    """Runtime configuration for the bot."""

    token: str
    dead_channel_id: int
    guild_id: Optional[int] = None
    command_prefix: str = "!"

    @classmethod
    def from_env(cls) -> "BotConfig":
        """Load configuration values from environment variables."""

        token = os.getenv("DISCORD_TOKEN")
        dead_channel = os.getenv("DISCORD_DEAD_CHANNEL_ID")
        guild_id = os.getenv("DISCORD_GUILD_ID")
        command_prefix = os.getenv("DISCORD_COMMAND_PREFIX", "!")

        if not token:
            raise RuntimeError("DISCORD_TOKEN must be set in the environment.")
        if not dead_channel:
            raise RuntimeError(
                "DISCORD_DEAD_CHANNEL_ID must be set in the environment."
            )

        try:
            dead_channel_id = int(dead_channel)
        except ValueError as exc:  # pragma: no cover - sanity check
            raise RuntimeError("DISCORD_DEAD_CHANNEL_ID must be an integer.") from exc

        parsed_guild: Optional[int] = None
        if guild_id:
            try:
                parsed_guild = int(guild_id)
            except ValueError as exc:  # pragma: no cover - sanity check
                raise RuntimeError("DISCORD_GUILD_ID must be an integer.") from exc

        return cls(
            token=token,
            dead_channel_id=dead_channel_id,
            guild_id=parsed_guild,
            command_prefix=command_prefix,
        )


class DeadPlayerTracker:
    """Tracks dead players and their original voice channels."""

    def __init__(self) -> None:
        self._dead_members: Dict[int, Optional[int]] = {}

    def add(self, member_id: int, channel_id: Optional[int]) -> None:
        self._dead_members[member_id] = channel_id

    def remove(self, member_id: int) -> Optional[int]:
        return self._dead_members.pop(member_id, None)

    def is_dead(self, member_id: int) -> bool:
        return member_id in self._dead_members

    def original_channel(self, member_id: int) -> Optional[int]:
        return self._dead_members.get(member_id)

    def dead_members(self) -> Dict[int, Optional[int]]:
        return dict(self._dead_members)

    def __len__(self) -> int:
        return len(self._dead_members)


async def _mute_member(member: discord.Member) -> None:
    if member.voice is not None:
        await member.edit(mute=True)


async def _unmute_member(member: discord.Member) -> None:
    if member.voice is not None:
        await member.edit(mute=False)


async def handle_kill(
    guild: discord.Guild,
    member: discord.Member,
    tracker: DeadPlayerTracker,
    config: BotConfig,
) -> str:
    if tracker.is_dead(member.id):
        return f"{member.display_name} is already marked as dead."

    if not member.voice or not member.voice.channel:
        return f"{member.display_name} is not in a voice channel."

    dead_channel = guild.get_channel(config.dead_channel_id)
    if not isinstance(dead_channel, discord.VoiceChannel):
        return "The configured dead channel is not a voice channel that this bot can access."

    tracker.add(member.id, member.voice.channel.id if member.voice else None)

    await _mute_member(member)

    if len(tracker) >= 2:
        # Move every dead member into the dead channel.
        moved = []
        for dead_id, _ in tracker.dead_members().items():
            dead_member = guild.get_member(dead_id)
            if not dead_member or not dead_member.voice:
                continue

            try:
                await dead_member.move_to(dead_channel)
                moved.append(dead_member.display_name)
            except discord.HTTPException as exc:
                log.warning("Failed to move %s: %s", dead_member, exc)
        if moved:
            return (
                f"Moved {', '.join(moved)} to {dead_channel.name}."
            )
        return (
            f"Marked {member.display_name} as dead but was unable to move players to "
            f"{dead_channel.name}."
        )

    return f"Muted {member.display_name} until another player dies."


async def handle_revive(
    guild: discord.Guild,
    member: discord.Member,
    tracker: DeadPlayerTracker,
    config: BotConfig,
) -> str:
    if not tracker.is_dead(member.id):
        return f"{member.display_name} is not marked as dead."

    original_channel_id = tracker.remove(member.id)

    await _unmute_member(member)

    dead_channel = guild.get_channel(config.dead_channel_id)
    if member.voice and member.voice.channel == dead_channel and original_channel_id:
        channel = guild.get_channel(original_channel_id)
        if isinstance(channel, discord.VoiceChannel):
            try:
                await member.move_to(channel)
            except discord.HTTPException as exc:
                log.warning("Failed to move %s back to %s: %s", member, channel, exc)

    # If there is only one dead player left, move them back to their original channel.
    if len(tracker) == 1:
        remaining_id, remaining_channel_id = next(iter(tracker.dead_members().items()))
        remaining_member = guild.get_member(remaining_id)
        if (
            remaining_member
            and remaining_member.voice
            and remaining_member.voice.channel == dead_channel
            and remaining_channel_id
        ):
            channel = guild.get_channel(remaining_channel_id)
            if isinstance(channel, discord.VoiceChannel):
                try:
                    await remaining_member.move_to(channel)
                except discord.HTTPException as exc:
                    log.warning(
                        "Failed to move %s back to %s: %s", remaining_member, channel, exc
                    )

    return f"Revived {member.display_name}."


def create_bot(config: BotConfig) -> commands.Bot:
    intents = discord.Intents.default()
    intents.members = True
    intents.message_content = True
    intents.voice_states = True

    bot = commands.Bot(command_prefix=config.command_prefix, intents=intents)
    tracker = DeadPlayerTracker()

    async def kill_action(target: discord.Member) -> str:
        if not bot.guilds:
            raise RuntimeError("Bot is not connected to any guilds.")
        guild = target.guild
        return await handle_kill(guild, target, tracker, config)

    async def revive_action(target: discord.Member) -> str:
        if not bot.guilds:
            raise RuntimeError("Bot is not connected to any guilds.")
        guild = target.guild
        return await handle_revive(guild, target, tracker, config)

    @bot.event
    async def on_ready() -> None:  # pragma: no cover - requires live connection
        if not getattr(bot, "_synced", False):
            if config.guild_id:
                guild_obj = discord.Object(id=config.guild_id)
                await bot.tree.sync(guild=guild_obj)
            else:
                await bot.tree.sync()
            bot._synced = True
        log.info("Logged in as %s", bot.user)

    @bot.command(name="kill")
    @commands.has_permissions(move_members=True)
    async def kill_command(ctx: commands.Context, target: discord.Member) -> None:
        message = await kill_action(target)
        await ctx.send(message)

    @bot.command(name="revive")
    @commands.has_permissions(move_members=True)
    async def revive_command(ctx: commands.Context, target: discord.Member) -> None:
        message = await revive_action(target)
        await ctx.send(message)

    @kill_command.error
    async def kill_error(ctx: commands.Context, error: commands.CommandError) -> None:
        if isinstance(error, commands.MissingPermissions):
            await ctx.send("You do not have permission to kill players.")
        else:
            await ctx.send(f"Kill command failed: {error}")

    @revive_command.error
    async def revive_error(ctx: commands.Context, error: commands.CommandError) -> None:
        if isinstance(error, commands.MissingPermissions):
            await ctx.send("You do not have permission to revive players.")
        else:
            await ctx.send(f"Revive command failed: {error}")

    @bot.tree.command(name="kill", description="Mark a player as dead.")
    @app_commands.default_permissions(move_members=True)
    async def kill_slash(interaction: discord.Interaction, member: discord.Member) -> None:
        message = await kill_action(member)
        await interaction.response.send_message(message, ephemeral=True)

    @bot.tree.command(name="revive", description="Revive a previously killed player.")
    @app_commands.default_permissions(move_members=True)
    async def revive_slash(interaction: discord.Interaction, member: discord.Member) -> None:
        message = await revive_action(member)
        await interaction.response.send_message(message, ephemeral=True)

    return bot


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    config = BotConfig.from_env()
    bot = create_bot(config)
    asyncio.run(bot.start(config.token))


if __name__ == "__main__":  # pragma: no cover - script entry point
    main()
