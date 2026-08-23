import {spawn, ChildProcessByStdio} from 'child_process';
import {EventEmitter} from 'events';
import {Readable} from 'stream';
import {promises as fs} from 'fs';
import http from 'http';
import path from 'path';

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
  readonly oauthPort: number;
}

// Librespot's OAuth redirect lands on 127.0.0.1 relative to librespot itself,
// which on a remote host means the callback has to be tunnelled back to the
// browser doing the sign-in. Keeping the port fixed and configurable is what
// makes that tunnel possible.
export const DEFAULT_OAUTH_PORT = 5588;

export const getExecutable = () => process.env.LIBRESPOT_PATH?.trim() ?? 'librespot';

// Sign-in is done by a throwaway process rather than the streaming one, because
// librespot prints the auth URL to stdout — the same stdout the pipe backend
// fills with raw audio. Sharing them means the URL is swallowed into ffmpeg and
// never seen. Once this process caches credentials, playback starts normally
// and never needs the OAuth flow again.
const AUTH_URL_PREFIX = 'Browse to: ';

export const getCredentialsPath = (cacheDir: string) => path.join(cacheDir, 'credentials.json');

// Each linked Spotify account gets its own credential cache, so several people
// can stay signed in and hand control between them without repeating the
// sign-in. Only one can drive playback at a time — there is a single voice
// connection — so switching stops the current one and starts theirs.
const getBaseCacheDir = () => process.env.SPOTIFY_CONNECT_CACHE_DIR?.trim()
  ?? (process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'librespot') : path.join(process.cwd(), 'data', 'librespot'));

export const getAccountsDir = () => path.join(getBaseCacheDir(), 'accounts');

// Sign-in happens here because librespot picks the account itself; only once it
// reports who logged in can the cache be filed under a name.
export const getPendingAccountDir = () => path.join(getBaseCacheDir(), 'pending');

// Account names come from Spotify and end up as directory names, so keep them
// to something that cannot escape the accounts directory.
const sanitizeAccountName = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_').slice(0, 64);

export const getAccountCacheDir = (account: string) => path.join(getAccountsDir(), sanitizeAccountName(account));

export const listSpotifyAccounts = async (): Promise<string[]> => {
  try {
    const entries = await fs.readdir(getAccountsDir(), {withFileTypes: true});
    const accounts = await Promise.all(entries
      .filter(entry => entry.isDirectory())
      .map(async entry => (await hasCachedCredentials(path.join(getAccountsDir(), entry.name))) ? entry.name : null));

    return accounts.filter((name): name is string => name !== null).sort();
  } catch {
    return [];
  }
};

/**
 * Files a freshly signed-in credential cache under the account that owns it.
 */
export const promotePendingAccount = async (username: string): Promise<string> => {
  const account = sanitizeAccountName(username);
  const target = getAccountCacheDir(account);

  await fs.mkdir(getAccountsDir(), {recursive: true});
  await fs.rm(target, {recursive: true, force: true});
  await fs.rename(getPendingAccountDir(), target);

  return account;
};

export const removeSpotifyAccount = async (account: string): Promise<void> => {
  await fs.rm(getAccountCacheDir(account), {recursive: true, force: true});
};

export const hasCachedCredentials = async (cacheDir?: string): Promise<boolean> => {
  if (!cacheDir) {
    return false;
  }

  try {
    await fs.access(getCredentialsPath(cacheDir));
    return true;
  } catch {
    return false;
  }
};

/**
 * Hands a sign-in code to librespot's OAuth server.
 *
 * Spotify only ever redirects to 127.0.0.1, which is meaningless in the
 * browser doing the sign-in when the bot runs on a remote host. Because this
 * runs inside the same container as librespot, it can complete the redirect
 * that the browser could not.
 */
export const deliverOAuthCode = async (rawUrlOrCode: string, oauthPort: number): Promise<void> => {
  const query = buildOAuthQuery(rawUrlOrCode);

  return new Promise((resolve, reject) => {
    const request = http.get({
      host: '127.0.0.1',
      port: oauthPort,
      path: `/login${query}`,
      timeout: 10_000,
    }, response => {
      response.resume();
      if (response.statusCode && response.statusCode >= 400) {
        reject(new Error(`librespot rejected the sign-in code (HTTP ${response.statusCode}).`));
        return;
      }

      resolve();
    });

    request.on('timeout', () => {
      request.destroy();
      reject(new Error('librespot did not respond — is Spotify Connect still starting?'));
    });

    request.on('error', () => {
      reject(new Error('Could not reach librespot. Turn Spotify Connect on and try again.'));
    });
  });
};

// Accepts either the whole redirected URL or a bare code, since people
// reasonably paste either.
const buildOAuthQuery = (rawUrlOrCode: string): string => {
  const trimmed = rawUrlOrCode.trim();

  const queryIndex = trimmed.indexOf('?');
  if (queryIndex !== -1) {
    return trimmed.slice(queryIndex);
  }

  return `?code=${encodeURIComponent(trimmed)}`;
};

export const isSpotifyConnectEnabled = () => process.env.SPOTIFY_CONNECT_ENABLED === 'true';

/**
 * @param account which linked Spotify account to use; omit for the sign-in
 *   flow, which does not yet know who is logging in.
 */
export const getSpotifyConnectOptions = (account?: string): SpotifyConnectOptions => ({
  deviceName: process.env.SPOTIFY_CONNECT_DEVICE_NAME?.trim() ?? 'Muse',
  bitrate: (Number(process.env.SPOTIFY_CONNECT_BITRATE) === 96 || Number(process.env.SPOTIFY_CONNECT_BITRATE) === 160
    ? Number(process.env.SPOTIFY_CONNECT_BITRATE)
    : 320) as 96 | 160 | 320,
  cacheDir: account ? getAccountCacheDir(account) : getPendingAccountDir(),
  initialVolume: 100,
  oauthPort: Number(process.env.SPOTIFY_CONNECT_OAUTH_PORT) || DEFAULT_OAUTH_PORT,
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

    // Deliberately no --enable-oauth here. This process's stdout is the audio
    // pipe, and librespot prints the sign-in URL to stdout — enabling OAuth
    // would inject that text into the PCM stream. SpotifyConnectAuth handles
    // sign-in separately and caches credentials for this process to reuse.

    const child = spawn(getExecutable(), args, {stdio: ['ignore', 'pipe', 'pipe']});
    this.process = child;
    this.stopping = false;

    child.stderr.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) {
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

/**
 * Runs librespot purely to obtain and cache credentials.
 *
 * Emits 'auth-url' with the link the user has to visit, then 'authenticated'
 * once credentials land on disk. Deliberately separate from the streaming
 * process: here stdout carries text, there it carries audio.
 */
export class SpotifyConnectAuth extends EventEmitter {
  private process: ChildProcessByStdio<null, Readable, Readable> | null = null;

  get isRunning(): boolean {
    return this.process !== null;
  }

  start(options: SpotifyConnectOptions): void {
    if (this.process) {
      return;
    }

    const args = [
      '--name',
      options.deviceName,
      '--backend',
      'pipe',
      '--enable-oauth',
      '--oauth-port',
      options.oauthPort.toString(),
    ];

    if (options.cacheDir) {
      args.push('--cache', options.cacheDir, '--disable-audio-cache');
    }

    const child = spawn(getExecutable(), args, {stdio: ['ignore', 'pipe', 'pipe']});
    this.process = child;

    child.stdout.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        const index = line.indexOf(AUTH_URL_PREFIX);
        if (index !== -1) {
          this.emit('auth-url', line.slice(index + AUTH_URL_PREFIX.length).trim());
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) {
        this.emit('log', line);
      }

      // Librespot announces which account signed in once the code has been
      // accepted; that name is what the credential cache gets filed under.
      const authenticated = /Authenticated as '([^']+)'/.exec(line);
      if (authenticated) {
        this.emit('authenticated', authenticated[1]);
      }
    });

    child.on('exit', () => {
      this.process = null;
    });

    child.on('error', (error: Error) => {
      this.process = null;
      this.emit('error', error);
    });
  }

  stop(): void {
    if (!this.process) {
      return;
    }

    this.process.kill('SIGTERM');
    this.process = null;
  }
}
