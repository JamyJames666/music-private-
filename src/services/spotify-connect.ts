import {spawn, ChildProcessByStdio} from 'child_process';
import {EventEmitter} from 'events';
import {Readable} from 'stream';

// Librespot's pipe backend always emits raw interleaved PCM at CD quality.
// ffmpeg cannot infer any of this from a pipe, so it has to be declared.
export const LIBRESPOT_SAMPLE_RATE = 44_100;
export const LIBRESPOT_CHANNELS = 2;
export const LIBRESPOT_FFMPEG_INPUT_OPTIONS = [
  '-f',
  's16le',
  '-ar',
  LIBRESPOT_SAMPLE_RATE.toString(),
  '-ac',
  LIBRESPOT_CHANNELS.toString(),
];

export interface SpotifyConnectOptions {
  readonly deviceName: string;
  readonly bitrate: 96 | 160 | 320;
  readonly cacheDir?: string;
  readonly initialVolume: number;
}

export const getExecutable = () => process.env.LIBRESPOT_PATH?.trim() ?? 'librespot';

export const isSpotifyConnectEnabled = () => process.env.SPOTIFY_CONNECT_ENABLED === 'true';

export const getSpotifyConnectOptions = (): SpotifyConnectOptions => ({
  deviceName: process.env.SPOTIFY_CONNECT_DEVICE_NAME?.trim() ?? 'Muse',
  bitrate: (Number(process.env.SPOTIFY_CONNECT_BITRATE) === 96 || Number(process.env.SPOTIFY_CONNECT_BITRATE) === 160
    ? Number(process.env.SPOTIFY_CONNECT_BITRATE)
    : 320) as 96 | 160 | 320,
  cacheDir: process.env.SPOTIFY_CONNECT_CACHE_DIR?.trim() ?? (process.env.DATA_DIR ? `${process.env.DATA_DIR}/librespot` : undefined),
  initialVolume: 100,
});

/**
 * Runs librespot as a Spotify Connect endpoint and exposes its audio as a stream.
 *
 * Spotify drives playback here — the bot is a speaker, not a queue. Nothing in
 * this class knows about tracks; it only owns the process and its PCM output.
 */
export default class SpotifyConnect extends EventEmitter {
  private process: ChildProcessByStdio<null, Readable, Readable> | null = null;
  private stopping = false;

  get isRunning(): boolean {
    return this.process !== null;
  }

  /**
   * Starts librespot and returns its raw PCM output.
   *
   * The stream stays open for the lifetime of the process: Spotify pausing or
   * changing track does not end it, it just stops producing data. That is what
   * lets the bot hold the voice connection open across track changes.
   */
  start(options: SpotifyConnectOptions): Readable {
    if (this.process) {
      throw new Error('Spotify Connect is already running.');
    }

    const args = [
      '--name',
      options.deviceName,
      '--bitrate',
      options.bitrate.toString(),
      '--backend',
      'pipe',
      '--format',
      'S16',
      '--initial-volume',
      options.initialVolume.toString(),
      // Volume is handled downstream by Discord, so keep librespot linear and
      // let the audio resource own attenuation.
      '--volume-ctrl',
      'fixed',
    ];

    if (options.cacheDir) {
      // Caching credentials is what allows reconnecting without re-running the
      // OAuth flow; audio caching is pointless for a pass-through device.
      args.push('--cache', options.cacheDir, '--disable-audio-cache');
    }

    if (process.env.SPOTIFY_CONNECT_ENABLE_OAUTH === 'true') {
      args.push('--enable-oauth');
    }

    const child = spawn(getExecutable(), args, {stdio: ['ignore', 'pipe', 'pipe']});
    this.process = child;
    this.stopping = false;

    child.stderr.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) {
        // Librespot reports the OAuth URL and connection state on stderr, so
        // this is the only place a first-time setup link will appear.
        this.emit('log', line);
      }
    });

    child.on('exit', (code, signal) => {
      this.process = null;
      if (!this.stopping) {
        this.emit('exit', code, signal);
      }
    });

    child.on('error', (error: Error) => {
      this.process = null;
      this.emit('error', error);
    });

    return child.stdout;
  }

  stop(): void {
    if (!this.process) {
      return;
    }

    this.stopping = true;
    this.process.kill('SIGTERM');
    this.process = null;
  }
}
