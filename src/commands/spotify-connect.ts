import {ChatInputCommandInteraction} from 'discord.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import Command from './index.js';
import {getSpotifyConnectOptions, isSpotifyConnectEnabled} from '../services/spotify-connect.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('spotify-connect')
    .setDescription('use Spotify as the deck — Muse becomes a Spotify Connect speaker')
    .addSubcommand(subcommand => subcommand
      .setName('start')
      .setDescription('hand playback over to Spotify'))
    .addSubcommand(subcommand => subcommand
      .setName('stop')
      .setDescription('return control to the queue'));

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction) {
    const player = this.playerManager.get(interaction.guild!.id);

    if (interaction.options.getSubcommand() === 'stop') {
      if (!player.isSpotifyConnectActive) {
        throw new Error('Spotify Connect isn\'t running');
      }

      player.stopSpotifyConnect();
      await interaction.reply('control handed back to the queue');
      return;
    }

    if (!isSpotifyConnectEnabled()) {
      throw new Error('Spotify Connect is disabled — set SPOTIFY_CONNECT_ENABLED=true');
    }

    if (player.isSpotifyConnectActive) {
      throw new Error('Spotify Connect is already running');
    }

    await interaction.deferReply();
    await player.startSpotifyConnect();

    const {deviceName} = getSpotifyConnectOptions();
    await interaction.editReply(
      `🎧 listening as **${deviceName}** — pick it from the device list in your Spotify app`,
    );
  }
}
