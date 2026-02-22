import { EventEmitter } from 'events';
import { v1 as uuidV1 } from 'uuid';
import connectionFn from './connectionFsm.js';
import topologyFn from './topology.js';
import { dispatch, responses } from './amqp/queue.js';
import { AckBatch } from './ackBatch.js';
import log from './log.js';
import type { Topology } from './topology.js';

type ChannelLike = Record<string, unknown>;

const DEFAULT = 'default';

interface UnhandledStrategies {
  nackOnUnhandled: (message: unknown) => void;
  rejectOnUnhandled: (message: unknown) => void;
  customOnUnhandled: (message: unknown) => void;
  onUnhandled: (message: unknown) => void;
}

interface ReturnedStrategies {
  customOnReturned: (message?: unknown) => void;
  onReturned: (message: unknown) => void;
}

interface MessageLike {
  nack: () => void;
  reject: () => void;
  [key: string]: unknown;
}

interface Serializer {
  serialize: (body: unknown) => Buffer;
  deserialize: (bytes: Buffer, encoding?: string) => unknown;
}

const unhandledStrategies: UnhandledStrategies = {
  nackOnUnhandled(message: unknown) {
    (message as MessageLike).nack();
  },
  rejectOnUnhandled(message: unknown) {
    (message as MessageLike).reject();
  },
  customOnUnhandled(_message: unknown) {},
  onUnhandled(message: unknown) {
    unhandledStrategies.nackOnUnhandled(message);
  }
};

const returnedStrategies: ReturnedStrategies = {
  customOnReturned() {},
  onReturned(message: unknown) {
    returnedStrategies.customOnReturned(message);
  }
};

const serializers: Record<string, Serializer> = {
  'application/json': {
    deserialize: (bytes: Buffer, encoding?: string) => {
      return JSON.parse(bytes.toString((encoding || 'utf8') as BufferEncoding));
    },
    serialize: (object: unknown) => {
      const json = (typeof object === 'string')
        ? object
        : JSON.stringify(object);
      return Buffer.from(json, 'utf8');
    }
  },
  'application/octet-stream': {
    deserialize: (bytes: Buffer) => {
      return bytes;
    },
    serialize: (bytes: unknown) => {
      if (Buffer.isBuffer(bytes)) {
        return bytes as Buffer;
      } else if (Array.isArray(bytes)) {
        return Buffer.from(bytes);
      } else {
        throw new Error('Cannot serialize unknown data type');
      }
    }
  },
  'text/plain': {
    deserialize: (bytes: Buffer, encoding?: string) => {
      return bytes.toString((encoding || 'utf8') as BufferEncoding);
    },
    serialize: (string: unknown) => {
      return Buffer.from(string as string, 'utf8');
    }
  }
};

interface ConnectionOptions {
  name?: string;
  retryLimit?: number;
  failAfter?: number;
  publishTimeout?: number;
  replyTimeout?: number;
  [key: string]: unknown;
}

interface PublishOptions {
  appId?: string;
  type?: string;
  body?: unknown;
  routingKey?: string;
  correlationId?: string;
  sequenceNo?: string | number;
  timestamp?: number;
  headers?: Record<string, unknown>;
  connectionName?: string;
  timeout?: number;
  connectionPublishTimeout?: number;
  messageId?: string;
  replyTimeout?: number;
  expect?: number;
  exchange?: string;
  [key: string]: unknown;
}

interface HandleOptions {
  type?: string;
  queue?: string;
  context?: unknown;
  autoNack?: boolean;
  handler?: (message: MessageLike) => void;
  [key: string]: unknown;
}

interface TopologyWithExtras extends Topology {
  promise?: Promise<Topology>;
  promises: Record<string, Promise<unknown> | undefined>;
  options: ConnectionOptions;
}

class Broker extends EventEmitter {
  connections: Record<string, TopologyWithExtras> = {};
  hasHandles = false;
  autoNack = false;
  serializers = serializers;
  configurations: Record<string, unknown> = {};
  configuring: Record<string, Promise<void> | undefined> = {};
  log = log;
  appId?: string;
  ackIntervalId?: ReturnType<typeof setInterval>;

  addConnection(opts?: ConnectionOptions): Promise<TopologyWithExtras> {
    const options: ConnectionOptions = Object.assign({}, {
      name: DEFAULT,
      retryLimit: 3,
      failAfter: 60
    }, opts);
    const name = options.name!;

    const connectionPromise = new Promise<TopologyWithExtras>((resolve, reject) => {
      if (!this.connections[name]) {
        const connection = connectionFn(options) as {
          on: (event: string, fn: (data?: unknown) => void) => { off: () => void };
          name: string;
          connect: () => Promise<void>;
          close: (reset?: boolean) => Promise<void>;
        };
        const topology = topologyFn(
          connection as unknown as Parameters<typeof topologyFn>[0],
          options,
          serializers,
          unhandledStrategies,
          returnedStrategies
        ) as unknown as TopologyWithExtras;

        connection.on('connected', () => {
          this.emit('connected', connection);
          this.emit(connection.name + '.connection.opened', connection);
          this.setAckInterval(500);
          resolve(topology);
        });

        connection.on('closed', () => {
          this.emit('closed', connection);
          this.emit(connection.name + '.connection.closed', connection);
          reject(new Error('connection closed'));
        });

        connection.on('failed', (err: unknown) => {
          this.emit('failed', connection);
          this.emit(name + '.connection.failed', err);
          reject(err as Error);
        });

        connection.on('unreachable', () => {
          this.emit('unreachable', connection);
          this.emit(name + '.connection.unreachable');
          this.clearAckInterval();
          reject(new Error('connection unreachable'));
        });

        connection.on('return', (raw: unknown) => {
          this.emit('return', raw);
        });

        this.connections[name] = topology;
      } else {
        const existing = this.connections[name];
        existing.connection.connect();
        resolve(existing);
      }
    });

    if (this.connections[name] && !this.connections[name].promise) {
      this.connections[name].promise = connectionPromise;
    }
    return connectionPromise;
  }

  addExchange(name: string | HandleOptions, type?: string, options: HandleOptions = {}, connectionName = DEFAULT): Promise<unknown> {
    if (typeof name === 'object') {
      options = name as HandleOptions;
      options.connectionName = (options.connectionName || type || connectionName) as string;
    } else {
      options.name = name;
      options.type = type;
      options.connectionName = options.connectionName || connectionName;
    }
    return this.connections[options.connectionName as string].createExchange(options as Parameters<Topology['createExchange']>[0]);
  }

  addQueue(name: string, options: HandleOptions = {}, connectionName = DEFAULT): Promise<unknown> {
    options.name = name;
    if (options.subscribe && !this.hasHandles) {
      console.warn("Subscription to '" + name + "' was started without any handlers. This will result in lost messages!");
    }
    return this.connections[connectionName].createQueue(options as Parameters<Topology['createQueue']>[0]);
  }

  addSerializer(contentType: string, serializer: Serializer): void {
    serializers[contentType] = serializer;
  }

  batchAck(): void {
    AckBatch.triggerSignal();
  }

  bindExchange(source: string, target: string, keys: string | string[], connectionName = DEFAULT): Promise<unknown> {
    return this.connections[connectionName].createBinding({ source, target, keys });
  }

  bindQueue(source: string, target: string, keys: string | string[], connectionName = DEFAULT): Promise<unknown> {
    return this.connections[connectionName].createBinding({ source, target, keys, queue: true });
  }

  bulkPublish(set: PublishOptions[] | Record<string, PublishOptions[]>, connectionName = DEFAULT): Promise<unknown> {
    if ((set as PublishOptions & { connectionName?: string }).connectionName) {
      connectionName = (set as PublishOptions & { connectionName: string }).connectionName;
    }
    if (!this.connections[connectionName]) {
      return Promise.reject(new Error(`BulkPublish failed - no connection ${connectionName} has been configured`));
    }

    const publish = (exchange: ChannelLike, options: PublishOptions): Promise<unknown> => {
      options.appId = options.appId || this.appId;
      options.timestamp = options.timestamp || Date.now();
      if (this.connections[connectionName]?.options.publishTimeout) {
        options.connectionPublishTimeout = this.connections[connectionName].options.publishTimeout;
      }
      if (typeof options.body === 'number') {
        options.body = (options.body as number).toString();
      }
      return (exchange as unknown as { publish: (opts: unknown) => Promise<unknown> }).publish(options)
        .then(
          () => options,
          (err: unknown) => ({ err, message: options })
        );
    };

    let exchangeNames: string[];
    if (Array.isArray(set)) {
      exchangeNames = set.reduce<string[]>((acc, m) => {
        if (m.exchange && acc.indexOf(m.exchange) < 0) {
          acc.push(m.exchange);
        }
        return acc;
      }, []);
    } else {
      exchangeNames = Object.keys(set as Record<string, unknown>);
    }

    return this.onExchanges(exchangeNames, connectionName)
      .then((exchanges: Record<string, ChannelLike>) => {
        if (!Array.isArray(set)) {
          const keys = Object.keys(set as Record<string, PublishOptions[]>);
          return Promise.all(keys.map((exchangeName) =>
            Promise.all(((set as Record<string, PublishOptions[]>)[exchangeName]).map((message) => {
              const exchange = exchanges[exchangeName];
              if (exchange) {
                return publish(exchange, message);
              } else {
                return Promise.reject(new Error(`Publish failed - no exchange ${exchangeName} on connection ${connectionName} is defined`));
              }
            }))
          ));
        } else {
          return Promise.all((set as PublishOptions[]).map((message) => {
            const exchange = exchanges[message.exchange!];
            if (exchange) {
              return publish(exchange, message);
            } else {
              return Promise.reject(new Error(`Publish failed - no exchange ${message.exchange} on connection ${connectionName} is defined`));
            }
          }));
        }
      });
  }

  clearAckInterval(): void {
    if (this.ackIntervalId) {
      clearInterval(this.ackIntervalId);
      this.ackIntervalId = undefined;
    }
  }

  closeAll(reset = false): Promise<unknown> {
    const connectionNames = Object.keys(this.connections);
    const closers = connectionNames.map((name) => this.close(name, reset));
    return Promise.all(closers);
  }

  close(connectionName = DEFAULT, reset = false): Promise<unknown> {
    const conn = this.connections[connectionName];
    if (!conn) return Promise.resolve(true);
    const connection = conn.connection;
    if (connection !== undefined && connection !== null) {
      if (reset) {
        conn.reset();
      }
      delete this.configuring[connectionName];
      return connection.close(reset);
    } else {
      return Promise.resolve(true);
    }
  }

  deleteExchange(name: string, connectionName = DEFAULT): Promise<unknown> {
    return this.connections[connectionName].deleteExchange(name);
  }

  deleteQueue(name: string, connectionName = DEFAULT): Promise<unknown> {
    return this.connections[connectionName].deleteQueue(name);
  }

  getExchange(name: string, connectionName = DEFAULT): ChannelLike | undefined {
    return this.connections[connectionName]?.channels[`exchange:${name}`];
  }

  getQueue(name: string, connectionName = DEFAULT): ChannelLike | undefined {
    return this.connections[connectionName]?.channels[`queue:${name}`];
  }

  handle(messageType: string | HandleOptions, handler?: (message: MessageLike) => void, queueName?: string, context?: unknown): { off: () => void } {
    this.hasHandles = true;
    let options: HandleOptions;
    if (typeof messageType === 'string') {
      options = {
        type: messageType,
        queue: queueName || '*',
        context: context,
        autoNack: this.autoNack,
        handler: handler
      };
    } else {
      options = messageType;
      options.autoNack = options.autoNack !== false;
      options.queue = options.queue || (options.type ? '*' : '#');
      options.handler = options.handler || handler;
    }

    const parts: string[] = [];
    if (options.queue === '#') {
      parts.push('#');
    } else {
      parts.push((options.queue || '').replace(/[.]/g, '-'));
      if (options.type !== '') {
        parts.push(options.type || '#');
      }
    }

    const target = parts.join('.');
    const boundHandler = options.handler!.bind(options.context);
    const subscription = dispatch.on(target, (raw: unknown) => {
      try {
        boundHandler(raw as MessageLike);
      } catch (err) {
        if (options.autoNack) {
          console.log("Handler for '" + target + "' failed with:", (err as Error).stack);
          (raw as MessageLike).nack();
        }
      }
    });
    return subscription;
  }

  ignoreHandlerErrors(): void {
    this.autoNack = false;
  }

  nackOnError(): void {
    this.autoNack = true;
  }

  nackUnhandled(): void {
    unhandledStrategies.onUnhandled = unhandledStrategies.nackOnUnhandled;
  }

  onUnhandled(handler: (message: MessageLike) => void): void {
    const wrapped = (message: unknown) => handler(message as MessageLike);
    unhandledStrategies.onUnhandled = unhandledStrategies.customOnUnhandled = wrapped;
  }

  rejectUnhandled(): void {
    unhandledStrategies.onUnhandled = unhandledStrategies.rejectOnUnhandled;
  }

  onExchange(exchangeName: string, connectionName = DEFAULT): Promise<ChannelLike | undefined> {
    const conn = this.connections[connectionName];
    const promises: Promise<unknown>[] = [];
    if (conn.promise) promises.push(conn.promise);
    const ep = conn.promises[`exchange:${exchangeName}`];
    if (ep) promises.push(ep);
    const cp = this.configuring[connectionName];
    if (cp) promises.push(cp);
    return Promise.all(promises)
      .then(() => this.getExchange(exchangeName, connectionName));
  }

  onExchanges(exchanges: string[], connectionName = DEFAULT): Promise<Record<string, ChannelLike>> {
    const conn = this.connections[connectionName];
    const connectionPromises: Promise<unknown>[] = [];
    if (conn.promise) connectionPromises.push(conn.promise);
    const cp = this.configuring[connectionName];
    if (cp) connectionPromises.push(cp);
    const set: Record<string, ChannelLike> = {};
    return Promise.all(connectionPromises)
      .then(() => {
        const exchangePromises = exchanges.map((exchangeName) => {
          const ep = conn.promises[`exchange:${exchangeName}`];
          return ep
            ? ep.then(() => ({ name: exchangeName, exchange: true }))
            : Promise.resolve({ name: exchangeName, exchange: false });
        });
        return Promise.all(exchangePromises);
      })
      .then((list) => {
        list.forEach((item) => {
          if (item && item.exchange) {
            const exchange = this.getExchange(item.name, connectionName);
            if (exchange) set[item.name] = exchange;
          }
        });
        return set;
      });
  }

  onReturned(handler: (message: unknown) => void): void {
    returnedStrategies.onReturned = returnedStrategies.customOnReturned = handler;
  }

  publish(
    exchangeName: string,
    type: string | PublishOptions,
    message?: unknown,
    routingKey?: string,
    correlationId?: string,
    connectionName = DEFAULT,
    sequenceNo?: string | number
  ): Promise<unknown> {
    const timestamp = Date.now();
    let options: PublishOptions;
    if (typeof type === 'object') {
      options = type;
      connectionName = (message as string) || DEFAULT;
      options = Object.assign({
        appId: this.appId,
        timestamp,
        connectionName
      }, options);
      connectionName = options.connectionName || DEFAULT;
    } else {
      connectionName = connectionName || (message as PublishOptions)?.connectionName || DEFAULT;
      options = {
        appId: this.appId,
        type,
        body: message,
        routingKey,
        correlationId,
        sequenceNo,
        timestamp,
        headers: {},
        connectionName
      };
    }
    if (!this.connections[connectionName]) {
      return Promise.reject(new Error(`Publish failed - no connection ${connectionName} has been configured`));
    }
    if (this.connections[connectionName]?.options.publishTimeout) {
      options.connectionPublishTimeout = this.connections[connectionName].options.publishTimeout;
    }
    if (typeof options.body === 'number') {
      options.body = (options.body as number).toString();
    }

    return this.onExchange(exchangeName, connectionName)
      .then((exchange) => {
        if (exchange) {
          return (exchange as unknown as { publish: (opts: unknown) => Promise<unknown> }).publish(options);
        } else {
          return Promise.reject(new Error(`Publish failed - no exchange ${exchangeName} on connection ${connectionName} is defined`));
        }
      });
  }

  purgeQueue(queueName: string, connectionName = DEFAULT): Promise<unknown> {
    if (!this.connections[connectionName]) {
      return Promise.reject(new Error(`Queue purge failed - no connection ${connectionName} has been configured`));
    }
    const conn = this.connections[connectionName];
    const p = conn.promise || Promise.resolve(conn);
    return p.then(() => {
      const queue = this.getQueue(queueName, connectionName);
      if (queue) {
        return (queue as unknown as { purge: () => Promise<unknown> }).purge();
      } else {
        return Promise.reject(new Error(`Queue purge failed - no queue ${queueName} on connection ${connectionName} is defined`));
      }
    });
  }

  request(exchangeName: string, options: PublishOptions = {}, notify?: (message: unknown) => void, connectionName = DEFAULT): Promise<unknown> {
    const requestId = uuidV1();
    options.messageId = requestId;
    options.connectionName = options.connectionName || connectionName;

    if (!this.connections[options.connectionName]) {
      return Promise.reject(new Error(`Request failed - no connection ${options.connectionName} has been configured`));
    }

    return this.onExchange(exchangeName, options.connectionName)
      .then((exchange) => {
        const conn = this.connections[options.connectionName!];
        const ex = exchange as unknown as { publishTimeout?: number; replyTimeout?: number };
        const publishTimeout = options.timeout || ex?.publishTimeout || conn.options.publishTimeout || 500;
        const replyTimeout = options.replyTimeout || ex?.replyTimeout || conn.options.replyTimeout || (publishTimeout as number * 2);

        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            subscription.off();
            reject(new Error('No reply received within the configured timeout of ' + replyTimeout + ' ms'));
          }, replyTimeout as number);

          const scatter = options.expect;
          let remaining = options.expect;
          const subscription = responses.on(requestId, (message: unknown) => {
            const msg = message as { properties: { headers: Record<string, unknown> } };
            const end = scatter
              ? --remaining! <= 0
              : msg.properties.headers['sequence_end'];
            if (end) {
              clearTimeout(timeout);
              if (!scatter || remaining === 0) {
                resolve(message);
              }
              subscription.off();
            } else if (notify) {
              notify(message);
            }
          });
          this.publish(exchangeName, options);
        });
      });
  }

  reset(): void {
    this.connections = {};
    this.configurations = {};
    this.configuring = {};
  }

  retry(connectionName = DEFAULT): Promise<void> {
    const config = this.configurations[connectionName] as Parameters<typeof this.configure>[0];
    return this.configure(config);
  }

  setAckInterval(interval: number): void {
    if (this.ackIntervalId) {
      this.clearAckInterval();
    }
    this.ackIntervalId = setInterval(() => this.batchAck(), interval);
  }

  shutdown(): Promise<void> {
    return this.closeAll(true)
      .then(() => {
        this.clearAckInterval();
      });
  }

  startSubscription(queueName: string, exclusive: boolean | string = false, connectionName = DEFAULT): Promise<unknown> {
    if (!this.hasHandles) {
      console.warn("Subscription to '" + queueName + "' was started without any handlers. This will result in lost messages!");
    }
    if (typeof exclusive === 'string') {
      connectionName = exclusive;
      exclusive = false;
    }
    const queue = this.getQueue(queueName, connectionName);
    if (queue) {
      return (queue as unknown as { subscribe: (exclusive: boolean) => Promise<unknown> }).subscribe(exclusive as boolean);
    } else {
      throw new Error("No queue named '" + queueName + "' for connection '" + connectionName + "'. Subscription failed.");
    }
  }

  stopSubscription(queueName: string, connectionName = DEFAULT): ChannelLike {
    const queue = this.getQueue(queueName, connectionName);
    if (queue) {
      (queue as unknown as { unsubscribe: () => Promise<unknown> }).unsubscribe();
      return queue;
    } else {
      throw new Error("No queue named '" + queueName + "' for connection '" + connectionName + "'. Unsubscribe failed.");
    }
  }

  unbindExchange(source: string, target: string, keys: string | string[], connectionName = DEFAULT): Promise<unknown> {
    return this.connections[connectionName].removeBinding({ source, target, keys });
  }

  unbindQueue(source: string, target: string, keys: string | string[], connectionName = DEFAULT): Promise<unknown> {
    return this.connections[connectionName].removeBinding({ source, target, keys, queue: true });
  }

  // Declared here for TypeScript; implementation added by configMixin at runtime
  declare configure: (config: unknown) => Promise<void>;
}

// Apply config mixin
import configMixin from './config.js';
configMixin(Broker as unknown as { prototype: Parameters<typeof configMixin>[0]['prototype'] });

const broker = new Broker();

export default broker;
export { Broker };
