import amqp from 'amqplib';
import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { hostname } from 'os';
import { parse as parseUrl } from 'url';
import createIOMonad from './iomonad.js';
import log from '../log.js';
import info from '../info.js';
const logger = log('rabbot.amqp-connection');
function getInitialIndex(limit) {
    const pid = process.pid;
    let index = 0;
    if (pid <= limit) {
        const sha = createHash('sha1');
        sha.update(hostname());
        const buffer = sha.digest();
        index = Math.abs(buffer.readInt32LE()) % limit;
    }
    else {
        index = pid % limit;
    }
    return index;
}
function getOption(opts, key, alt) {
    if (opts.get) {
        try {
            return opts.get(key, alt);
        }
        catch {
            return alt;
        }
    }
    return opts[key] ?? alt;
}
function getUri(protocol, user, pass, server, port, vhost, heartbeat) {
    return `${protocol}${user}:${pass}@${server}:${port}/${vhost}?heartbeat=${heartbeat}`;
}
function parseUri(uri) {
    if (uri) {
        const parsed = parseUrl(uri);
        const authSplit = parsed.auth ? parsed.auth.split(':') : [null, null];
        const qs = parsed.query;
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
function split(x) {
    if (typeof x === 'number') {
        return [x];
    }
    else if (Array.isArray(x)) {
        return x;
    }
    else {
        return x.split(',').map((s) => s.trim());
    }
}
class Adapter {
    name;
    servers;
    ports;
    connectionIndex;
    heartbeat;
    protocol;
    pass;
    user;
    vhost;
    options;
    limit;
    constructor(parameters) {
        if (parameters.uri) {
            Object.assign(parameters, parseUri(parameters.uri));
        }
        const hosts = getOption(parameters, 'host');
        const servers = getOption(parameters, 'server');
        const brokers = getOption(parameters, 'RABBIT_BROKER');
        const serverList = brokers ?? hosts ?? servers ?? 'localhost';
        const portList = (getOption(parameters, 'RABBIT_PORT') ?? getOption(parameters, 'port', 5672));
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
        const certPath = (getOption(parameters, 'RABBIT_CERT') ?? getOption(parameters, 'certPath'));
        const keyPath = (getOption(parameters, 'RABBIT_KEY') ?? getOption(parameters, 'keyPath'));
        const caPaths = (getOption(parameters, 'RABBIT_CA') ?? getOption(parameters, 'caPath'));
        const passphrase = (getOption(parameters, 'RABBIT_PASSPHRASE') ?? getOption(parameters, 'passphrase'));
        const pfxPath = (getOption(parameters, 'RABBIT_PFX') ?? getOption(parameters, 'pfxPath'));
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
        this.options.clientProperties = Object.assign({
            host: info.host(),
            process: info.process(),
            lib: info.lib(),
        }, parameters.clientProperties);
        this.limit = Math.max(this.servers.length, this.ports.length);
    }
    connect() {
        return new Promise((resolve, reject) => {
            const attempted = [];
            const attempt = () => {
                const nextUri = this.getNextUri();
                logger.info("Attempting connection to '%s' (%s)", this.name, nextUri);
                const onConnection = (connection) => {
                    connection.uri = nextUri;
                    logger.info("Connected to '%s' (%s)", this.name, nextUri);
                    resolve(connection);
                };
                const onConnectionError = (err) => {
                    logger.info("Failed to connect to '%s' (%s) with '%s'", this.name, nextUri, err);
                    attempted.push(nextUri);
                    this.bumpIndex();
                    if (attempted.length < this.limit) {
                        attempt();
                    }
                    else {
                        logger.info("Cannot connect to '%s' - all endpoints failed", this.name);
                        reject(new Error('No endpoints could be reached'));
                    }
                };
                if (attempted.indexOf(nextUri) < 0) {
                    const parsed = parseUrl(nextUri);
                    amqp
                        .connect(nextUri, Object.assign({ servername: parsed.hostname }, this.options))
                        .then(onConnection, onConnectionError);
                }
                else {
                    logger.info("Cannot connect to '%s' - all endpoints failed", this.name);
                    reject(new Error('No endpoints could be reached'));
                }
            };
            attempt();
        });
    }
    bumpIndex() {
        if (this.limit - 1 > this.connectionIndex) {
            this.connectionIndex++;
        }
        else {
            this.connectionIndex = 0;
        }
    }
    getNextUri() {
        const server = String(this.getNext(this.servers));
        const port = this.getNext(this.ports);
        return getUri(this.protocol, this.user, encodeURIComponent(this.pass), server, port, this.vhost, this.heartbeat);
    }
    getNext(list) {
        if (this.connectionIndex >= list.length) {
            return list[0];
        }
        return list[this.connectionIndex];
    }
}
// Placeholder target class for prototype proxying
class AmqpConnectionTarget {
    close() { return Promise.resolve(); }
    createChannel() { return Promise.resolve(); }
    createConfirmChannel() { return Promise.resolve(); }
}
export default function createConnection(options) {
    const closeConn = (connection) => {
        connection.close().catch((err) => {
            logger.debug(`Error during close of connection '${options.name}' - '${err}'`);
        });
    };
    const adapter = new Adapter(options);
    return createIOMonad(options, 'connection', adapter.connect.bind(adapter), AmqpConnectionTarget, closeConn);
}
//# sourceMappingURL=connection.js.map