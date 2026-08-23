import {VoiceChannel, Snowflake} from 'discord.js';
import {PassThrough, Readable, Transform} from 'stream';
import {setTimeout as sleep} from 'timers/promises';
import hasha from 'hasha';
import {WriteStream} from 'fs-capacitor';
import ffmpeg from 'fluent-ffmpeg';
import shuffle from 'array-shuffle';
import {
  AudioPlayer,
  AudioPlayerState,
  AudioPlayerStatus, AudioResource,
  createAudioPlayer,
  createAudioResource, DiscordGatewayAdapterCreator,
  entersState,
  joinVoiceChannel,
  StreamType,
  VoiceConnection,
  VoiceConnectionDisconnectReason,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import FileCacheProvider from './file-cache.js';
import type GetSongs from './get-songs.js';
import debug from '../utils/debug.js';
import {getSizeWithoutBots} from '../utils/channels.js';
import {getGuildSettings} from '../utils/get-guild-settings.js';
import {buildPlayingMessageEmbed} from '../utils/build-embed.js';
import {getYouTubeMediaSource, searchWithYtDlp} from '../utils/yt-dlp.js';
import SpotifyConnect, {
  SpotifyConnectAuth,
  deliverOAuthCode,
  getSpotifyConnectOptions,
  hasCachedCredentials,
  isSpotifyConnectEnabled,
  listSpotifyAccounts,
  promotePendingAccount,
  removeSpotifyAccount,
  LIBRESPOT_FFMPEG_INPUT_OPTIONS,
} from './spotify-connect.js';
import {Setting} from '@prisma/client';
import https from 'https';

// A track that stops this early never actually streamed.
const MIN_SUCCESSFUL_PLAY_SECONDS = 5;
// How many duds in a row before giving up instead of chewing through the queue.
const MAX_CONSECUTIVE_FAILED_SONGS = 3;

export enum MediaSource {
  Youtube,
  HLS,
}

export interface QueuedPlaylist {
  title: string;
  source: string;
}

export interface SongMetadata {
  title: string;
  artist: string;
  url: string; // For YT, it's the video ID (not the full URI)
  length: number;
  offset: number;
  playlist: QueuedPlaylist | null;
  isLive: boolean;
  thumbnailUrl: string | null;
  source: MediaSource;
}
export interface QueuedSong extends SongMetadata {
  addedInChannelId: Snowflake;
  requestedBy: string;
}

export enum STATUS {
  PLAYING,
  PAUSED,
  IDLE,
}

export interface PlayerEvents {
  statusChange: (oldStatus: STATUS, newStatus: STATUS) => void;
}

export const DEFAULT_VOLUME = 100;

export type AudioEffect = 'none' | 'bass' | 'treble' | 'reverb' | '8d' | 'nightcore' | 'vaporwave';

export const AUDIO_EFFECT_FILTERS: Record<AudioEffect, string[]> = {
  none: [],
  bass: ['bass=g=10'],
  treble: ['treble=g=8'],
  reverb: ['aecho=0.8:0.88:60|69:0.4|0.3'],
  '8d': ['apulsator=hz=0.08'],
  nightcore: ['asetrate=48000*1.25', 'aresample=48000'],
  vaporwave: ['asetrate=44100*0.8', 'aresample=44100'],
};

export default class {
  public voiceConnection: VoiceConnection | null = null;
  public status = STATUS.PAUSED;
  public guildId: string;
  public loopCurrentSong = false;
  public loopCurrentQueue = false;
  // Auto-continue with similar tracks once the queue runs dry, gated on someone
  // actually being in the voice channel so it never plays to an empty room.
  public radioAutoEnabled = false;
  // Tracks the last Spotify playlist URL and how many songs were loaded
  // so "Load More from Spotify" can fetch the next batch at the right offset.
  public spotifyPlaylistContext: {url: string; loadedCount: number; lyricVideo?: boolean} | null = null;
  private currentChannel: VoiceChannel | undefined;
  // Extra connections for multi-channel broadcast (same audio, multiple channels)
  private readonly extraConnections: Map<string, VoiceConnection> = new Map();
  private readonly extraChannels: Map<string, VoiceChannel> = new Map();
  private queue: QueuedSong[] = [];
  private queuePosition = 0;
  // Songs waiting to be moved into the active queue as it empties.
  // Stored as plain SongMetadata (no addedInChannelId yet).
  private pendingSongs: Array<{song: SongMetadata; channelId: string; requestedBy: string}> = [];
  private audioPlayer: AudioPlayer | null = null;
  private audioResource: AudioResource | null = null;
  private volume?: number;
  private defaultVolume: number = DEFAULT_VOLUME;
  private speed = 1;
  private effect: AudioEffect = 'none';
  private eq = {bass: 0, mid: 0, treble: 0};
  private crossfade = 0;
  private consecutivePlayErrors = 0;
  private thumbnailFetchInProgress = false;

  // A song that goes idle almost immediately never really played — usually a
  // dead media URL (YouTube throttling/403). Without a circuit breaker each
  // failure advances the queue, so a bad run silently burns an entire playlist
  // in seconds. Track consecutive duds and stop instead of racing to the end.
  private consecutiveFailedSongs = 0;

  // Set while the bot is acting as a Spotify Connect speaker. Spotify owns
  // playback in that mode, so the queue must keep its hands off.
  private spotifyConnect: SpotifyConnect | null = null;

  private spotifyConnectAuth: SpotifyConnectAuth | null = null;
  private pendingAuthUrl: string | null = null;
  // Which linked Spotify account is currently driving. Only one can, because
  // there is a single voice connection to stream into.
  private activeSpotifyAccount: string | null = null;
  private lastLinkedAccount: string | null = null;
  private spotifyConnectAudioCheck: NodeJS.Timeout | null = null;
  private nowPlaying: QueuedSong | null = null;
  private playPositionInterval: NodeJS.Timeout | undefined;
  private thumbSweepInterval: NodeJS.Timeout | undefined;
  private lastSongURL = '';

  private positionInSeconds = 0;
  private readonly fileCache: FileCacheProvider;
  private disconnectTimer: NodeJS.Timeout | null = null;
  private pauseDisconnectTimer: NodeJS.Timeout | null = null;
  private emptyChannelTimer: NodeJS.Timeout | null = null;
  private queueClearTimer: NodeJS.Timeout | null = null;
  private pauseDisconnectsAt: number | null = null;
  private queueClearsAt: number | null = null;

  private readonly channelToSpeakingUsers: Map<string, Set<string>> = new Map();
  private hasRegisteredVoiceActivityListener = false;

  private readonly getSongs: GetSongs;

  constructor(fileCache: FileCacheProvider, guildId: string, getSongs: GetSongs) {
    this.fileCache = fileCache;
    this.guildId = guildId;
    this.getSongs = getSongs;
  }

  async connect(channel: VoiceChannel): Promise<void> {
    if (this.voiceConnection) {
      this.disconnect();
    }

    // Cancel any pending queue-clear so reconnecting preserves the queue
    if (this.queueClearTimer) {
      clearTimeout(this.queueClearTimer);
      this.queueClearTimer = null;
      this.queueClearsAt = null;
    }

    // Always get freshest default volume setting value
    const settings = await getGuildSettings(this.guildId);
    const {defaultVolume = DEFAULT_VOLUME} = settings;
    this.defaultVolume = defaultVolume;

    const voiceConnection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      selfDeaf: false,
      adapterCreator: channel.guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
    });

    this.voiceConnection = voiceConnection;
    this.currentChannel = channel;
    this.hasRegisteredVoiceActivityListener = false;

    const guildSettings = await getGuildSettings(this.guildId);
    const stateTransitions = [voiceConnection.state.status];
    voiceConnection.on('stateChange', (oldState, newState) => {
      stateTransitions.push(newState.status);
      if (stateTransitions.length > 10) {
        stateTransitions.shift();
      }

      debug(`Voice connection state changed: ${oldState.status} -> ${newState.status}`);

      if (newState.status === VoiceConnectionStatus.Ready && !this.hasRegisteredVoiceActivityListener) {
        this.registerVoiceActivityListener(guildSettings);
        this.hasRegisteredVoiceActivityListener = true;
      }
    });

    voiceConnection.on(VoiceConnectionStatus.Disconnected, this.onVoiceConnectionDisconnect.bind(this));

    try {
      await this.waitForVoiceConnectionReady(voiceConnection);
    } catch {
      const {status} = voiceConnection.state;
      voiceConnection.destroy();
      this.voiceConnection = null;
      throw new Error(`Failed to connect to the voice channel (last state: ${status}, rejoin attempts: ${voiceConnection.rejoinAttempts}, recent states: ${stateTransitions.join(' -> ')}).`);
    }
  }

  disconnect(): void {
    if (this.pauseDisconnectTimer) {
      clearTimeout(this.pauseDisconnectTimer);
      this.pauseDisconnectTimer = null;
      this.pauseDisconnectsAt = null;
    }

    if (this.voiceConnection) {
      if (this.status === STATUS.PLAYING) {
        this.pause();
      }

      // Pause() may restart the timer — clear it again
      if (this.pauseDisconnectTimer) {
        clearTimeout(this.pauseDisconnectTimer);
        this.pauseDisconnectTimer = null;
        this.pauseDisconnectsAt = null;
      }

      this.loopCurrentSong = false;
      this.voiceConnection.destroy();
      this.audioPlayer?.stop(true);

      this.voiceConnection = null;
      this.audioPlayer = null;
      this.audioResource = null;
      this.currentChannel = undefined;
      this.channelToSpeakingUsers.clear();
      this.hasRegisteredVoiceActivityListener = false;
    }

    // Also disconnect all extra channels
    for (const conn of this.extraConnections.values()) {
      try {
        conn.destroy();
      } catch { /* ignore */ }
    }

    this.extraConnections.clear();
    this.extraChannels.clear();

    // Schedule queue clear 5 minutes after disconnect so the queue is wiped
    // if the bot does not rejoin. connect() cancels this timer.
    // softDisconnect() will overwrite it with its own timer immediately after.
    if (!this.queueClearTimer) {
      const clearMs = 5 * 60 * 1000;
      this.queueClearsAt = Date.now() + clearMs;
      this.queueClearTimer = setTimeout(() => {
        this.queueClearTimer = null;
        this.queueClearsAt = null;
        this.queuePosition = 0;
        this.queue = [];
        this.pendingSongs = [];
        this.spotifyPlaylistContext = null;
      }, clearMs);
    }
  }

  // Join an additional voice channel and broadcast the same audio to it
  async joinChannel(channel: VoiceChannel): Promise<void> {
    if (this.extraConnections.has(channel.id) || channel.id === this.currentChannel?.id) {
      return; // Already in this channel
    }

    const conn = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      selfDeaf: false,
      adapterCreator: channel.guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
    });

    await this.waitForVoiceConnectionReady(conn);

    this.extraConnections.set(channel.id, conn);
    this.extraChannels.set(channel.id, channel);

    // If already playing, subscribe this connection immediately
    if (this.audioPlayer) {
      conn.subscribe(this.audioPlayer);
    }
  }

  leaveChannel(channelId: string): void {
    const conn = this.extraConnections.get(channelId);
    if (conn) {
      try {
        conn.destroy();
      } catch { /* ignore */ }

      this.extraConnections.delete(channelId);
      this.extraChannels.delete(channelId);
    }
  }

  getActiveChannelIds(): string[] {
    const ids: string[] = [];
    if (this.currentChannel) {
      ids.push(this.currentChannel.id);
    }

    for (const id of this.extraConnections.keys()) {
      ids.push(id);
    }

    return ids;
  }

  async seek(positionSeconds: number): Promise<void> {
    this.status = STATUS.PAUSED;

    const voiceConnection = await this.ensureVoiceConnectionReady();

    const currentSong = this.getCurrent();

    if (!currentSong) {
      throw new Error('No song currently playing');
    }

    if (positionSeconds > currentSong.length) {
      throw new Error('Seek position is outside the range of the song.');
    }

    let realPositionSeconds = positionSeconds;
    let to: number | undefined;
    if (currentSong.offset !== undefined) {
      realPositionSeconds += currentSong.offset;
      to = currentSong.length + currentSong.offset;
    }

    const stream = await this.getStream(currentSong, {seek: realPositionSeconds, to});
    this.audioPlayer = createAudioPlayer({
      behaviors: {
        // Needs to be somewhat high for livestreams
        maxMissedFrames: 50,
      },
    });
    voiceConnection.subscribe(this.audioPlayer);
    // Subscribe extra channels to the same player (multicasting)
    for (const conn of this.extraConnections.values()) {
      conn.subscribe(this.audioPlayer);
    }

    this.playAudioPlayerResource(this.createAudioStream(stream));
    this.attachListeners();
    this.startTrackingPosition(positionSeconds);

    this.status = STATUS.PLAYING;
  }

  async forwardSeek(positionSeconds: number): Promise<void> {
    return this.seek(this.positionInSeconds + positionSeconds);
  }

  getPosition(): number {
    return this.positionInSeconds;
  }

  async play(): Promise<void> {
    const voiceConnection = await this.ensureVoiceConnectionReady();

    const currentSong = this.getCurrent();

    if (!currentSong) {
      throw new Error('Queue empty.');
    }

    // Cancel any pending idle disconnection
    if (this.disconnectTimer) {
      clearInterval(this.disconnectTimer);
      this.disconnectTimer = null;
    }

    // Resume from paused state
    if (this.status === STATUS.PAUSED && currentSong.url === this.nowPlaying?.url) {
      // Clear pause-disconnect timer on resume
      if (this.pauseDisconnectTimer) {
        clearTimeout(this.pauseDisconnectTimer);
        this.pauseDisconnectTimer = null;
        this.pauseDisconnectsAt = null;
      }

      if (this.audioPlayer) {
        this.audioPlayer.unpause();
        this.status = STATUS.PLAYING;
        this.startTrackingPosition();
        return;
      }

      // Was disconnected, need to recreate stream
      if (!currentSong.isLive) {
        return this.seek(this.getPosition());
      }
    }

    try {
      let positionSeconds: number | undefined;
      let to: number | undefined;
      if (currentSong.offset !== undefined) {
        positionSeconds = currentSong.offset;
        to = currentSong.length + currentSong.offset;
      }

      const stream = await this.getStream(currentSong, {seek: positionSeconds, to});
      this.audioPlayer = createAudioPlayer({
        behaviors: {
          // Needs to be somewhat high for livestreams
          maxMissedFrames: 50,
        },
      });
      voiceConnection.subscribe(this.audioPlayer);
      for (const conn of this.extraConnections.values()) {
        conn.subscribe(this.audioPlayer);
      }

      this.playAudioPlayerResource(this.createAudioStream(stream));

      this.attachListeners();

      this.status = STATUS.PLAYING;
      this.nowPlaying = currentSong;

      if (currentSong.url === this.lastSongURL) {
        this.startTrackingPosition();
      } else {
        // Reset position counter
        this.startTrackingPosition(0);
        this.lastSongURL = currentSong.url;
      }

      this.consecutivePlayErrors = 0;
    } catch (error: unknown) {
      this.consecutivePlayErrors++;

      // Stop the cascade after 3 consecutive failures to prevent the bot
      // from rapidly skipping through the entire queue on e.g. a yt-dlp outage.
      if (this.consecutivePlayErrors >= 3) {
        this.consecutivePlayErrors = 0;
        this.status = STATUS.IDLE;
        return;
      }

      await this.forward(1);

      if ((error as {statusCode: number}).statusCode === 410 && currentSong) {
        const channelId = currentSong.addedInChannelId;

        if (channelId) {
          debug(`${currentSong.title} is unavailable`);
          return;
        }
      }

      throw error;
    }
  }

  pause(): void {
    if (this.status !== STATUS.PLAYING) {
      throw new Error('Not currently playing.');
    }

    this.status = STATUS.PAUSED;

    if (this.audioPlayer) {
      this.audioPlayer.pause();
    }

    this.stopTrackingPosition();

    if (this.pauseDisconnectTimer) {
      clearTimeout(this.pauseDisconnectTimer);
    }

    const pauseMs = 5 * 60 * 1000;
    this.pauseDisconnectsAt = Date.now() + pauseMs;
    this.pauseDisconnectTimer = setTimeout(() => {
      if (this.status === STATUS.PAUSED) {
        this.disconnect();
      }

      this.pauseDisconnectTimer = null;
      this.pauseDisconnectsAt = null;
    }, pauseMs);
  }

  async forward(skip: number): Promise<void> {
    this.manualForward(skip);

    try {
      if (this.getCurrent() && this.status !== STATUS.PAUSED) {
        await this.play();
      } else {
        await this.finishQueue();
      }
    } catch (error: unknown) {
      this.queuePosition--;
      throw error;
    }
  }

  get isSpotifyConnectActive(): boolean {
    return this.spotifyConnect !== null;
  }

  get spotifyConnectAuthUrl(): string | null {
    return this.pendingAuthUrl;
  }

  get activeSpotifyConnectAccount(): string | null {
    return this.activeSpotifyAccount;
  }

  async listSpotifyConnectAccounts(): Promise<string[]> {
    return listSpotifyAccounts();
  }

  /**
   * Forgets a linked account. Stops playback first if it is the one driving.
   */
  async unlinkSpotifyConnectAccount(account: string): Promise<void> {
    if (this.activeSpotifyAccount === account) {
      this.stopSpotifyConnect();
    }

    await removeSpotifyAccount(account);
  }

  /**
   * Starts the one-off sign-in needed before Spotify will stream to this device.
   *
   * Resolves with the URL the user must visit. The code that URL produces comes
   * back through submitSpotifyConnectCode, because Spotify redirects it to
   * 127.0.0.1 — reachable from in here, but not from the user's browser.
   */
  async beginSpotifyConnectAuth(): Promise<string> {
    if (this.pendingAuthUrl && this.spotifyConnectAuth?.isRunning) {
      return this.pendingAuthUrl;
    }

    const auth = new SpotifyConnectAuth();
    this.spotifyConnectAuth = auth;

    auth.on('log', (line: string) => {
      console.log(`[librespot:auth] ${line}`);
    });

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('librespot did not produce a sign-in link in time.'));
      }, 30_000);

      auth.once('auth-url', (url: string) => {
        clearTimeout(timer);
        this.pendingAuthUrl = url;
        resolve(url);
      });

      auth.once('error', (error: Error) => {
        clearTimeout(timer);
        this.spotifyConnectAuth = null;
        reject(error);
      });

      auth.once('authenticated', (username: string) => {
        // Credentials are cached now, so the sign-in process has done its job.
        // File them under the account that just signed in so this person stays
        // linked and others can link alongside them.
        this.pendingAuthUrl = null;
        auth.stop();
        this.spotifyConnectAuth = null;

        void promotePendingAccount(username)
          .then(account => {
            this.lastLinkedAccount = account;
            console.log(`[librespot] linked Spotify account: ${account}`);
          })
          .catch((error: unknown) => {
            console.log(`[librespot] could not save the linked account: ${(error as Error).message}`);
          });
      });

      auth.start(getSpotifyConnectOptions());
    });
  }

  /**
   * Completes sign-in with the code (or full redirected URL) the user pasted.
   */
  async submitSpotifyConnectCode(rawUrlOrCode: string): Promise<void> {
    if (!this.spotifyConnectAuth?.isRunning) {
      throw new Error('No sign-in is in progress — start Spotify Connect first.');
    }

    await deliverOAuthCode(rawUrlOrCode, getSpotifyConnectOptions().oauthPort);
    this.pendingAuthUrl = null;
  }

  /**
   * Hands playback over to Spotify: the bot stops being a queue and becomes a
   * Spotify Connect speaker that shows up in the user's device list.
   */
  async startSpotifyConnect(account?: string): Promise<void> {
    if (!isSpotifyConnectEnabled()) {
      throw new Error('Spotify Connect is disabled. Set SPOTIFY_CONNECT_ENABLED=true to use it.');
    }

    // Switching accounts is a stop and start rather than an error: only one can
    // hold the single voice connection, so taking over is the expected move.
    if (this.spotifyConnect) {
      if (account && account !== this.activeSpotifyAccount) {
        this.stopSpotifyConnect();
      } else {
        throw new Error('Spotify Connect is already running.');
      }
    }

    const linkedAccounts = await listSpotifyAccounts();
    const targetAccount = account ?? this.activeSpotifyAccount ?? this.lastLinkedAccount ?? linkedAccounts.at(0);
    const options = getSpotifyConnectOptions(targetAccount);

    // Without cached credentials the streaming process cannot reach the
    // account, and it cannot sign in either — its stdout is carrying audio.
    // Sign-in has to happen first, in its own process.
    if (process.env.SPOTIFY_CONNECT_ENABLE_OAUTH === 'true' && !await hasCachedCredentials(options.cacheDir)) {
      const url = await this.beginSpotifyConnectAuth();
      throw new Error(`SPOTIFY_AUTH_REQUIRED:${url}`);
    }

    this.activeSpotifyAccount = targetAccount ?? null;

    // The sign-in process is a full Connect device with the same name, and its
    // stdout is parsed as text rather than piped to ffmpeg. Leaving it running
    // means Spotify can attach to it instead — the device connects, playback
    // looks fine in the app, and no audio ever reaches Discord.
    if (this.spotifyConnectAuth) {
      this.spotifyConnectAuth.stop();
      this.spotifyConnectAuth = null;
      this.pendingAuthUrl = null;
    }

    const voiceConnection = await this.ensureVoiceConnectionReady();

    // Tear down queue playback first so the two never fight over the connection.
    this.audioPlayer?.removeAllListeners();
    this.audioPlayer?.stop(true);
    this.stopTrackingPosition();
    this.nowPlaying = null;

    const connect = new SpotifyConnect();
    this.spotifyConnect = connect;

    connect.on('log', (line: string) => {
      // Always printed, not sent through debug(): these lines carry the
      // first-run OAuth URL and the reason discovery or login failed, and
      // debug() is silent unless DEBUG=muse is set. librespot is not chatty
      // enough for this to be noisy.
      console.log(`[librespot] ${line}`);
    });

    const handleTermination = (reason: unknown) => {
      // Silent death here looks identical to "device never appeared", so say so.
      console.log(`[librespot] stopped: ${String(reason)}`);

      if (this.spotifyConnect === connect) {
        this.spotifyConnect = null;
        this.status = STATUS.IDLE;
      }
    };

    connect.on('exit', (code: number | null, signal: string | null) => {
      handleTermination(`exit code ${String(code)}${signal ? ` (signal ${signal})` : ''}`);
    });
    connect.on('error', (error: Error) => {
      // Most commonly ENOENT: the librespot binary is not in the image.
      handleTermination(error.message);
    });

    try {
      const pcm = connect.start(options);

      // Counting has to happen inside the pipeline, not via a 'data' listener:
      // that would switch the stream to flowing mode and consume it as fast as
      // librespot produces, removing the backpressure this mode depends on.
      // A Transform stays subject to the downstream pace.
      let hasLoggedFirstAudio = false;
      let bytesFromLibrespot = 0;
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytesFromLibrespot += chunk.length;
          if (!hasLoggedFirstAudio) {
            hasLoggedFirstAudio = true;
            console.log('[librespot] receiving audio from Spotify');
          }

          callback(null, chunk);
        },
      });

      // Logged on transition only, so the question "did pausing in Spotify
      // actually stop the audio at the source?" can be answered from the logs.
      // Bytes stopping but sound continuing means buffering downstream; bytes
      // still flowing means Spotify is not driving this process at all.
      let wasFlowing = false;
      let lastByteCount = 0;
      let ticksWhileFlowing = 0;
      this.spotifyConnectAudioCheck = setInterval(() => {
        const delta = bytesFromLibrespot - lastByteCount;
        lastByteCount = bytesFromLibrespot;
        const isFlowing = delta > 0;

        const rate = Math.round(delta / 1024 / 3);

        if (isFlowing !== wasFlowing) {
          wasFlowing = isFlowing;
          // Realtime for 44.1kHz stereo S16 is ~172 KB/s; anything far above
          // that means audio is being buffered ahead rather than streamed.
          console.log(isFlowing
            ? `[librespot] audio flowing (${rate} KB/s, realtime is ~172)`
            : '[librespot] audio stopped at source');
        }

        // Transition-only logging hides the steady-state rate, which is the
        // number that shows whether audio is creeping ahead of playback and
        // growing the pause delay. Sample it occasionally while flowing.
        ticksWhileFlowing = isFlowing ? ticksWhileFlowing + 1 : 0;
        if (isFlowing && ticksWhileFlowing % 10 === 0) {
          console.log(`[librespot] steady state: ${rate} KB/s (realtime is ~172)`);
        }
      }, 3_000);

      const stream = this.createLiveReadStream(pcm.pipe(meter), [...LIBRESPOT_FFMPEG_INPUT_OPTIONS]);

      this.audioPlayer = createAudioPlayer({
        behaviors: {
          // A paused phone starves this pipe indefinitely and that is normal,
          // so the player must never treat silence as a dead stream. Any finite
          // limit is just a timer until Connect breaks: at 10_000 frames it
          // gave up after exactly 200s paused, destroyed the stream, killed
          // ffmpeg, and left librespot connected but inaudible. librespot
          // exiting is the only real failure signal here.
          maxMissedFrames: Number.MAX_SAFE_INTEGER,
        },
      });

      voiceConnection.subscribe(this.audioPlayer);
      for (const conn of this.extraConnections.values()) {
        conn.subscribe(this.audioPlayer);
      }

      this.playAudioPlayerResource(this.createLiveAudioStream(stream));
      this.status = STATUS.PLAYING;
    } catch (error: unknown) {
      connect.stop();
      this.spotifyConnect = null;
      throw error;
    }
  }

  stopSpotifyConnect(): void {
    if (this.spotifyConnectAudioCheck) {
      clearInterval(this.spotifyConnectAudioCheck);
      this.spotifyConnectAudioCheck = null;
    }

    if (!this.spotifyConnect) {
      return;
    }

    this.spotifyConnect.stop();
    this.spotifyConnect = null;
    this.activeSpotifyAccount = null;
    this.audioPlayer?.stop(true);
    this.status = STATUS.IDLE;
  }

  registerVoiceActivityListener(guildSettings: Setting) {
    const {turnDownVolumeWhenPeopleSpeak, turnDownVolumeWhenPeopleSpeakTarget} = guildSettings;
    if (!turnDownVolumeWhenPeopleSpeak || !this.voiceConnection) {
      return;
    }

    this.voiceConnection.receiver.speaking.on('start', (userId: string) => {
      if (!this.currentChannel) {
        return;
      }

      const member = this.currentChannel.members.get(userId);
      const channelId = this.currentChannel?.id;

      if (member) {
        if (!this.channelToSpeakingUsers.has(channelId)) {
          this.channelToSpeakingUsers.set(channelId, new Set());
        }

        this.channelToSpeakingUsers.get(channelId)?.add(member.id);
      }

      this.suppressVoiceWhenPeopleAreSpeaking(turnDownVolumeWhenPeopleSpeakTarget);
    });

    this.voiceConnection.receiver.speaking.on('end', (userId: string) => {
      if (!this.currentChannel) {
        return;
      }

      const member = this.currentChannel.members.get(userId);
      const channelId = this.currentChannel.id;
      if (member) {
        if (!this.channelToSpeakingUsers.has(channelId)) {
          this.channelToSpeakingUsers.set(channelId, new Set());
        }

        this.channelToSpeakingUsers.get(channelId)?.delete(member.id);
      }

      this.suppressVoiceWhenPeopleAreSpeaking(turnDownVolumeWhenPeopleSpeakTarget);
    });
  }

  suppressVoiceWhenPeopleAreSpeaking(turnDownVolumeWhenPeopleSpeakTarget: number): void {
    if (!this.currentChannel) {
      return;
    }

    const speakingUsers = this.channelToSpeakingUsers.get(this.currentChannel.id);
    if (speakingUsers && speakingUsers.size > 0) {
      this.setVolume(turnDownVolumeWhenPeopleSpeakTarget);
    } else {
      this.setVolume(this.defaultVolume);
    }
  }

  canGoForward(skip: number) {
    return (this.queuePosition + skip - 1) < this.queue.length;
  }

  manualForward(skip: number): void {
    if (this.canGoForward(skip)) {
      this.queuePosition += skip;
      this.positionInSeconds = 0;
      this.stopTrackingPosition();
    } else {
      throw new Error('No songs in queue to forward to.');
    }
  }

  canGoBack() {
    return this.queuePosition - 1 >= 0;
  }

  async back(): Promise<void> {
    if (this.canGoBack()) {
      this.queuePosition--;
      this.positionInSeconds = 0;
      this.stopTrackingPosition();

      if (this.status !== STATUS.PAUSED) {
        await this.play();
      }
    } else {
      throw new Error('No songs in queue to go back to.');
    }
  }

  getCurrent(): QueuedSong | null {
    if (this.queue[this.queuePosition]) {
      return this.queue[this.queuePosition];
    }

    return null;
  }

  /**
   * Returns queue, not including the current song.
   * @returns {QueuedSong[]}
   */
  getQueue(): QueuedSong[] {
    return this.queue.slice(this.queuePosition + 1);
  }

  add(song: QueuedSong, {immediate = false, insertPosition}: {immediate?: boolean; insertPosition?: number} = {}): void {
    const pos = insertPosition ?? (immediate ? 1 : undefined);
    if (pos === undefined) {
      this.queue.push(song);
    } else {
      // Insert at a specific 1-based position in the upcoming queue
      const insertAt = Math.min(this.queuePosition + Math.max(1, pos), this.queue.length);
      this.queue = [...this.queue.slice(0, insertAt), song, ...this.queue.slice(insertAt)];
    }
  }

  shuffle(): void {
    // Shuffle the active queue AND pending together so the full set is randomised
    const upcoming = this.queue.slice(this.queuePosition + 1);
    const allUpcoming = [
      ...upcoming.map(s => ({song: s as SongMetadata, channelId: s.addedInChannelId, requestedBy: s.requestedBy})),
      ...this.pendingSongs,
    ];
    const shuffled = shuffle(allUpcoming);

    // First ACTIVE_SIZE go back into the live queue, rest stay pending
    const ACTIVE_SIZE = 100;
    const newActive: QueuedSong[] = shuffled.slice(0, ACTIVE_SIZE).map(p => ({
      ...p.song,
      addedInChannelId: p.channelId,
      requestedBy: p.requestedBy,
    }));
    this.pendingSongs = shuffled.slice(ACTIVE_SIZE);
    this.queue = [...this.queue.slice(0, this.queuePosition + 1), ...newActive];
  }

  setPendingSongs(songs: Array<{song: SongMetadata; channelId: string; requestedBy: string}>): void {
    this.pendingSongs = songs;
  }

  getPendingCount(): number {
    return this.pendingSongs.length;
  }

  getPendingPreview(n = 10): SongMetadata[] {
    return this.pendingSongs.slice(0, n).map(p => p.song);
  }

  flushPending(count = 100): void {
    this.refillFromPending(count);
  }

  clear(): void {
    const newQueue = [];

    // Don't clear curently playing song
    const current = this.getCurrent();

    if (current) {
      newQueue.push(current);
    }

    this.queuePosition = 0;
    this.queue = newQueue;
  }

  removeFromQueue(index: number, amount = 1): void {
    this.queue.splice(this.queuePosition + index, amount);
  }

  // Replace a queued song's search query with an alternative version search.
  // index is 1-based (same as the API convention for queue positions).
  // suffix is appended to "title artist", e.g. "radio edit" or "lyric video".
  replaceWithVariant(index: number, suffix: string): void {
    const song = this.queue[this.queuePosition + index];
    if (!song) {
      return;
    }

    // Build new search from title + artist — handles both ytsearch and resolved IDs
    song.url = `ytsearch1:${song.title} ${song.artist} ${suffix}`;
    song.thumbnailUrl = null; // Resolved when the song plays
  }

  shuffleQueue(): void {
    const upcoming = this.queue.splice(this.queuePosition + 1);
    this.queue.push(...shuffle(upcoming));
  }

  removeCurrent(): void {
    this.queue = [...this.queue.slice(0, this.queuePosition), ...this.queue.slice(this.queuePosition + 1)];
  }

  queueSize(): number {
    return this.getQueue().length;
  }

  isQueueEmpty(): boolean {
    return this.queueSize() === 0;
  }

  stop(): void {
    this.disconnect();
    this.queuePosition = 0;
    this.queue = [];
  }

  // Leaves the voice channel but preserves the queue for 300 seconds.
  // If the bot reconnects within that window the timer is cancelled.
  softDisconnect(gracePeriodSeconds = 300): void {
    this.disconnect();

    if (this.queueClearTimer) {
      clearTimeout(this.queueClearTimer);
    }

    const clearMs = gracePeriodSeconds * 1000;
    this.queueClearsAt = Date.now() + clearMs;
    this.queueClearTimer = setTimeout(() => {
      this.queueClearTimer = null;
      this.queueClearsAt = null;
      this.queuePosition = 0;
      this.queue = [];
    }, clearMs);
  }

  /**
   * Clears the entire queue and stops playback, but keeps the bot connected
   * to the voice channel. The bot will disconnect after the configured idle
   * timeout (secondsToWaitAfterQueueEmpties).
   */
  async clearQueue(): Promise<void> {
    // Set all state BEFORE stop() so the synchronous Idle event sees IDLE status
    // and onAudioPlayerIdle skips all queue-advancement logic.
    this.status = STATUS.IDLE;
    this.nowPlaying = null;
    this.positionInSeconds = 0;
    this.queuePosition = 0;
    this.queue = [];
    this.stopTrackingPosition();
    this.audioPlayer?.stop(true);

    // Reset any pending idle disconnect timer and start a fresh one
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }

    const settings = await getGuildSettings(this.guildId);
    const {secondsToWaitAfterQueueEmpties} = settings;
    if (secondsToWaitAfterQueueEmpties !== 0) {
      this.disconnectTimer = setTimeout(() => {
        if (this.status === STATUS.IDLE) {
          this.disconnect();
        }
      }, secondsToWaitAfterQueueEmpties * 1000);
    }
  }

  scheduleEmptyChannelDisconnect(seconds: number): void {
    if (this.emptyChannelTimer) {
      return;
    }

    this.emptyChannelTimer = setTimeout(() => {
      this.emptyChannelTimer = null;
      if (this.voiceConnection) {
        this.disconnect();
      }
    }, seconds * 1000);
  }

  cancelEmptyChannelDisconnect(): void {
    if (this.emptyChannelTimer) {
      clearTimeout(this.emptyChannelTimer);
      this.emptyChannelTimer = null;
    }
  }

  move(from: number, to: number): QueuedSong {
    if (from > this.queueSize() || to > this.queueSize()) {
      throw new Error('Move index is outside the range of the queue.');
    }

    this.queue.splice(this.queuePosition + to, 0, this.queue.splice(this.queuePosition + from, 1)[0]);

    return this.queue[this.queuePosition + to];
  }

  setVolume(level: number): void {
    // Level should be a number between 0 and 100 = 0% => 100%
    this.volume = level;
    this.setAudioPlayerVolume(level);
  }

  getVolume(): number {
    // Only use default volume if player volume is not already set (in the event of a reconnect we shouldn't reset)
    return this.volume ?? this.defaultVolume;
  }

  getPauseDisconnectsAt(): number | null {
    return this.pauseDisconnectsAt;
  }

  getQueueClearsAt(): number | null {
    return this.queueClearsAt;
  }

  setSpeed(speed: number): void {
    this.speed = Math.max(0.5, Math.min(2, speed));
  }

  getSpeed(): number {
    return this.speed;
  }

  setEffect(effect: AudioEffect): void {
    this.effect = effect;
  }

  getEffect(): AudioEffect {
    return this.effect;
  }

  setEq(bass: number, mid: number, treble: number): void {
    this.eq = {
      bass: Math.max(-12, Math.min(12, bass)),
      mid: Math.max(-12, Math.min(12, mid)),
      treble: Math.max(-12, Math.min(12, treble)),
    };
  }

  getEq(): {bass: number; mid: number; treble: number} {
    return {...this.eq};
  }

  setCrossfade(seconds: number): void {
    this.crossfade = Math.max(0, Math.min(8, seconds));
  }

  getCrossfade(): number {
    return this.crossfade;
  }

  // Resolve album-art thumbnails for queued and pending songs using the Deezer
  // public search API (no auth required).  Queue items are live references —
  // thumbnailUrl mutations appear in the status API on the next 2-second poll.
  prefetchThumbnails(): void {
    // Skip if a fetch is already running — prevents parallel Deezer floods
    // when the frontend calls refresh-thumbnails every few seconds.
    if (this.thumbnailFetchInProgress) {
      return;
    }

    const noThumb = (s: SongMetadata) => !s.thumbnailUrl;

    const targets: SongMetadata[] = [
      ...this.queue.filter(noThumb),
      ...this.pendingSongs.map(p => p.song).filter(noThumb),
    ];
    if (targets.length === 0) {
      return;
    }

    const deezerLookup = async (song: SongMetadata): Promise<void> =>
      new Promise(resolve => {
        if (song.thumbnailUrl) {
          resolve();
          return;
        }

        const q = encodeURIComponent(`${song.title} ${song.artist}`);
        const req = https.get(
          `https://api.deezer.com/search?q=${q}&limit=1`,
          {headers: {'User-Agent': 'Mozilla/5.0'}},
          (res: {on(e: string, cb: (...a: unknown[]) => void): void}) => {
            let raw = '';
            res.on('data', (chunk: unknown) => {
              raw += String(chunk);
            });
            res.on('end', () => {
              try {
                const body = JSON.parse(raw) as {data?: Array<{album?: {cover_xl?: string; cover_medium?: string}}>};
                const cover = body.data?.[0]?.album?.cover_xl ?? body.data?.[0]?.album?.cover_medium ?? null;
                if (cover && !song.thumbnailUrl) {
                  song.thumbnailUrl = cover;
                }
              } catch { /* malformed JSON — leave thumbnail null */ }

              resolve();
            });
            res.on('error', () => {
              resolve();
            });
          },
        );
        req.on('error', () => {
          resolve();
        });
        req.setTimeout(5000, () => {
          req.destroy();
          resolve();
        });
      });

    // Deezer allows 50 req / 5 s — fire 50 at a time with a 5 s gap.
    this.thumbnailFetchInProgress = true;
    void (async () => {
      try {
        const BATCH = 50;
        for (let i = 0; i < targets.length; i += BATCH) {
          // eslint-disable-next-line no-await-in-loop
          await Promise.allSettled(targets.slice(i, i + BATCH).map(deezerLookup));
          if (i + BATCH < targets.length) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise<void>(resolve => {
              setTimeout(resolve, 5000);
            });
          }
        }
      } finally {
        this.thumbnailFetchInProgress = false;
      }
    })();
  }

  private refillFromPending(count = 20): void {
    const toAdd = this.pendingSongs.splice(0, count);
    for (const p of toAdd) {
      this.queue.push({...p.song, addedInChannelId: p.channelId, requestedBy: p.requestedBy} as QueuedSong);
    }

    if (toAdd.length > 0) {
      this.prefetchThumbnails();
    }
  }

  private getHashForCache(url: string): string {
    return hasha(url);
  }

  private async getStream(song: QueuedSong, options: {seek?: number; to?: number} = {}): Promise<Readable> {
    if (this.status === STATUS.PLAYING) {
      // Remove listeners BEFORE stopping so the Idle event on the old player
      // does not fire onAudioPlayerIdle and trigger an unintended extra forward().
      this.audioPlayer?.removeAllListeners();
      this.audioPlayer?.stop();
    } else if (this.status === STATUS.PAUSED) {
      this.audioPlayer?.removeAllListeners();
      this.audioPlayer?.stop(true);
    }

    if (song.source === MediaSource.HLS) {
      return this.createReadStream({input: song.url, cacheKey: song.url});
    }

    let ffmpegInput: string | null;
    const ffmpegInputOptions: string[] = [];
    let shouldCacheVideo = false;

    ffmpegInput = await this.fileCache.getPathFor(this.getHashForCache(song.url));

    if (!ffmpegInput) {
      // Resolve ytsearch1: queries to a real YouTube video ID first
      if (song.url.startsWith('ytsearch1:')) {
        const query = song.url.slice('ytsearch1:'.length);
        const result = await searchWithYtDlp(query);
        if (!result?.id) {
          throw new Error(`Could not find a YouTube match for: ${song.title}`);
        }

        song.url = result.id;
        if (!song.length && result.duration) {
          song.length = result.duration;
        }
      }

      const MAX_CACHE_LENGTH_SECONDS = 30 * 60; // 30 minutes
      shouldCacheVideo = !song.isLive && song.length < MAX_CACHE_LENGTH_SECONDS;

      // Always resolve via getYouTubeMediaSource so all PLAYER_CLIENT_ATTEMPTS are tried.
      // createYtDlpAudioStream only tried the first client and had no fallback.
      const mediaSource = await getYouTubeMediaSource(song.url);
      ffmpegInput = mediaSource.url;
      ffmpegInputOptions.push('-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5');
      ffmpegInputOptions.push(...this.buildFfmpegHeaderOptions(mediaSource.headers));
    }

    if (options.seek) {
      ffmpegInputOptions.push('-ss', options.seek.toString());
    }

    if (options.to) {
      ffmpegInputOptions.push('-to', options.to.toString());
    }

    return this.createReadStream({
      input: ffmpegInput,
      cacheKey: song.url,
      ffmpegInputOptions,
      cache: shouldCacheVideo,
      songLength: song.length,
    });
  }

  private startTrackingPosition(initalPosition?: number): void {
    if (initalPosition !== undefined) {
      this.positionInSeconds = initalPosition;
    }

    if (this.playPositionInterval) {
      clearInterval(this.playPositionInterval);
    }

    this.playPositionInterval = setInterval(() => {
      this.positionInSeconds++;
    }, 1000);

    if (!this.thumbSweepInterval) {
      this.thumbSweepInterval = setInterval(() => {
        this.prefetchThumbnails();
      }, 15_000);
    }
  }

  private stopTrackingPosition(): void {
    if (this.playPositionInterval) {
      clearInterval(this.playPositionInterval);
    }
  }

  private attachListeners(): void {
    if (!this.voiceConnection) {
      return;
    }

    if (!this.audioPlayer) {
      return;
    }

    if (this.audioPlayer.listeners(AudioPlayerStatus.Idle).length === 0) {
      this.audioPlayer.on(AudioPlayerStatus.Idle, this.onAudioPlayerIdle.bind(this));
    }
  }

  private async onVoiceConnectionDisconnect(): Promise<void> {
    if (!this.voiceConnection || this.voiceConnection.state.status !== VoiceConnectionStatus.Disconnected) {
      return;
    }

    const disconnectedState = this.voiceConnection.state;
    if (disconnectedState.reason === VoiceConnectionDisconnectReason.WebSocketClose && disconnectedState.closeCode === 4014) {
      try {
        await Promise.race([
          entersState(this.voiceConnection, VoiceConnectionStatus.Connecting, 5_000),
          entersState(this.voiceConnection, VoiceConnectionStatus.Signalling, 5_000),
        ]);
        return;
      } catch {
        this.disconnect();
        return;
      }
    }

    if (this.voiceConnection.rejoinAttempts < 5) {
      await sleep((this.voiceConnection.rejoinAttempts + 1) * 5_000);

      if (this.voiceConnection && this.voiceConnection.state.status === VoiceConnectionStatus.Disconnected) {
        if (this.voiceConnection.rejoin()) {
          return;
        }
      }
    }

    this.disconnect();
  }

  private async ensureVoiceConnectionReady(): Promise<VoiceConnection> {
    if (this.voiceConnection === null) {
      throw new Error('Not connected to a voice channel.');
    }

    await this.waitForVoiceConnectionReady(this.voiceConnection);

    return this.voiceConnection;
  }

  private async waitForVoiceConnectionReady(voiceConnection: VoiceConnection): Promise<void> {
    await entersState(voiceConnection, VoiceConnectionStatus.Ready, 60_000);
  }

  private async onAudioPlayerIdle(_oldState: AudioPlayerState, newState: AudioPlayerState): Promise<void> {
    // In Spotify Connect mode there is no queue to advance — a gap just means
    // Spotify is paused or between tracks.
    if (this.spotifyConnect) {
      return;
    }

    // Automatically advance queued song at end
    if (this.loopCurrentSong && newState.status === AudioPlayerStatus.Idle && this.status === STATUS.PLAYING) {
      await this.seek(0);
      return;
    }

    // Automatically re-add current song to queue
    if (this.loopCurrentQueue && newState.status === AudioPlayerStatus.Idle && this.status === STATUS.PLAYING) {
      const currentSong = this.getCurrent();

      if (currentSong) {
        this.add(currentSong);
      } else {
        return;
      }
    }

    if (newState.status === AudioPlayerStatus.Idle && this.status === STATUS.PLAYING) {
      // Distinguish "song finished" from "song never played". Anything that ends
      // well short of its own length (or within a few seconds when the length is
      // unknown) is treated as a playback failure.
      if (this.endedTooEarly()) {
        this.consecutiveFailedSongs++;
      } else {
        this.consecutiveFailedSongs = 0;
      }

      if (this.consecutiveFailedSongs >= MAX_CONSECUTIVE_FAILED_SONGS) {
        this.consecutiveFailedSongs = 0;
        await this.reportPlaybackFailure();
        await this.finishQueue();
        return;
      }

      // Top up from pending when fewer than 20 songs remain
      const remaining = this.queue.length - this.queuePosition - 1;
      if (remaining < 20 && this.pendingSongs.length > 0) {
        this.refillFromPending(20);
      }

      if (!this.canGoForward(1)) {
        await this.finishQueue();
        return;
      }

      await this.forward(1);
      const currentSong = this.getCurrent();
      if (!currentSong) {
        return;
      }

      // Auto announce the next song if configured to
      const settings = await getGuildSettings(this.guildId);
      const {autoAnnounceNextSong} = settings;
      if (autoAnnounceNextSong && this.currentChannel) {
        await this.currentChannel.send({
          embeds: [buildPlayingMessageEmbed(this)],
        });
      }
    }
  }

  // True when the current track stopped so far short of its own length that it
  // cannot have actually streamed.
  private endedTooEarly(): boolean {
    const playedSeconds = this.positionInSeconds;
    const expectedLength = this.nowPlaying?.length ?? 0;

    if (expectedLength > 0) {
      return playedSeconds < Math.min(MIN_SUCCESSFUL_PLAY_SECONDS, expectedLength / 2);
    }

    return playedSeconds < MIN_SUCCESSFUL_PLAY_SECONDS;
  }

  private hasHumanListeners(): boolean {
    return this.currentChannel ? getSizeWithoutBots(this.currentChannel) > 0 : false;
  }

  // Appends similar tracks seeded from whatever just finished playing.
  // Returns whether anything was actually added.
  private async queueRadio(seed: QueuedSong): Promise<boolean> {
    try {
      const songs = await this.getSongs.getRadio(seed.url, 10);
      if (songs.length === 0) {
        return false;
      }

      for (const song of songs) {
        this.add({...song, addedInChannelId: seed.addedInChannelId, requestedBy: 'radio'});
      }

      return true;
    } catch {
      return false;
    }
  }

  // Surfaced instead of silently skipping: repeated instant-failures almost always
  // mean extraction is broken (stale yt-dlp / YouTube change), not bad songs.
  private async reportPlaybackFailure(): Promise<void> {
    if (!this.currentChannel) {
      return;
    }

    try {
      await this.currentChannel.send(
        `⚠️ Stopped after ${MAX_CONSECUTIVE_FAILED_SONGS} tracks failed to play back-to-back. `
        + 'This usually means YouTube extraction is failing — try updating yt-dlp.',
      );
    } catch {
      // Losing the warning must never break queue teardown.
    }
  }

  private async finishQueue(): Promise<void> {
    // Only radio-continue when the queue is genuinely exhausted, not just because
    // finishQueue() was reached via a paused skip with songs still queued.
    if (!this.canGoForward(1) && this.radioAutoEnabled && this.nowPlaying && this.hasHumanListeners() && await this.queueRadio(this.nowPlaying)) {
      // Adding songs only appends; queuePosition still points at the song that just
      // finished, so advance into the newly added tracks instead of replaying it.
      await this.forward(1);
      return;
    }

    this.status = STATUS.IDLE;
    this.audioPlayer?.stop(true);

    const settings = await getGuildSettings(this.guildId);

    const {secondsToWaitAfterQueueEmpties} = settings;
    if (secondsToWaitAfterQueueEmpties !== 0) {
      this.disconnectTimer = setTimeout(() => {
        // Make sure we are not accidentally playing
        // when disconnecting
        if (this.status === STATUS.IDLE) {
          this.disconnect();
        }
      }, secondsToWaitAfterQueueEmpties * 1000);
    }
  }

  private buildFfmpegHeaderOptions(headers: Record<string, string>) {
    const headerLines = Object.entries(headers)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\r\n');

    if (!headerLines) {
      return [];
    }

    return ['-headers', `${headerLines}\r\n`];
  }

  /**
   * Transcodes a live source without buffering it.
   *
   * The queue path pipes ffmpeg through an fs-capacitor, which stores the whole
   * output on disk. For a finite song that is harmless, but a Spotify Connect
   * stream is open-ended and librespot's pipe backend writes as fast as its
   * reader accepts — a real sound card is what normally paces it. An unbounded
   * buffer accepts everything instantly, so librespot races through the
   * playlist at many times realtime while Discord still plays second-by-second.
   *
   * Piping ffmpeg straight through lets Discord's realtime consumption apply
   * backpressure all the way back to librespot, which is what keeps Spotify in
   * step and makes pause and skip land where the listener expects.
   */
  private createLiveReadStream(input: Readable, ffmpegInputOptions: string[]): Readable {
    const command = ffmpeg(input)
      .inputOptions([
        ...ffmpegInputOptions,
        // Read the pipe at realtime. Without this ffmpeg consumes as fast as
        // librespot can produce and buffers tens of seconds internally, so
        // librespot races ahead in bursts and pause/skip act on audio that has
        // already passed through. Downstream backpressure alone only applies
        // once those internal buffers fill, which is far too late.
        '-re',
        // Do not sit on input waiting to fill a buffer; this is a live source.
        '-fflags',
        '+nobuffer',
        '-flags',
        'low_delay',
        // Keep the demuxer queue small so it cannot hoard either.
        '-thread_queue_size',
        '64',
      ])
      .noVideo()
      .audioCodec('libopus')
      .outputOptions([
        // The Matroska muxer batches audio into clusters, which by default hold
        // seconds of sound before anything is emitted. That delay is what makes
        // pause and skip feel broken: Discord is still playing audio Spotify
        // has already moved past. Cap the cluster and flush every packet.
        '-cluster_time_limit',
        '100',
        '-flush_packets',
        '1',
        '-max_delay',
        '0',
        '-muxdelay',
        '0',
        '-muxpreload',
        '0',
        // Shorter frames give the encoder less to hold onto.
        '-frame_duration',
        '20',
      ])
      .outputFormat('webm')
      .on('error', error => {
        // A killed process on teardown is expected, so this is only noise worth
        // reporting while Connect is meant to be running.
        if (!this.spotifyConnect) {
          return;
        }

        // Once ffmpeg is gone no audio can reach Discord again, but librespot
        // stays connected and the device keeps looking healthy in Spotify.
        // Tearing down makes the failure visible instead of silent.
        console.log(`[librespot] audio pipeline died (${error.message}) — stopping Spotify Connect`);
        this.stopSpotifyConnect();
      });

    // A small buffer here keeps only a fraction of a second in flight. The
    // default 64KB is roughly a second and a half of Opus, all of which has to
    // drain before a pause is audible.
    const output = new PassThrough({highWaterMark: 4096});
    command.pipe(output);

    return output;
  }

  private async createReadStream(options: {input: string | Readable; ytdlpKill?: () => void; cacheKey: string; ffmpegInputOptions?: string[]; cache?: boolean; songLength?: number}): Promise<Readable> {
    return new Promise((resolve, reject) => {
      const capacitor = new WriteStream();

      if (options?.cache) {
        const cacheStream = this.fileCache.createWriteStream(this.getHashForCache(options.cacheKey));
        capacitor.createReadStream().pipe(cacheStream);
      }

      const returnedStream = capacitor.createReadStream();
      let hasReturnedStreamClosed = false;

      const ffmpegInputOptions = options.ffmpegInputOptions ?? [];
      const inputOptions = ffmpegInputOptions.length > 0
        ? ffmpegInputOptions
        : (typeof options.input === 'string' ? ['-re'] : []);

      const ffmpegCmd = ffmpeg(options.input)
        .inputOptions(inputOptions)
        .noVideo()
        .audioCodec('libopus')
        .outputFormat('webm');

      const activeFilters: string[] = [];
      if (this.speed !== 1) {
        activeFilters.push(`atempo=${this.speed}`);
      }

      activeFilters.push(...AUDIO_EFFECT_FILTERS[this.effect]);

      if (this.eq.bass !== 0) {
        activeFilters.push(`equalizer=f=80:t=q:w=1.0:g=${this.eq.bass}`);
      }

      if (this.eq.mid !== 0) {
        activeFilters.push(`equalizer=f=1000:t=q:w=1.0:g=${this.eq.mid}`);
      }

      if (this.eq.treble !== 0) {
        activeFilters.push(`equalizer=f=8000:t=q:w=1.0:g=${this.eq.treble}`);
      }

      // Crossfade: fade-in at start, fade-out near the end of the track.
      // Applied last so it wraps all other processing.
      if (this.crossfade > 0) {
        activeFilters.push(`afade=t=in:st=0:d=${this.crossfade}`);
        const len = options.songLength ?? 0;
        if (len > this.crossfade * 2) {
          activeFilters.push(`afade=t=out:st=${len - this.crossfade}:d=${this.crossfade}`);
        }
      }

      if (activeFilters.length > 0) {
        ffmpegCmd.audioFilters(activeFilters);
      }

      const stream = ffmpegCmd
        .on('error', error => {
          if (!hasReturnedStreamClosed) {
            reject(error);
          }
        })
        .on('start', command => {
          debug(`Spawned ffmpeg with ${command}`);
        });

      stream.pipe(capacitor);

      returnedStream.on('close', () => {
        if (!options.cache) {
          stream.kill('SIGKILL');
          options.ytdlpKill?.();
        }

        hasReturnedStreamClosed = true;
      });

      resolve(returnedStream);
    });
  }

  private createAudioStream(stream: Readable) {
    return createAudioResource(stream, {
      inputType: StreamType.WebmOpus,
      inlineVolume: true,
    });
  }

  /**
   * Audio resource for a live source, tuned for responsiveness over features.
   *
   * inlineVolume makes discord.js demux, decode, apply volume and re-encode,
   * and every stage of that holds audio. Leaving it off lets Opus packets pass
   * through with only demuxing, which is both cheaper and markedly shorter —
   * that length is exactly the delay between pausing in Spotify and the sound
   * actually stopping. Volume is Spotify's job in this mode anyway.
   */
  private createLiveAudioStream(stream: Readable) {
    return createAudioResource(stream, {
      inputType: StreamType.WebmOpus,
      inlineVolume: false,
    });
  }

  private playAudioPlayerResource(resource: AudioResource) {
    if (this.audioPlayer !== null) {
      this.audioResource = resource;
      this.setAudioPlayerVolume();
      this.audioPlayer.play(this.audioResource);
    }
  }

  private setAudioPlayerVolume(level?: number) {
    // Audio resource expects a float between 0 and 1 to represent level percentage
    this.audioResource?.volume?.setVolume((level ?? this.getVolume()) / 100);
  }
}
