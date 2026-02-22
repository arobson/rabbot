import amqp from 'amqplib';
import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { hostname } from 'os';
import { parse as parseUrl } from 'url';
import createIOMonad from './iomonad.js';
import log from '../log.js';
import info from '../info.js';

const logger = log('rabbot.amqp-connection');

interface ConnectionOptions {
  name?: string;
  host?: string;
  server?: string;
  RABBIT_BROKER?: string;
  port?: number | string;
  RABBIT_PORT?: string;
  heartbeat?: number;
  RABBIT_HEARTBEAT?: string;
  protocol?: string;
  RABBIT_PROTOCOL?: string;
  pass?: string;
  RABBIT_PASSWORD?: string;
  user?: string;
  RABBIT_USER?: string;
  vhost?: string;
  RABBIT_VHOST?: string;
  timeout?: number;
  RABBIT_TIMEOUT?: string;
  certPath?: string;
  RABBIT_CERT?: string;
  keyPath?: string;
  RABBIT_KEY?: string;
  caPath?: string;
  RABBIT_CA?: string;
  passphrase?: string;
  RABBIT_PASSPHRASE?: string;
  pfxPath?: string;
  RABBIT_PFX?: string;
  useSSL?: boolean;
  clientProperties?: Record<string, unknown>;
  uri?: string;
  waitMin?: number;
  waitMax?: number;
  waitIncrement?: number;
  get?: (key: string, defaultValue?: unknown) => unknown;
}

function getInitialIndex(limit: number): number {
  const pid = process.pid;
  let index = 0;
  if (pid <= limit) {
    const sha = createHash('sha1');
    sha.update(hostname());
    const buffer = sha.digest();
    index = Math.abs(buffer.readInt32LE()) % limit;
  } else {
    index = pid % limit;
  }
  return index;
}

function getOption(opts: ConnectionOptions, key: string, alt?: unknown): unknown {
  if (opts.get) {
    try {
      return opts.get(key, alt);
    } catch {
      return alt;
    }
  }
  return (opts as Record<string, unknown>)[key] ?? alt;
}

function getUri(protocol: string, user: string, pass: string, server: string, port: string | number, vhost: string, heartbeat: number): string {
  return `${protocol}${user}:${pass}@${server}:${port}/${vhost}?heartbeat=${heartbeat}`;
}

function parseUri(uri: string): Partial<ConnectionOptions> {
  if (uri) {
    const parsed = parseUrl(uri);
    const authSplit = parsed.auth ? parsed.auth.split(':') : [null, null];
    const qs = parsed.query as string;
    const heartbeat = qs ? qs.split('&')[0].split('=')[1] : undefined;
    return {
      useSSL: parsed.protocol === 'amqps:',
      user: authSplit[0] ?? undefined,
      pass: authSplit[1] ?? undefined,
      host: parsed.hostname ?? undefined,
      port: parsed.port ? parseInt(parsed.port) : undefined,
      vhost: parsed.pathname ? parsed.pathname.slice(1) : undefined,
      heartbeat: heartbeat ? parseInt(heartbeat) : undefined,
    };
  }
  return {};
}

function split(x: number | string | string[]): (string | number)[] {
  if (typeof x === 'number') {
    return [x];
  } else if (Array.isArray(x)) {
    return x;
  } else {
    return x.split(',').map((s) => s.trim());
  }
}

class Adapter {
  name: string;
  servers: (string | number)[];
  ports: (string | number)[];
  connectionIndex: number;
  heartbeat: number;
  protocol: string;
  pass: string;
  user: string;
  vhost: string;
  options: Record<string, unknown>;
  limit: number;

  constructor(parameters: ConnectionOptions) {
    if (parameters.uri) {
      Object.assign(parameters, parseUri(parameters.uri));
    }
    const hosts = getOption(parameters, 'host') as string | undefined;
    const servers = getOption(parameters, 'server') as string | undefined;
    const brokers = getOption(parameters, 'RABBIT_BROKER') as string | undefined;
    const serverList = brokers ?? hosts ?? servers ?? 'localhost';
    const portList = (getOption(parameters, 'RABBIT_PORT') ?? getOption(parameters, 'port', 5672)) as number | string;

    this.name = parameters.name ?? 'default';
    this.servers = split(serverList);
    this.connectionIndex = getInitialIndex(this.servers.length);
    this.ports = split(portList);
    this.heartbeat = parseInt(String(getOption(parameters, 'RABBIT_HEARTBEAT') ?? getOption(parameters, 'heartbeat', 30)));
    this.protocol = String(getOption(parameters, 'RABBIT_PROTOCOL') ?? getOption(parameters, 'protocol', 'amqp://'));
    this.pass = String(getOption(parameters, 'RABBIT_PASSWORD') ?? getOption(parameters, 'pass', 'guest'));
    this.user = String(getOption(parameters, 'RABBIT_USER') ?? getOption(parameters, 'user', 'guest'));
    this.vhost = String(getOption(parameters, 'RABBIT_VHOST') ?? getOption(parameters, 'vhost', '%2f'));

    const timeout = getOption(parameters, 'RABBIT_TIMEOUT') ?? getOption(parameters, 'timeout', 2000);
    const certPath = (getOption(parameters, 'RABBIT_CERT') ?? getOption(parameters, 'certPath')) as string | undefined;
    const keyPath = (getOption(parameters, 'RABBIT_KEY') ?? getOption(parameters, 'keyPath')) as string | undefined;
    const caPaths = (getOption(parameters, 'RABBIT_CA') ?? getOption(parameters, 'caPath')) as string | undefined;
    const passphrase = (getOption(parameters, 'RABBIT_PASSPHRASE') ?? getOption(parameters, 'passphrase')) as string | undefined;
    const pfxPath = (getOption(parameters, 'RABBIT_PFX') ?? getOption(parameters, 'pfxPath')) as string | undefined;
    const useSSL = certPath || keyPath || passphrase || caPaths || pfxPath || parameters.useSSL;

    this.options = { noDelay: true };
    if (timeout) {
      this.options.timeout = timeout;
    }
    if (certPath) {
      this.options.cert = existsSync(certPath) ? readFileSync(certPath) : certPath;
    }
    if (keyPath) {
      this.options.key = existsSync(keyPath) ? readFileSync(keyPath) : keyPath;
    }
    if (passphrase) {
      this.options.passphrase = passphrase;
    }
    if (pfxPath) {
      this.options.pfx = existsSync(pfxPath) ? readFileSync(pfxPath) : pfxPath;
    }
    if (caPaths) {
      const list = caPaths.split(',');
      this.options.ca = list.map((caPath) => (existsSync(caPath) ? readFileSync(caPath) : caPath));
    }
    if (useSSL) {
      this.protocol = 'amqps://';
    }
    this.options.clientProperties = Object.assign(
      {
        host: info.host(),
        process: info.process(),
        lib: info.lib(),
      },
      parameters.clientProperties
    );
    this.limit = Math.max(this.servers.length, this.ports.length);
  }

  connect(): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const attempted: string[] = [];
      const attempt = () => {
        const nextUri = this.getNextUri();
        logger.info("Attempting connection to '%s' (%s)", this.name, nextUri);

        const onConnection = (connection: unknown) => {
          (connection as { uri?: string }).uri = nextUri;
          logger.info("Connected to '%s' (%s)", this.name, nextUri);
          resolve(connection);
        };

        const onConnectionError = (err: unknown) => {
          logger.info("Failed to connect to '%s' (%s) with '%s'", this.name, nextUri, err);
          attempted.push(nextUri);
          this.bumpIndex();
          if (attempted.length < this.limit) {
            attempt();
          } else {
            logger.info("Cannot connect to '%s' - all endpoints failed", this.name);
            reject(new Error('No endpoints could be reached'));
          }
        };

        if (attempted.indexOf(nextUri) < 0) {
          const parsed = parseUrl(nextUri);
          amqp
            .connect(nextUri, Object.assign({ servername: parsed.hostname }, this.options))
            .then(onConnection, onConnectionError);
        } else {
          logger.info("Cannot connect to '%s' - all endpoints failed", this.name);
          reject(new Error('No endpoints could be reached'));
        }
      };
      attempt();
    });
  }

  bumpIndex(): void {
    if (this.limit - 1 > this.connectionIndex) {
      this.connectionIndex++;
    } else {
      this.connectionIndex = 0;
    }
  }

  getNextUri(): string {
    const server = String(this.getNext(this.servers));
    const port = this.getNext(this.ports);
    return getUri(this.protocol, this.user, encodeURIComponent(this.pass), server, port, this.vhost, this.heartbeat);
  }

  getNext(list: (string | number)[]): string | number {
    if (this.connectionIndex >= list.length) {
      return list[0];
    }
    return list[this.connectionIndex];
  }
}

// Placeholder target class for prototype proxying
class AmqpConnectionTarget {
  [key: string]: unknown;
  close(): Promise<void> { return Promise.resolve(); }
  createChannel(): Promise<unknown> { return Promise.resolve(); }
  createConfirmChannel(): Promise<unknown> { return Promise.resolve(); }
}

export default function createConnection(options: ConnectionOptions) {
  const closeConn = (connection: unknown) => {
    (connection as { close: () => Promise<void> }).close().catch((err) => {
      logger.debug(`Error during close of connection '${options.name}' - '${err}'`);
    });
  };
  const adapter = new Adapter(options);
  return createIOMonad(
    options as { name: string; waitMin?: number; waitMax?: number; waitIncrement?: number },
    'connection',
    adapter.connect.bind(adapter),
    AmqpConnectionTarget,
    closeConn
  );
}
