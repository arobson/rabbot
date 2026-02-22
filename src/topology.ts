import { EventEmitter } from 'events';
import log from './log.js';
import info from './info.js';
import ExchangeFsm from './exchangeFsm.js';
import QueueFsm from './queueFsm.js';
type ChannelLike = Record<string, unknown> & {
  once: (event: string, fn: (data?: unknown) => void) => void;
  on: (event: string, fn: (data?: unknown) => void) => { off: () => void };
};

const logger = log('rabbot.topology');

const DIRECT_REPLY_TO = 'amq.rabbitmq.reply-to';
const noop = () => {};

interface BindingDef {
  exchange?: string;
  source?: string;
  target: string;
  queueAlias?: string;
  keys?: string | string[];
  queue?: boolean;
  uniqueName?: string;
}

interface QueueDef {
  name: string;
  unique?: string;
  uniqueName?: string;
  [key: string]: unknown;
}

interface ExchangeDef {
  name: string;
  [key: string]: unknown;
}

interface TopologyOptions {
  name?: string;
  replyQueue?: string | { name: string | false; autoDelete?: boolean; subscribe?: boolean; noAck?: boolean } | false;
  publishTimeout?: number;
  [key: string]: unknown;
}

interface Serializer {
  serialize: (body: unknown) => Buffer;
  deserialize: (bytes: Buffer, encoding?: string) => unknown;
}

interface UnhandledStrategies {
  onUnhandled: (message: unknown) => void;
}

interface ReturnedStrategies {
  onReturned: (message: unknown) => void;
}

interface Connection {
  name: string;
  state?: string;
  currentState?: string;
  getChannel: (name: string, confirm: boolean, context: string) => Promise<{
    bindQueue: (target: string, source: string, key: string) => Promise<unknown>;
    unbindQueue: (target: string, source: string, key: string) => Promise<unknown>;
    bindExchange: (target: string, source: string, key: string) => Promise<unknown>;
    unbindExchange: (target: string, source: string, key: string) => Promise<unknown>;
    deleteExchange: (name: string) => Promise<unknown>;
    deleteQueue: (name: string) => Promise<unknown>;
  }>;
  on: (event: string, fn: (data?: unknown) => void) => { off: () => void };
  lastError?: () => unknown;
  addExchange: (exchange: unknown) => void;
  addQueue: (queue: unknown) => void;
  connect: () => Promise<void>;
  close: (reset?: boolean) => Promise<void>;
}

function getKeys(keys?: string | string[]): string[] {
  if (keys && (Array.isArray(keys) ? keys.length > 0 : true)) {
    return Array.isArray(keys) ? keys : [keys];
  }
  return [''];
}

function isUndefined(value: unknown): boolean {
  return value === null || value === undefined;
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

function isObject(value: unknown): boolean {
  return typeof value === 'object';
}

function has(obj: Record<string, unknown>, property: string): boolean {
  return obj && obj[property] != null;
}

function toArray(x: unknown, list?: boolean): unknown[] {
  if (Array.isArray(x)) {
    return x;
  }
  if (isObject(x) && list) {
    const keys = Object.keys(x as Record<string, unknown>);
    return keys.map((key) => (x as Record<string, unknown>)[key]);
  }
  if (x === null || x === undefined || x === '') {
    return [];
  }
  return [x];
}

class Topology extends EventEmitter {
  name: string;
  connection: Connection;
  channels: Record<string, ChannelLike>;
  promises: Record<string, Promise<unknown> | undefined>;
  definitions: {
    bindings: Record<string, BindingDef>;
    exchanges: Record<string, ExchangeDef>;
    queues: Record<string, QueueDef>;
  };
  options: TopologyOptions;
  replyQueue: { name: string | false; autoDelete?: boolean; subscribe?: boolean; noAck?: boolean };
  serializers: Record<string, Serializer>;
  onUnhandled: (message: unknown) => void;
  onReturned: (message: unknown) => void;

  constructor(
    connection: Connection,
    options: TopologyOptions,
    serializers: Record<string, Serializer>,
    unhandledStrategies: UnhandledStrategies,
    returnedStrategies: ReturnedStrategies,
    private readonly Exchange: typeof ExchangeFsm,
    private readonly Queue: typeof QueueFsm,
    private readonly replyId: string
  ) {
    super();
    const autoReplyTo = { name: `${replyId}.response.queue`, autoDelete: true, subscribe: true };
    const rabbitReplyTo = { name: 'amq.rabbitmq.reply-to', subscribe: true, noAck: true };
    const userReplyTo = isObject(options.replyQueue)
      ? (options.replyQueue as { name: string | false; autoDelete?: boolean; subscribe?: boolean })
      : { name: options.replyQueue as string, autoDelete: true, subscribe: true };

    this.name = options.name || 'default';
    this.connection = connection;
    this.channels = {};
    this.promises = {};
    this.definitions = {
      bindings: {},
      exchanges: {},
      queues: {}
    };
    this.options = options;
    this.replyQueue = { name: false };
    this.serializers = serializers;
    this.onUnhandled = (message) => unhandledStrategies.onUnhandled(message);
    this.onReturned = (message) => returnedStrategies.onReturned(message);

    let replyQueueName: string | false = '';

    if (has(options as Record<string, unknown>, 'replyQueue')) {
      const rq = options.replyQueue;
      replyQueueName = (rq && isObject(rq) ? (rq as { name: string | false }).name : rq) as string | false;
      if (replyQueueName === false) {
        this.replyQueue = { name: false };
      } else if (replyQueueName) {
        this.replyQueue = userReplyTo as typeof this.replyQueue;
      } else if (/^rabbit(mq)?$/i.test(replyQueueName as string) || replyQueueName === undefined) {
        this.replyQueue = rabbitReplyTo;
      }
    } else {
      this.replyQueue = autoReplyTo;
    }

    connection.on('reconnected', () => this.onReconnect());
    connection.on('return', (raw: unknown) => this.handleReturned(raw));

    this.createDefaultExchange().catch(noop);
    process.nextTick(() => {
      this.createReplyQueue().catch((err: unknown) => this.onReplyQueueFailed(err));
    });
  }

  completeRebuild(): Promise<void> {
    return this.configureBindings(this.definitions.bindings, true)
      .then(() => {
        logger.info("Topology rebuilt for connection '%s'", this.connection.name);
        this.emit('bindings.completed', this.definitions);
        this.emit(this.connection.name + '.connection.configured', this.connection);
      });
  }

  configureBindings(bindingDef: unknown, list?: boolean): Promise<unknown> {
    if (isUndefined(bindingDef)) {
      return Promise.resolve(true);
    } else {
      const actualDefinitions = toArray(bindingDef, list) as BindingDef[];
      const bindings = actualDefinitions.map((def) => {
        const q = this.definitions.queues[def.queueAlias ? def.queueAlias : def.target];
        return this.createBinding({
          source: def.exchange || def.source || '',
          target: q ? q.uniqueName || def.target : def.target,
          keys: def.keys,
          queue: q !== undefined,
          queueAlias: q ? q.name : undefined
        });
      });
      if (bindings.length === 0) {
        return Promise.resolve(true);
      } else {
        return Promise.all(bindings);
      }
    }
  }

  configureQueues(queueDef: unknown, list?: boolean): Promise<unknown> {
    if (isUndefined(queueDef)) {
      return Promise.resolve(true);
    } else {
      const actualDefinitions = toArray(queueDef, list) as QueueDef[];
      const queues = actualDefinitions.map((def) => this.createQueue(def));
      return Promise.all(queues);
    }
  }

  configureExchanges(exchangeDef: unknown, list?: boolean): Promise<unknown> {
    if (isUndefined(exchangeDef)) {
      return Promise.resolve(true);
    } else {
      const actualDefinitions = toArray(exchangeDef, list) as ExchangeDef[];
      const exchanges = actualDefinitions.map((def) => this.createExchange(def));
      return Promise.all(exchanges);
    }
  }

  createBinding(options: BindingDef & { source: string }): Promise<unknown> {
    let id = `${options.source}->${options.target}`;
    const keys = getKeys(options.keys);
    if (keys[0] !== '') {
      id += ':' + keys.join(':');
    }
    let promise = this.promises[id];
    if (!promise) {
      this.definitions.bindings[id] = options;
      const call = options.queue ? 'bindQueue' : 'bindExchange';
      const source = options.source;
      let target = options.target;
      if (options.queue) {
        const queue = this.definitions.queues[options.target];
        if (queue && queue.uniqueName) {
          target = queue.uniqueName;
        }
      }
      this.promises[id] = promise = this.connection.getChannel('control', false, 'control channel for bindings')
        .then((channel) => {
          logger.info("Binding %s '%s' to '%s' on '%s' with keys: %s",
            (options.queue ? 'queue' : 'exchange'), target, source, this.connection.name, JSON.stringify(keys));
          return Promise.all(
            keys.map((key) => (channel as Record<string, (a: string, b: string, c: string) => Promise<unknown>>)[call](target, source, key))
          );
        });
    }
    return promise;
  }

  createPrimitive(
    Primitive: typeof ExchangeFsm | typeof QueueFsm,
    primitiveType: string,
    options: ExchangeDef | QueueDef
  ): Promise<ChannelLike> {
    const errorFn = (err: unknown) =>
      new Error('Failed to create ' + primitiveType + " '" + options.name +
        "' on connection '" + this.connection.name +
        "' with '" + (err ? ((err as Error).stack || err) : 'N/A') + "'");

    const definitions = primitiveType === 'exchange' ? this.definitions.exchanges : this.definitions.queues;
    const channelName = `${primitiveType}:${options.name}`;
    let promise = this.promises[channelName] as Promise<ChannelLike> | undefined;
    if (!promise) {
      this.promises[channelName] = promise = new Promise<ChannelLike>((resolve, reject) => {
        (definitions as Record<string, unknown>)[options.name] = options;
        const primitive: ChannelLike = this.channels[channelName] = (Primitive as unknown as (...args: unknown[]) => ChannelLike)(
          options,
          this.connection,
          this,
          this.serializers
        );

        const onConnectionFailed = (connectionError: unknown) => {
          reject(errorFn(connectionError));
        };

        const connState = this.connection.currentState || this.connection.state;
        if (connState === 'failed') {
          onConnectionFailed(this.connection.lastError?.());
        } else {
          const onFailed = this.connection.on('failed', (err: unknown) => {
            onConnectionFailed(err);
          });
          primitive.once('defined', () => {
            onFailed.off();
            resolve(primitive);
          });
        }

        primitive.once('failed', (err: unknown) => {
          delete (definitions as Record<string, unknown>)[options.name];
          delete this.channels[channelName];
          delete this.promises[channelName];
          reject(errorFn(err));
        });
      });
    }
    return promise;
  }

  createDefaultExchange(): Promise<ChannelLike> {
    return this.createExchange({ name: '', passive: true });
  }

  createExchange(options: ExchangeDef): Promise<ChannelLike> {
    return this.createPrimitive(this.Exchange, 'exchange', options);
  }

  createQueue(options: QueueDef): Promise<ChannelLike> {
    options.uniqueName = this.getUniqueName(options);
    return this.createPrimitive(this.Queue as unknown as typeof ExchangeFsm, 'queue', options);
  }

  createReplyQueue(): Promise<unknown> {
    if (this.replyQueue.name === false) {
      return Promise.resolve();
    }
    const key = 'queue:' + this.replyQueue.name;
    let promise: Promise<unknown>;
    if (!this.channels[key]) {
      promise = this.createQueue(this.replyQueue as QueueDef);
      promise.then(
        (channel: unknown) => {
          this.channels[key] = channel as ChannelLike;
          this.emit('replyQueue.ready', this.replyQueue);
        },
        (err: unknown) => this.onReplyQueueFailed(err)
      );
    } else {
      promise = Promise.resolve(this.channels[key]);
      this.emit('replyQueue.ready', this.replyQueue);
    }
    return promise;
  }

  deleteExchange(name: string): Promise<unknown> {
    const key = 'exchange:' + name;
    const channel = this.channels[key];
    if (channel) {
      (channel as { release?: () => void }).release?.();
      delete this.channels[key];
      delete this.promises[key];
      logger.info("Deleting %s exchange '%s' on connection '%s'", (channel as { type?: string }).type, name, this.connection.name);
    }
    return this.connection.getChannel('control', false, 'control channel for bindings')
      .then((ch) => ch.deleteExchange(name));
  }

  deleteQueue(name: string): Promise<unknown> {
    const key = 'queue:' + name;
    const channel = this.channels[key];
    if (channel) {
      (channel as { release?: () => void }).release?.();
      delete this.channels[key];
      delete this.promises[key];
      logger.info("Deleting queue '%s' on connection '%s'", name, this.connection.name);
    }
    return this.connection.getChannel('control', false, 'control channel for bindings')
      .then((ch) => ch.deleteQueue(name));
  }

  getUniqueName(options: QueueDef): string {
    if (options.unique === 'id') {
      return `${info.id}-${options.name}`;
    } else if (options.unique === 'hash') {
      return `${options.name}-${info.createHash()}`;
    } else if (options.unique === 'consistent') {
      return `${options.name}-${info.createConsistentHash()}`;
    } else {
      return options.name;
    }
  }

  handleReturned(raw: unknown): void {
    const msg = raw as {
      type?: string;
      fields: { routingKey: string };
      properties: { type?: string; contentType?: string; contentEncoding?: string; messageId?: string };
      content: Buffer;
      body?: unknown;
    };
    msg.type = isEmpty(msg.properties.type) ? msg.fields.routingKey : msg.properties.type;
    const contentType = msg.properties.contentType || 'application/octet-stream';
    const serializer = this.serializers[contentType];
    if (!serializer) {
      logger.error("Could not deserialize message id %s, connection '%s' - no serializer defined",
        msg.properties.messageId, this.connection.name);
    } else {
      try {
        msg.body = serializer.deserialize(msg.content, msg.properties.contentEncoding);
      } catch {
        // ignore deserialization errors
      }
    }
    this.onReturned(msg);
  }

  onReconnect(): void {
    logger.info("Reconnection to '%s' established - rebuilding topology", this.name);
    this.promises = {};

    this.createReplyQueue().catch((err: unknown) => this.onReplyQueueFailed(err));
    this.createDefaultExchange().catch(noop);
    const channelPromises = this.reconnectChannels();
    Promise.all(channelPromises || [])
      .then(() => this.completeRebuild());
  }

  onReplyQueueFailed(err: unknown): void {
    logger.error(`Failed to create reply queue for connection name '${this.connection.name}' with ${err}`);
  }

  reconnectChannels(): Promise<unknown>[] {
    const channelNames = Object.keys(this.channels);
    return channelNames.map((channelName) => {
      const channel = this.channels[channelName];
      const reconnectable = channel as unknown as { reconnect?: () => Promise<unknown> };
      return reconnectable.reconnect ? reconnectable.reconnect() : Promise.resolve(true);
    });
  }

  reset(): void {
    this.channels = {};
    this.promises = {};
    this.definitions = {
      bindings: {},
      exchanges: {},
      queues: {}
    };
  }

  renameQueue(newQueueName: string): void {
    const queue = this.definitions.queues[''];
    const channel = this.channels['queue:'];
    this.definitions.queues[newQueueName] = queue;
    this.channels[`queue:${newQueueName}`] = channel;
    delete this.definitions.queues[''];
    delete this.channels['queue:'];
  }

  removeBinding(options: BindingDef & { source: string }): Promise<unknown> {
    let id = `${options.source}->${options.target}`;
    const keys = getKeys(options.keys);
    if (keys[0] !== '') {
      id += ':' + keys.join(':');
    }
    let promise = this.promises[id];
    if (promise) {
      const call = options.queue ? 'unbindQueue' : 'unbindExchange';
      const source = options.source;
      let target = options.target;
      if (options.queue) {
        const queue = this.definitions.queues[options.target];
        if (queue && queue.uniqueName) {
          target = queue.uniqueName;
        }
      }
      promise = this.connection.getChannel('control', false, 'control channel for bindings')
        .then((channel) => {
          logger.info(`Unbinding ${options.queue ? 'queue' : 'exchange'} '${target}' to '${source}' on '${this.connection.name}' with keys: ${JSON.stringify(keys)}`);
          return Promise.all(
            keys.map((key) =>
              (channel as Record<string, (a: string, b: string, c: string) => Promise<unknown>>)[call](target, source, key)
            )
          );
        })
        .then(() => {
          delete this.promises[id];
          delete this.definitions.bindings[id];
        });
    } else {
      promise = Promise.resolve();
    }
    return promise;
  }
}

export default function createTopology(
  connection: Connection,
  options: TopologyOptions,
  serializers: Record<string, Serializer>,
  unhandledStrategies: UnhandledStrategies,
  returnedStrategies: ReturnedStrategies,
  exchangeFsm?: typeof ExchangeFsm,
  queueFsm?: typeof QueueFsm,
  defaultId?: string
): Topology {
  const Exchange = exchangeFsm || ExchangeFsm;
  const Queue = queueFsm || QueueFsm;
  const replyId = defaultId || info.id;

  return new Topology(connection, options, serializers, unhandledStrategies, returnedStrategies, Exchange, Queue, replyId);
}

export type { Topology };
