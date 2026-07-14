import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import Player from '../services/player.js';
import FileCacheProvider from '../services/file-cache.js';
import GetSongs from '../services/get-songs.js';

@injectable()
export default class {
  private readonly guildPlayers: Map<string, Player>;
  private readonly fileCache: FileCacheProvider;
  private readonly getSongs: GetSongs;

  constructor(@inject(TYPES.FileCache) fileCache: FileCacheProvider, @inject(TYPES.Services.GetSongs) getSongs: GetSongs) {
    this.guildPlayers = new Map();
    this.fileCache = fileCache;
    this.getSongs = getSongs;
  }

  get(guildId: string): Player {
    let player = this.guildPlayers.get(guildId);

    if (!player) {
      player = new Player(this.fileCache, guildId, this.getSongs);

      this.guildPlayers.set(guildId, player);
    }

    return player;
  }
}
